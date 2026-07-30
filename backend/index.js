const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require('dotenv');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const { S3Client, PutObjectCommand, DeleteObjectCommand} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Which env file to load. Defaults to backend/.env; set ENV_FILE to flip profiles:
//   ENV_FILE=.env.proddb npm run dev
// Resolved against this directory so it works no matter which cwd the process was
// started from (Heroku runs `node backend/index.js` from the repo root). On a hosted
// platform the file simply won't exist, and the platform's real config vars are used.
const ENV_FILE = process.env.ENV_FILE || '.env';
dotenv.config({ path: path.resolve(__dirname, ENV_FILE) });

// Fail fast on missing config rather than throwing on the first request that needs
// it. Without JWT_SECRET, for example, every login would 500 at jwt.sign().
const REQUIRED_ENV = ['MONGODB_URI', 'DB_NAME', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    console.error('   See backend/.env.example for the expected configuration.');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// Allowed browser origins, comma-separated, so dev and prod can both be configured
// without editing code. Cookies require an exact origin match (credentials: true
// forbids the '*' wildcard).
const ALLOWED_ORIGINS = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)

app.use(cors({
    origin(origin, callback) {
        // Requests without an Origin header (curl, server-to-server, same-origin
        // navigation) are not subject to CORS, so let them through.
        if (!origin) return callback(null, true)
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true)
        // Respond without CORS headers rather than throwing, so a rejected origin
        // gets a clean browser-side block instead of a 500.
        console.warn('Blocked CORS origin', origin)
        return callback(null, false)
    },
    credentials: true,
}));

app.use(bodyParser.json());


// Simple cookie parser for the refresh token (no dependency)
function parseCookies(cookieHeader) {
    const obj = {}
    if (!cookieHeader) return obj
    cookieHeader.split(';').forEach(c => {
        const [k, v] = c.split('=')
        if (!k) return
        obj[k.trim()] = decodeURIComponent((v || '').trim())
    })
    return obj
}

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;
const BUCKET_REGION = process.env.AWS_BUCKET_REGION;
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const JWT_SECRET = process.env.JWT_SECRET 
const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10)
const REFRESH_TOKEN_TTL = REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 // ms

const s3Client = new S3Client({
  region: BUCKET_REGION,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// --- Authentication middleware (verifies access JWT in Authorization header)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['Authorization']
    if (!authHeader) return res.status(401).json({ message: 'Missing Authorization header' })
    const parts = authHeader.split(' ')
    if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ message: 'Malformed Authorization header' })
    const token = parts[1]
    try {
        const payload = jwt.verify(token, JWT_SECRET)
        // payload.sub is user id as created when signing token
        req.user = { id: payload.sub, roles: payload.roles, username: payload.username }
        return next()
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired access token' })
    }
}

// Helper to build a Set-Cookie header for refresh tokens.
// For cross-site (production) scenarios we need SameSite=None and Secure so browsers
// will send the cookie on cross-origin XHR/fetch requests. In development we keep
// SameSite=Lax for convenience when frontend is served from the same origin.
function buildRefreshCookie(token, maxAgeSeconds) {
  const encoded = encodeURIComponent(token || '')
  // Use SameSite=None and Secure in production so cookies are sent cross-site over HTTPS.
  // In development (local HTTP) prefer SameSite=Lax and no Secure so browsers accept the cookie.
  const isProd = process.env.NODE_ENV === 'production'
  const sameSite = isProd ? 'None' : 'Lax'
  const secure = isProd ? '; Secure' : ''
  return `refreshToken=${encoded}; HttpOnly; Path=/; Max-Age=${Math.floor(maxAgeSeconds)}${secure}; SameSite=${sameSite}`
}

function s3KeyFromPublicUrl(publicUrl) {
  if (!publicUrl) return null;
  // Example URL forms:
  // https://<bucket>.s3.<region>.amazonaws.com/<key>
  // https://s3.<region>.amazonaws.com/<bucket>/<key>
  try {
    const u = new URL(publicUrl);
    // Case 1: <bucket>.s3.<region>.amazonaws.com
    const hostParts = u.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[1] === 's3') {
      // key is pathname without the leading slash
      return u.pathname.slice(1);
    }
    // Case 2: s3.<region>.amazonaws.com/<bucket>/<key>
    if (u.hostname.startsWith('s3.')) {
      const parts = u.pathname.split('/').filter(Boolean); // [bucket, key...]
      parts.shift(); // remove bucket
      return parts.join('/');
    }
    
    return null;
  } catch (err) {
    return null;
  }
}

async function deleteS3Object(key) {
  if (!key) return;
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    }));
    console.log('S3 object deleted', key);
  } catch (err) {
    // Log and continue; you may want to retry or enqueue for background cleanup
    console.warn('Failed to delete S3 object', key, err);
  }
}

