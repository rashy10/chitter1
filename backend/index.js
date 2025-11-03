const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const { MongoClient, ServerApiVersion } = require('mongodb');
const dotenv = require( "dotenv");
const { ObjectId } = require("mongodb");
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')
const nodemailer = require('nodemailer')


dotenv.config();

const app = express();
const PORT = 3000;

// allow requests from frontend and allow cookies for refresh token
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
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


const JWT_SECRET = process.env.JWT_SECRET 
const REFRESH_TOKEN_DAYS = parseInt(process.env.REFRESH_TOKEN_DAYS || '7', 10)
const REFRESH_TOKEN_TTL = REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000 // ms

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



let db; // we'll store our database reference here

async function connectDB() {
  try {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db(process.env.DB_NAME); // connect to the right DB
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  }
}




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
    console.error("Registration error", err);
    return res.status(500).json({ message: "Internal server error" });
  }
});

async function sendVerificationEmail(email, username, code) {
  const host = 'smtp.gmail.com'
  const port = parseInt(process.env.MAILTRAP_PORT || '587', 10)
  const user = "rajadithyam@gmail.com"
  const pass = process.env.MAILTRAP_PASS

  if (!(host && user && pass)) {
    console.log('Mailtrap SMTP env vars missing; skipping send')
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
        res.setHeader('Set-Cookie', `refreshToken=${encodeURIComponent(newToken)}; HttpOnly; Path=/; Max-Age=${Math.floor(REFRESH_TOKEN_TTL/1000)}${process.env.NODE_ENV==='production'?'; Secure':''}; SameSite=Lax`)
  return res.status(200).json({ accessToken, user: { id: user.id, username: user.username, email: user.email, roles: user.roles } })
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
  
      res.setHeader('Set-Cookie', `refreshToken=${encodeURIComponent(refreshToken)}; HttpOnly; Path=/; Max-Age=${Math.floor(REFRESH_TOKEN_TTL/1000)}${process.env.NODE_ENV==='production'?'; Secure':''}; SameSite=Lax`);
  
      return res.status(200).json({ accessToken, user: { username: user.username, id: user.id, email: user.email, roles: user.roles } });
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
        res.setHeader('Set-Cookie', `refreshToken=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${process.env.NODE_ENV==='production'?'; Secure':''}`)
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
        createdAt: new Date(),
        comment : [],
        likes: [],
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
      const following = await db.collection('users').findOne({ id: userId }, { projection: { following: 1 } });
      const ids = [...following.following, userId]
      const posts = await db.collection('posts').find({ userId: { $in: ids } }).sort({ createdAt: -1 }).toArray();
      return res.status(200).json(posts);
    } catch (err) {
      console.error('Error fetching posts', err);
      return res.status(500).json({ message: 'Failed to fetch posts' });
    }
});








connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
