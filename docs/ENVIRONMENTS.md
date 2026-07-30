# Environment profiles

Config is chosen by environment variable, never by editing code. There are no
commented-out URLs to toggle — if you find yourself editing a source file to change an
environment, something is wrong.

## The three profiles

| Profile | Command | Frontend runs on | Talks to | Database |
| --- | --- | --- | --- | --- |
| **local** | `npm run dev:web` | `localhost:5173` | local backend via Vite proxy | whatever `backend/.env` points at |
| **remote** | `npm run dev:web:remote` | `localhost:5173` | deployed Heroku backend | **production** |
| **production** | `npm run build:web` | Vercel | deployed Heroku backend | production |

The backend is started separately with `npm run dev:api` (watch mode) or
`npm start` (plain).

## Which file sets what

Vite picks the file from the mode automatically — `.env.development` for `dev`,
`.env.production` for `build`, `.env.remote` for `--mode remote`.

```
frontend/.env.development   VITE_BACKEND_BASE=          (empty -> use the proxy)
                            DEV_PROXY_TARGET=http://localhost:3000
frontend/.env.remote        VITE_BACKEND_BASE=https://chitter-backend-app-…herokuapp.com
frontend/.env.production    VITE_BACKEND_BASE=https://chitter-backend-app-…herokuapp.com
frontend/.env.local         your personal overrides — gitignored, wins over all of the above
```

These three files hold only public config (a backend URL, a proxy target), which is why
they are committed. Secrets live in `backend/.env`, which is gitignored — see
`backend/.env.example`.

Only `VITE_`-prefixed variables reach the browser bundle. `DEV_PROXY_TARGET` has no
prefix, so it is read by `vite.config.js` alone and never shipped to the client.

## Why `local` uses a proxy instead of an absolute URL

With `VITE_BACKEND_BASE` empty, requests stay relative (`/api/posts`) and Vite's dev
server forwards them to `DEV_PROXY_TARGET`. The browser therefore only ever talks to
`localhost:5173`, so the refresh-token cookie is **same-site** and needs no
`Secure` / `SameSite=None` handling. Pointing the frontend straight at
`http://localhost:3000` would make it cross-site and reintroduce cookie problems.

## Using the `remote` profile

`npm run dev:web:remote` points your local dev server at the real deployed backend and
the real database. Two things must be true on Heroku for it to work, because these
requests are now cross-site:

```bash
# 1. localhost must be an allowed origin
heroku config:set -a chitter-backend-app \
  FRONTEND_ORIGIN='https://chitter1.vercel.app,http://localhost:5173'

# 2. NODE_ENV=production, so the refresh cookie is sent SameSite=None; Secure
heroku config:set -a chitter-backend-app NODE_ENV=production
```

Two cautions:

- **This writes to the production database.** Posts, follows, and deletes are real.
- Allowing `http://localhost:5173` in production CORS is a small, deliberate loosening.
  It only matters to an attacker who can already run code on a user's machine, but if
  you would rather not carry it permanently, drop `localhost` from `FRONTEND_ORIGIN`
  and re-add it only while you need this profile.

## Flipping the backend's own config

`ENV_FILE` selects which env file `backend/index.js` loads, resolved relative to
`backend/`. To run a local server against the production database:

```bash
cp backend/.env backend/.env.proddb   # then edit MONGODB_URI in the copy
ENV_FILE=.env.proddb npm run dev:api
```

`.env.proddb` matches the `.env.*` ignore rule, so it will not be committed.

On Heroku no `.env` file exists, so `dotenv` no-ops and the platform's real config vars
are used. Nothing extra is needed there.

## Knowing which profile you are on

The backend prints its active profile at startup, so you can confirm before you type
anything destructive. The Mongo credential is never printed — only the host:

```
──────────────────────────────────────────────
  env file    : .env
  NODE_ENV    : development
  database    : twitter_clone @ cluster0.jsqojaf.mongodb.net
  CORS allow  : http://localhost:5173
  SMTP        : you@example.com via smtp.gmail.com
──────────────────────────────────────────────
Server running on http://localhost:3000
```

For the frontend, check the Network tab: request URLs are relative in `local` mode and
absolute `https://…herokuapp.com` in `remote` mode.

## Required deployed config

Neither host has a usable default — `FRONTEND_ORIGIN` falls back to `localhost:5173`,
which would block the real frontend.

**Heroku (backend):**

```
MONGODB_URI, DB_NAME, JWT_SECRET      required — the server exits at boot without them
FRONTEND_ORIGIN=https://chitter1.vercel.app
NODE_ENV=production
SMTP_USER, SMTP_PASS                  verification email is skipped if unset
AWS_BUCKET_NAME, AWS_BUCKET_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
```

**Vercel (frontend):**

```
VITE_BACKEND_BASE=https://chitter-backend-app-4c5e1318fbab.herokuapp.com
```

A value set in the Vercel dashboard overrides `.env.production`, so the dashboard stays
the source of truth for the real deploy.