// --- Pagination ------------------------------------------------------------------
// Keyset ("cursor") pagination rather than skip/limit: skip has to walk and discard
// every skipped document, so deep pages get linearly slower, and rows shift between
// requests when new documents arrive mid-scroll — causing duplicates and gaps. A cursor
// seeks straight into the index and is stable under concurrent inserts.
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseLimit(raw) {
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  // Cap it so a client can't ask for the whole collection in one request.
  return Math.min(parsed, MAX_PAGE_SIZE);
}

// Cursors are opaque base64 so clients treat them as tokens instead of building their
// own and coupling to the internal shape.
function encodeCursor(doc) {
  if (!doc) return null;
  const payload = JSON.stringify({ t: doc.createdAt, i: String(doc._id) });
  return Buffer.from(payload).toString('base64url');
}

function decodeCursor(raw) {
  if (!raw) return null;
  try {
    const { t, i } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
    const createdAt = new Date(t);
    if (Number.isNaN(createdAt.getTime()) || !ObjectId.isValid(i)) return null;
    return { createdAt, id: new ObjectId(i) };
  } catch (err) {
    return null; // malformed cursor — treated as "start from the beginning"
  }
}

// "Strictly older than the cursor", with _id breaking createdAt ties so a page boundary
// can never drop or repeat a document that shares a timestamp with its neighbour.
function cursorFilter(cursor) {
  if (!cursor) return null;
  return {
    $or: [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ],
  };
}

// Runs a keyset-paginated find and reports whether another page exists. Fetching
// limit + 1 rows answers that without a second count query.
async function paginatedFind(collectionName, filter, { limit, cursor }) {
  const keyset = cursorFilter(cursor);
  const query = keyset ? { $and: [filter, keyset] } : filter;
  const docs = await db.collection(collectionName)
    .find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null };
}

function avatarUrlForKey(avatarKey) {
  return avatarKey ? `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${avatarKey}` : null;
}

// Attach each author's avatar plus the viewer's like/bookmark state to a page of posts.
// Uses a fixed three queries no matter how many posts are in the page, and Sets for the
// membership tests so annotating is linear rather than posts x likes.
async function annotatePosts(posts, viewerId) {
  if (!posts || posts.length === 0) return [];

  const postIds = posts.map(p => p.id);
  const authorIds = Array.from(new Set(posts.map(p => p.userId)));

  const [authors, likes, bookmarks] = await Promise.all([
    db.collection('users')
      .find({ id: { $in: authorIds } })
      .project({ id: 1, avatarKey: 1, _id: 0 })
      .toArray(),
    viewerId
      ? db.collection('likes').find({ tweetId: { $in: postIds }, userId: viewerId }).project({ tweetId: 1 }).toArray()
      : [],
    viewerId
      ? db.collection('bookmarks').find({ postId: { $in: postIds }, userId: viewerId }).project({ postId: 1 }).toArray()
      : [],
  ]);

  const avatarByAuthor = new Map(authors.map(u => [u.id, avatarUrlForKey(u.avatarKey)]));
  const likedIds = new Set(likes.map(l => l.tweetId));
  const bookmarkedIds = new Set(bookmarks.map(b => b.postId));

  return posts.map(p => ({
    ...p,
    avatarUrl: avatarByAuthor.get(p.userId) || null,
    youLiked: likedIds.has(p.id),
    bookmarked: bookmarkedIds.has(p.id),
  }));
}

// The unique indexes declared below mean Mongo can now reject a write with E11000
// where it previously created a duplicate. Handlers pre-check for conflicts, but a
// small race window remains between that check and the write, so map the error to a
// 400 instead of letting it surface as a 500.
function duplicateKeyField(err) {
  if (!err || err.code !== 11000) return null;
  // The driver reports the violated index as keyPattern, e.g. { email: 1 }.
  const field = err.keyPattern ? Object.keys(err.keyPattern)[0] : null;
  return field || 'unknown';
}

let db; // we'll store our database reference here

// Every index the app relies on, declared in one place next to the query it serves so
// the two can be reviewed together. Without these, each listed query is a full
// collection scan. createIndex is idempotent, so this is safe to run on every boot.
//
// Compound key order follows the ESR rule: Equality fields first, then Sort fields.
const INDEXES = [
  // --- users ---
  {
    collection: 'users',
    keys: { id: 1 },
    options: { unique: true, name: 'uniq_user_id' },
    serves: 'findOne({ id }) — hit on nearly every authenticated request',
  },
  {
    collection: 'users',
    keys: { email: 1 },
    options: { unique: true, name: 'uniq_user_email' },
    serves: 'login, verify, resend, and the register duplicate check',
  },
  {
    collection: 'users',
    keys: { username: 1 },
    options: { unique: true, name: 'uniq_user_username' },
    serves: 'register $or check and the "username already taken" check',
  },

  // --- posts ---
  {
    collection: 'posts',
    keys: { id: 1 },
    options: { unique: true, name: 'uniq_post_id' },
    serves: 'findOne({ id }) on every like, unlike, comment, bookmark and delete',
  },
  {
    collection: 'posts',
    keys: { userId: 1, createdAt: -1, _id: -1 },
    options: { name: 'post_author_recent' },
    // _id is the third key so keyset pagination's tiebreaker sort stays index-served.
    // Without it, sort({ createdAt: -1, _id: -1 }) falls back to an in-memory SORT.
    serves: 'home feed find({ userId: { $in } }).sort({ createdAt: -1, _id: -1 }) and profile feed',
  },

  // --- comments ---
  {
    collection: 'comments',
    keys: { tweetId: 1, createdAt: -1, _id: -1 },
    options: { name: 'comment_post_recent' },
    serves: 'paginated find({ tweetId }).sort({ createdAt: -1, _id: -1 }) and the delete-post cascade',
  },

  // --- likes ---
  {
    collection: 'likes',
    keys: { tweetId: 1, userId: 1 },
    options: { unique: true, name: 'uniq_tweet_user' },
    serves: 'like/unlike upsert, the feed annotation query, and deleteMany({ tweetId })',
  },

  // --- bookmarks ---
  {
    collection: 'bookmarks',
    keys: { userId: 1, postId: 1 },
    options: { unique: true, name: 'uniq_user_post_bookmark' },
    serves: 'bookmark toggle, find({ userId }) listing, and the feed annotation query',
  },
  {
    collection: 'bookmarks',
    keys: { postId: 1 },
    options: { name: 'bookmark_post' },
    serves: 'deleteMany({ postId }) cascade — postId is not a prefix of the unique index',
  },
  {
    collection: 'bookmarks',
    keys: { userId: 1, createdAt: -1, _id: -1 },
    options: { name: 'bookmark_user_recent' },
    serves: 'paginated bookmark listing, most recently saved first',
  },

  // --- refreshTokens ---
  {
    collection: 'refreshTokens',
    keys: { token: 1 },
    options: { unique: true, name: 'uniq_refresh_token' },
    serves: 'findOne({ token }) and updateOne({ token }) on every token refresh',
  },
  {
    collection: 'refreshTokens',
    keys: { expiresAt: 1 },
    options: { expireAfterSeconds: 0, name: 'ttl_refresh_expires' },
    serves: 'TTL cleanup — Mongo deletes each token once expiresAt passes, so the '
      + 'collection stops growing without bound',
  },
];

async function ensureIndexes(db) {
  let created = 0;
  let existing = 0;
  let rebuilt = 0;
  const failures = [];

  for (const spec of INDEXES) {
    const { collection, keys, options } = spec;
    try {
      const before = await db.collection(collection).indexes().catch(() => []);
      const present = before.find(ix => ix.name === options.name);

      // If an index of this name exists with different keys, the declaration above has
      // changed since it was built. Mongo rejects createIndex in that case, so drop and
      // rebuild to keep this list the single source of truth.
      if (present && JSON.stringify(present.key) !== JSON.stringify(keys)) {
        await db.collection(collection).dropIndex(options.name);
        await db.collection(collection).createIndex(keys, options);
        rebuilt += 1;
        console.log(`   ~ rebuilt ${collection}.${options.name} (key spec changed)`);
        continue;
      }

      await db.collection(collection).createIndex(keys, options);
      if (present) {
        existing += 1;
      } else {
        created += 1;
        console.log(`   + created ${collection}.${options.name}`);
      }
    } catch (err) {
      failures.push(`${collection}.${options.name}: ${err.message}`);
    }
  }

  console.log(`✅ Indexes ready (${created} created, ${rebuilt} rebuilt, ${existing} already present${failures.length ? `, ${failures.length} failed` : ''})`);
  for (const failure of failures) {
    // Not fatal: the app still works, just with collection scans and without the
    // uniqueness guarantee. A unique-index failure usually means duplicate data.
    console.error(`   ! index failed — ${failure}`);
  }
}

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI ,{
      serverSelectionTimeoutMS: 8000, // optional but helps Heroku
    });
    await client.connect();
    db = client.db(process.env.DB_NAME); // connect to the right DB
    console.log("✅ MongoDB connected");
    await ensureIndexes(db);
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}


app.post('/api/generate-upload-url', authenticateToken,async (req, res) => {
  console.log('Generating upload URL');
  try {
    const { fileName, fileType } = req.body;

    // --- Basic File Validation ---
    // You should add more robust validation here
    const allowedFileTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime'];
    if (!allowedFileTypes.includes(fileType)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    // --- Generate a unique file key for S3 ---
    // We use crypto.randomBytes to create a unique prefix
    const randomBytes = crypto.randomBytes(16).toString('hex');
    const fileKey = `${randomBytes}-${fileName}`;

    // --- Create the PutObjectCommand ---
    // This command prepares the upload parameters
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: fileKey,
      ContentType: fileType,
      // ACL: 'public-read', // This is needed if your bucket policy doesn't force public-read
    });

    // --- Generate the presigned URL ---
    // This URL will be valid for a limited time (e.g., 60 seconds)
    const uploadUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 60, // 60 seconds
    });
    

    // --- Generate the final public URL ---
    // This is the URL you will store in MongoDB
    const publicUrl = `https://s3.${BUCKET_REGION}.amazonaws.com/${BUCKET_NAME}/${fileKey}`;
    // Note: A more robust way is `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${fileKey}`
    console.log(publicUrl);
    // --- Send the URLs back to the React app ---
    res.status(200).json({
      uploadUrl: uploadUrl,
      publicUrl: publicUrl, // The URL to store in your database
      fileKey: fileKey,
    });

  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Error generating upload URL' });
  }
});

app.post("/auth/register", async (req, res) => {
  const { email, username, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ message: "Missing username, email or password" });
  }


  try {
    const existing = await db.collection("users").findOne({
      $or: [{ email }, { username }],
    });
    if (existing) {
      return res
        .status(400)
        .json({ message: "User with that email or username already exists" });
    }


    const passwordHash = await bcrypt.hash(password, 10);

   
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const verificationCodeHash = await bcrypt.hash(verificationCode, 10)

    const newUser = {
      id: uuidv4(),
      username,
      email,
      passwordHash,
      roles: ["user"],
      createdAt: new Date(),
      isVerified: false,
      verificationCodeHash,
      verificationExpires,
      resendCount: 0,
      lastResendAt: null,
      following: [],
    };

    const result = await db.collection("users").insertOne(newUser);
  console.log('New user inserted with id=', newUser.id, 'mongoId=', result.insertedId)


    try {
      await sendVerificationEmail(email, username, verificationCode)
    } catch (mailErr) {
      console.error('Failed to send verification email', mailErr)
    }

    // Return verification code in non-production so it's easy to test without email delivery
    const resp = { message: 'User registered. Verification code sent to your email.', userId: result.insertedId }
    if (process.env.NODE_ENV !== 'production') resp.devVerificationCode = verificationCode
    return res.status(201).json(resp)
  } catch (err) {
    if (duplicateKeyField(err)) {
      // Lost a race with a concurrent registration for the same email or username.
      return res
        .status(400)
        .json({ message: "User with that email or username already exists" });
    }
    console.error("Registration error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

async function sendVerificationEmail(email, username, code) {
  // SMTP_* are the canonical names; the MAILTRAP_* fallbacks keep existing
  // deployments working until their config vars are renamed.
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT || process.env.MAILTRAP_PORT || '587', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS || process.env.MAILTRAP_PASS

  if (!(host && user && pass)) {
    console.warn('SMTP not configured (need SMTP_USER and SMTP_PASS); skipping verification email')
    return
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    auth: { user, pass },
    secure: false,
  })

  const mailOptions = {
    from: `"Twitter Clone" <no-reply@twitter-clone.local>`,
    to: email,
    subject: 'Verify Your Email',
    html: `
      <div style="font-family: Arial, sans-serif;">
        <h2>Hello ${username},</h2>
        <p>Thank you for registering! Please verify your email using the code below:</p>
        <h1 style="color:#4CAF50;">${code}</h1>
        <p>This code will expire in 10 minutes.</p>
      </div>
    `,
  }

  await transporter.sendMail(mailOptions)
  console.log('Verification email sent to', email)
}

app.post("/auth/verify", async (req, res) => {
  const { email, code } = req.body;

  try {
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (user.isVerified)
      return res.status(400).json({ message: "User already verified" });

    // ensure code matches hashed code
    if (!user.verificationCodeHash)
      return res.status(400).json({ message: 'No verification code present. Request a new one.' })

    const match = await bcrypt.compare(code, user.verificationCodeHash)
    if (!match) return res.status(400).json({ message: "Invalid verification code" });

    if (new Date() > new Date(user.verificationExpires))
      return res.status(400).json({ message: "Verification code expired" });

    await db.collection("users").updateOne(
      { email },
      {
        $set: { isVerified: true, resendCount: 0, lastResendAt: null },
        $unset: { verificationCodeHash: "", verificationExpires: "" },
      }
    );

    return res.status(200).json({ message: "Email verified successfully!" });
  } catch (err) {
    console.error("Verification error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});






app.post('/auth/refresh', async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie)
        const token = cookies.refreshToken
        if (!token) return res.status(401).json({ message: 'No refresh token' })
        const record = await db.collection('refreshTokens').findOne({ token })
        if (!record || record.revoked) return res.status(401).json({ message: 'Invalid refresh token' })
        if (new Date(record.expiresAt) < new Date()) return res.status(401).json({ message: 'Refresh token expired' })

        // rotate: create new refresh token and revoke old
        const newToken = crypto.randomBytes(64).toString('hex')
        const now = Date.now()
        await db.collection('refreshTokens').insertOne({ token: newToken, userId: record.userId, createdAt: new Date(now), expiresAt: new Date(now + REFRESH_TOKEN_TTL), revoked: false })
        await db.collection('refreshTokens').updateOne({ token }, { $set: { revoked: true, replacedBy: newToken, revokedAt: new Date() } })

        const user = await db.collection('users').findOne({ id: record.userId })
        if (!user) return res.status(401).json({ message: 'User not found' })

  const accessToken = jwt.sign({ sub: user.id, roles: user.roles ,username: user.username}, JWT_SECRET, { expiresIn: '10m' })
  // set rotated refresh token cookie
  res.setHeader('Set-Cookie', buildRefreshCookie(newToken, REFRESH_TOKEN_TTL/1000))
  // include following so client can persist follow state
  return res.status(200).json({ accessToken, user: { id: user.id, username: user.username, email: user.email, roles: user.roles, following: user.following || [] } })
    } catch (err) {
        console.error('Refresh error', err)
        return res.status(500).json({ message: 'Refresh failed' })
    }
})

// Resend verification code (basic rate limiting)
app.post('/auth/resend', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ message: 'Email required' })

  try {
    const user = await db.collection('users').findOne({ email })
    if (!user) return res.status(404).json({ message: 'User not found' })
    if (user.isVerified) return res.status(400).json({ message: 'User already verified' })

    const now = Date.now()
    const last = user.lastResendAt ? new Date(user.lastResendAt).getTime() : 0
    const resendCount = user.resendCount || 0

    // simple policy: at most 3 resends within 1 hour
    if (resendCount >= 3 && now - last < 60 * 60 * 1000) {
      return res.status(429).json({ message: 'Too many resend attempts. Try again later.' })
    }

    // generate new code and hash it
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpires = new Date(now + 10 * 60 * 1000)
    const verificationCodeHash = await bcrypt.hash(verificationCode, 10)

    await db.collection('users').updateOne(
      { email },
      { $set: { verificationCodeHash, verificationExpires, resendCount: resendCount + 1, lastResendAt: new Date(now) } }
    )

    try {
      await sendVerificationEmail(email, user.username || email, verificationCode)
    } catch (err) {
      console.error('Failed to send resend email', err)
    }

    const resp = { message: 'Verification code resent' }
    if (process.env.NODE_ENV !== 'production') resp.devVerificationCode = verificationCode
    return res.status(200).json(resp)
  } catch (err) {
    console.error('Resend error', err)
    return res.status(500).json({ message: 'Resend failed' })
  }
})

app.post("/auth/login",async (req, res) => {

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Missing email or password" });
    }
    
  
    try {
      const user = await db.collection("users").findOne({ email });
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
  
      const passwordMatch = await bcrypt.compare(password, user.passwordHash);
      if (!passwordMatch) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
  
      if (!user.isVerified) {
        return res.status(403).json({ message: "Email not verified" });
      }
  
      const accessToken = jwt.sign({ sub: user.id, roles: user.roles, username: user.username}, JWT_SECRET, { expiresIn: '10m' });
  
      const refreshToken = crypto.randomBytes(64).toString('hex');
      const now = Date.now();
      await db.collection('refreshTokens').insertOne({ token: refreshToken, userId: user.id, createdAt: new Date(now), expiresAt: new Date(now + REFRESH_TOKEN_TTL), revoked: false });
  
  // set refresh token cookie
  res.setHeader('Set-Cookie', buildRefreshCookie(refreshToken, REFRESH_TOKEN_TTL/1000));
  
      // include following so the client can persist follow state
      return res.status(200).json({ accessToken, user: { username: user.username, id: user.id, email: user.email, roles: user.roles, following: user.following || [] } });
    } catch (err) {
      console.error("Login error", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  });   

app.post('/auth/logout', async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie)
        const token = cookies.refreshToken
        if (token) {
            await db.collection('refreshTokens').updateOne({ token }, { $set: { revoked: true, revokedAt: new Date() } })
        }
  // clear cookie (client will remove by setting expired cookie)
  res.setHeader('Set-Cookie', buildRefreshCookie('', 0))
        return res.status(200).json({ message: 'Logged out' })
    } catch (err) {
        console.error('Logout error', err)
        return res.status(500).json({ message: 'Logout failed' })
    }
})




app.post('/api/posts', authenticateToken, async (req, res) => {
    
    const newPost = {
        id: uuidv4(),
        userId: req.user.id,
        username: req.user.username,
        post: req.body.text,
        mediaUrl: req.body.mediaUrl || null,
        createdAt: new Date(),
        comment : 0,
        likes: 0,
        is_reply: false,
    };
    try  {
      await db.collection('posts').insertOne(newPost);
      return  res.status(201).json({ message: 'Post created' })
    } catch (err) {
      console.error('Error creating post', err);
      return res.status(500).json({ message: 'Failed to create post' });
    }
    
});

app.get('/api/posts', authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;
      const limit = parseLimit(req.query.limit);
      const cursor = decodeCursor(req.query.cursor);

      const user = await db.collection('users').findOne({ id: userId }, { projection: { following: 1 } });
      if (!user) return res.status(401).json({ message: 'User not found' });
      const ids = [...(user.following || []), userId];

      const { items, nextCursor } = await paginatedFind('posts', { userId: { $in: ids } }, { limit, cursor });
      const posts = await annotatePosts(items, userId);

      return res.status(200).json({ posts, nextCursor });
    } catch (err) {
      console.error('Error fetching posts', err);
      return res.status(500).json({ message: 'Failed to fetch posts' });
    }
});



app.post('/api/posts/:id/likes', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
    try {
        const post = await db.collection('posts').findOne({ id });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
    // Use upsert to atomically create the like only if missing.
    // $setOnInsert ensures we don't overwrite existing documents.
    const likeResult = await db.collection('likes').updateOne(
      { tweetId: id, userId },
      { $setOnInsert: { tweetId: id, userId, createdAt: new Date() } },
      { upsert: true }
    );

    // If an insert happened (upsert created a new doc), increment the post's likes count.
    const inserted = (likeResult.upsertedCount && likeResult.upsertedCount > 0) || !!likeResult.upsertedId
    if (inserted) {
      await db.collection('posts').updateOne({ id }, { $inc: { likes: 1 } });
    }

    // Return current like count and whether this action resulted in a new like.
    const current = await db.collection('posts').findOne({ id }, { projection: { likes: 1 } });
    return res.status(200).json({ liked: true, created: !!inserted, likeCount: current ? current.likes : 0 });
    } catch (err) {
        console.error('Error liking post', err);
        return res.status(500).json({ message: 'Failed to like post' });
    }
});

// Unlike (delete a like) - idempotent
app.delete('/api/posts/:id/likes', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const post = await db.collection('posts').findOne({ id });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const del = await db.collection('likes').deleteOne({ tweetId: id, userId });

    if (del.deletedCount === 1) {
      // decrement the post's like counter, but avoid going negative
      await db.collection('posts').updateOne({ id, likes: { $gt: 0 } }, { $inc: { likes: -1 } });
      const current = await db.collection('posts').findOne({ id }, { projection: { likes: 1 } });
      return res.status(200).json({ liked: false, deleted: true, likeCount: current ? current.likes : 0 });
    }

    // nothing to delete (idempotent)
    const current = await db.collection('posts').findOne({ id }, { projection: { likes: 1 } });
    return res.status(200).json({ liked: false, deleted: false, likeCount: current ? current.likes : 0 });
  } catch (err) {
    console.error('Error unliking post', err);
    return res.status(500).json({ message: 'Failed to unlike post' });
  }
});
 
app.get('/api/postsfeed/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const post = await db.collection('posts').findOne({ id });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        const author = await db.collection('users').findOne({ id: post.userId }, { projection: { avatarKey: 1, _id: 0 } });
        post.avatarUrl = avatarUrlForKey(author && author.avatarKey);

        // Comments are paginated too — a popular post's thread is unbounded otherwise.
        const commentLimit = parseLimit(req.query.commentLimit);
        const commentCursor = decodeCursor(req.query.commentCursor);
        const { items: comments, nextCursor: commentsNextCursor } =
          await paginatedFind('comments', { tweetId: id }, { limit: commentLimit, cursor: commentCursor });

        let youLiked = false
        try {
          const like = await db.collection('likes').findOne({ tweetId: id, userId: req.user.id })
          youLiked = !!like
        } catch (e) {
          console.warn('Failed to check like status', e)
        }

        let bookmarked = false
        try {
          const bm = await db.collection('bookmarks').findOne({ postId: id, userId: req.user.id })
          bookmarked = !!bm
        } catch (e) {
          console.warn('Failed to check bookmark status', e)
        }

        // attach youLiked flag to post object for client convenience
        const postWithFlag = { ...post, youLiked, bookmarked }

        return res.status(200).json({ post: postWithFlag, comments, commentsNextCursor });
    } catch (err) {
        console.error('Error fetching post', err);
        return res.status(500).json({ message: 'Failed to fetch post' });
    }
});

app.post('/api/posts/:id/comments', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { comment } = req.body;
    if (!comment) {
        return res.status(400).json({ message: 'Comment text required' });
    }
    try {
        const post = await db.collection('posts').findOne({ id });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        const newComment = {
            
            id: uuidv4(),
            tweetId: id,
            userId: req.user.id,
            username: req.user.username,
            comment,
            createdAt: new Date(),
        };
    const insertResult = await db.collection('comments').insertOne(newComment);

    // Increment the comment counter on the post document.
    // Field name is `comment` on posts (number), so increment by 1.
    await db.collection('posts').updateOne({ id }, { $inc: { comment: 1 } });

    // Read the updated comment count to return to the client
    const current = await db.collection('posts').findOne({ id }, { projection: { comment: 1 } });

    return res.status(201).json({ message: 'Comment added', comment: newComment, commentCount: current ? current.comment : null });
    } catch (err) {
        console.error('Error adding comment', err);
        return res.status(500).json({ message: 'Failed to add comment' });
    }
});

// Toggle/add/remove bookmark for a post (uses a separate `bookmarks` collection)
app.patch('/api/posts/:id/bookmark', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  try {
    const post = await db.collection('posts').findOne({ id });
    if (!post) return res.status(404).json({ message: 'Post not found' });

    const body = req.body || {};
    const requested = typeof body.bookmark === 'boolean' ? body.bookmark : undefined;

    if (requested === undefined) {
      // toggle behavior: check existing bookmark
      const existing = await db.collection('bookmarks').findOne({ userId, postId: id });
      if (existing) {
        await db.collection('bookmarks').deleteOne({ userId, postId: id });
        return res.status(200).json({ bookmarked: false });
      } else {
        await db.collection('bookmarks').updateOne(
          { userId, postId: id },
          { $setOnInsert: { userId, postId: id, createdAt: new Date() } },
          { upsert: true }
        );
        return res.status(200).json({ bookmarked: true });
      }
    }

    if (requested) {
      // add (idempotent)
      await db.collection('bookmarks').updateOne(
        { userId, postId: id },
        { $setOnInsert: { userId, postId: id, createdAt: new Date() } },
        { upsert: true }
      );
      return res.status(200).json({ bookmarked: true });
    }

    // requested === false -> remove
    await db.collection('bookmarks').deleteOne({ userId, postId: id });
    return res.status(200).json({ bookmarked: false });
  } catch (err) {
    console.error('Error toggling bookmark', err);
    return res.status(500).json({ message: 'Failed to toggle bookmark' });
  }
});

// List bookmarked posts for current user, most recently saved first
app.get('/api/bookmarks', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);

    // Page over the bookmarks themselves, then hydrate that page's posts.
    const { items: bookmarks, nextCursor } = await paginatedFind('bookmarks', { userId }, { limit, cursor });
    if (bookmarks.length === 0) return res.status(200).json({ posts: [], nextCursor: null });

    const postIds = bookmarks.map(b => b.postId);
    const found = await db.collection('posts').find({ id: { $in: postIds } }).toArray();

    // $in returns documents in index order, not the order of postIds, so restore the
    // bookmark ordering explicitly. Posts deleted since bookmarking simply drop out.
    const postById = new Map(found.map(p => [p.id, p]));
    const ordered = postIds.map(id => postById.get(id)).filter(Boolean);

    const posts = await annotatePosts(ordered, userId);
    return res.status(200).json({ posts, nextCursor });
  } catch (err) {
    console.error('Error fetching bookmarks', err);
    return res.status(500).json({ message: 'Failed to fetch bookmarks' });
  }
});

app.get('/api/connect', authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id
    const limit = parseLimit(req.query.limit);

    // Users have no meaningful recency for discovery, so page by username instead of
    // createdAt. It is unique and already indexed, so no tiebreaker is needed and the
    // cursor is just the last username of the previous page.
    const after = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null;
    const filter = { id: { $ne: currentUserId } };
    if (after) filter.username = { $gt: after };

    const found = await db.collection('users')
      .find(filter, { projection: { id: 1, username: 1, avatarKey: 1, _id: 0 } })
      .sort({ username: 1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = found.length > limit;
    const users = (hasMore ? found.slice(0, limit) : found).map(u => ({
      ...u,
      avatarUrl: avatarUrlForKey(u.avatarKey),
    }));
    const nextCursor = hasMore ? users[users.length - 1].username : null;

    // Send the following list as a plain array — the client checks Array.isArray on it,
    // so the previous shape ({ _id, following }) never satisfied that fallback.
    const me = await db.collection('users').findOne({ id: currentUserId }, { projection: { following: 1 } });
    return res.status(200).json({ users, following: (me && me.following) || [], nextCursor });
  } catch (err) {
    console.error('Error fetching users', err);
    return res.status(500).json({ message: 'Failed to fetch users' });
  }

});



app.patch('/api/connect/:userId', authenticateToken, async (req, res) => {
  const { userId } = req.params;
  const currentUserId = req.user.id
  try {
    const response = await db.collection('users').updateOne(
      { id: currentUserId },
      { $addToSet: { following: userId } } // addToSet prevents duplicates
    );
    if (response.matchedCount === 0) {
      return res.status(404).json({ message: 'Current user not found' });
    }
    // return the updated user so client can update AuthContext
    const updated = await db.collection('users').findOne({ id: currentUserId }, { projection: { id: 1, username: 1, email: 1, roles: 1, following: 1, _id: 0 } });
    return res.status(200).json({ message: 'User followed', user: updated });
  } catch (err) {
    console.error('Error following user', err);
    return res.status(500).json({ message: 'Failed to follow user' });
  }
});

// --- User profile endpoints ---
// Public: get a user's public profile (no auth required)
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await db.collection('users').findOne(
      { id },
      { projection: { id: 1, username: 1, bio: 1, createdAt: 1, avatarKey: 1, _id: 0 } }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    const avatarUrl = user.avatarKey ? `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${user.avatarKey}` : null;
    return res.status(200).json({ user: { id: user.id, username: user.username, bio: user.bio || null, createdAt: user.createdAt, avatarUrl } });
  } catch (err) {
    console.error('Error fetching user profile', err);
    return res.status(500).json({ message: 'Failed to fetch profile' });
  }
});

// Authenticated: update current user's profile (username, bio)
app.patch('/api/users/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
  const { username, bio, avatarKey } = req.body || {};
    const update = {};
    if (username) update.username = username;
    if (bio !== undefined) update.bio = bio;
    if (avatarKey) update.avatarKey = avatarKey;

    if (username) {
      // ensure username uniqueness
      const existing = await db.collection('users').findOne({ username, id: { $ne: userId } });
      if (existing) return res.status(400).json({ message: 'Username already taken' });
    }

    if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No fields to update' });

    await db.collection('users').updateOne({ id: userId }, { $set: update });
    const user = await db.collection('users').findOne({ id: userId }, { projection: { id: 1, username: 1, createdAt: 1, email: 1, bio: 1, avatarKey: 1, following: 1, _id: 0 } });
    const avatarUrl = user && user.avatarKey ? `https://${BUCKET_NAME}.s3.${BUCKET_REGION}.amazonaws.com/${user.avatarKey}` : null;
    return res.status(200).json({ user: { id: user.id, username: user.username, email: user.email, bio: user.bio || null, avatarUrl, following: user.following || [], createdAt: user.createdAt || null } });
  } catch (err) {
    if (duplicateKeyField(err) === 'username') {
      return res.status(400).json({ message: 'Username already taken' });
    }
    console.error('Error updating profile', err);
    return res.status(500).json({ message: 'Failed to update profile' });
  }
});

// Authenticated: list posts by user id (annotated for the viewer)
app.get('/api/users/:id/posts', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = req.user && req.user.id;
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);

    const { items, nextCursor } = await paginatedFind('posts', { userId: id }, { limit, cursor });
    const posts = await annotatePosts(items, viewerId);

    return res.status(200).json({ posts, nextCursor });
  } catch (err) {
    console.error('Error fetching user posts', err);
    return res.status(500).json({ message: 'Failed to fetch user posts' });
  }
});


app.delete('/api/posts/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;
     
    try {
        const post = await db.collection('posts').findOne({ id });
        if (!post) {
            return res.status(404).json({ message: 'Post not found' });
        }
        console.log('Delete post requested by user', userId, 'post owner', post.userId, 'user roles', req.user.roles);
        if (!req.user.roles.includes('Admin') && post.userId !== userId) {
            return res.status(403).json({ message: 'Unauthorized to delete this post' });
        }
        if (post.mediaUrl){
          const key = s3KeyFromPublicUrl(post.mediaUrl);
          await deleteS3Object(key);
        }
        await db.collection('posts').deleteOne({ id });
        // Optionally, delete associated likes, comments, bookmarks
        await db.collection('likes').deleteMany({ tweetId: id });
        await db.collection('comments').deleteMany({ tweetId: id });
        await db.collection('bookmarks').deleteMany({ postId: id });

        return res.status(200).json({ message: 'Post deleted' });
    } catch (err) {
        console.error('Error deleting post', err);
        return res.status(500).json({ message: 'Failed to delete post' });
    }
});

// Describe the Mongo target without ever printing the credential.
function describeMongoTarget(uri) {
  try {
    const u = new URL(String(uri).replace(/^mongodb(\+srv)?:\/\//, 'https://'));
    return u.hostname;
  } catch (err) {
    return '(unparseable MONGODB_URI)';
  }
}

connectDB().then(() => {
  app.listen(PORT, () => {
    if (process.env.NODE_ENV !== 'test') {
      // Print the active profile so it is immediately obvious which database and
      // origins this process is wired to — the whole point of switchable profiles.
      console.log('──────────────────────────────────────────────');
      console.log(`  env file    : ${ENV_FILE}`);
      console.log(`  NODE_ENV    : ${process.env.NODE_ENV || '(unset)'}`);
      console.log(`  database    : ${process.env.DB_NAME} @ ${describeMongoTarget(process.env.MONGODB_URI)}`);
      console.log(`  CORS allow  : ${ALLOWED_ORIGINS.join(', ')}`);
      console.log(`  SMTP        : ${process.env.SMTP_USER ? `${process.env.SMTP_USER} via ${process.env.SMTP_HOST || 'smtp.gmail.com'}` : '(not configured)'}`);
      console.log('──────────────────────────────────────────────');
    }
    console.log(`Server running on http://localhost:${PORT}`);
  });
});