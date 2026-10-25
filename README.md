# Civic Connect Portal

A responsive civic issue reporting and tracking demo built with Node.js, Express, SQLite, sessions and Socket.IO. The interface uses a fixed light palette, a manually controlled/auto-advancing hero slider, a civic guidance chatbot, public community updates, citizen reporting, and role-based officer/admin workspaces.

> **Important:** Civic Connect is an independent portfolio/demo project, not an official government website or government service. Do not use it to submit real emergencies or sensitive personal information. Reports in a deployed instance are not official complaints unless an authorized agency separately integrates and operates the service.

## Features

- Responsive, accessible UI with a static navy/teal/cream palette and minimal, uncluttered backgrounds.
- Hero slider with previous/next controls, slide dots and automatic rotation.
- Public statistics and recent report cards, with status filters.
- Citizen registration and sign-in with bcrypt password hashing and server-side sessions.
- Citizens can create reports and view their own reports.
- Officers can view reports assigned to them and update status.
- Admins can view all reports, assign reports to officers, create officer accounts and review the officer directory.
- SQLite schema initialization is non-destructive: tables are created if missing; existing tables are not dropped on startup.
- Socket.IO refresh events, input validation, authentication rate limiting, Helmet security headers, and a server-side optional AI provider.
- Chatbot works with built-in civic guidance even when no AI provider key is configured.

## Requirements

- Node.js 20 or later
- npm

## Run locally

```bash
npm install
cp .env.example .env
```

Edit `.env` and set a long, random `SESSION_SECRET`. Then start the server:

```bash
npm run dev
# or: npm start
```

Open <http://localhost:4000>.

The SQLite database is created at `data/civic-portal.sqlite` on first run. The database directory is ignored by Git. **Do not commit a database containing user data.**

## Create an administrator account

The public registration route deliberately creates citizen accounts only. To bootstrap the first administrator, temporarily set these environment variables before starting the server for the first time:

```dotenv
BOOTSTRAP_ADMIN_EMAIL=admin@example.test
BOOTSTRAP_ADMIN_PASSWORD=use-a-long-unique-password-here
```

The server creates this account only if that email does not already exist. Remove the bootstrap password from the deployment environment after the account is created. Do not use the sample values above as real credentials. Administrators can then create officer accounts in the workspace. Never publish credentials in GitHub issues, source code or screenshots.

## Optional AI chatbot

Without `OPENROUTER_API_KEY`, the assistant uses a small set of built-in civic help responses. To enable model responses, add the key only to the server environment (never to frontend JavaScript):

```dotenv
OPENROUTER_API_KEY=your-server-side-key
OPENROUTER_MODEL=meta-llama/llama-3.3-8b-instruct:free
```

The provider/model may be unavailable or have usage limits. The assistant is guidance only; it does not file reports on a user's behalf.

## Roles and permissions

| Action | Visitor | Citizen | Officer | Admin |
|---|---:|---:|---:|---:|
| View recent public reports and aggregate counts | Yes | Yes | Yes | Yes |
| Submit a report | No | Yes | No | No |
| View personal reports | No | Yes | — | — |
| View assigned reports | No | No | Yes | Yes |
| Update issue status | No | No | Assigned reports only | Yes |
| Assign reports to officers | No | No | No | Yes |
| Create officer accounts / view user directory | No | No | No | Yes |

## Deployment checklist

This is a starter suitable for a portfolio deployment. Before collecting real data or claiming operational government use, an owner must:

1. Use HTTPS and a strong, unique `SESSION_SECRET`.
2. Configure a persistent disk/volume for `data/civic-portal.sqlite`; ephemeral deployment filesystems lose SQLite data on redeploy/restart.
3. Replace Express's default in-memory session store with a persistent production session store (for example, a Redis-backed store).
4. Configure `cookie.secure`, trusted proxy settings, CORS/origin policy and CSRF protection for the chosen deployment topology.
5. Add monitoring, backups, retention rules, a published privacy policy and incident-response procedures.
6. Have an authorized service owner review legal, accessibility, language, data-protection and operational requirements.
7. Keep API keys and bootstrap credentials in the hosting provider's secret manager. Rotate any credential that has ever been committed or exposed.

### Example: Render / Node host

- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Set `NODE_ENV=production` and `SESSION_SECRET` in environment variables.
- Attach a persistent disk mounted so the app's `data/` directory persists, or set up a managed database before relying on the deployment.

Do not deploy the default in-memory session store for a production service with real users. This repository makes the demo convenient to run, but a persistent session store and a persistent database volume are production deployment requirements.

## Project layout

```text
civic-portal-final/
├── public/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── data/                 # created at runtime; not committed
├── server.js
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Testing

```bash
npm test
```

The current automated checks validate core source syntax and key security/structure expectations. Also manually test registration, sign-in/out, citizen report creation, officer status updates, admin assignment and access restrictions before publicizing a deployment.

## License

MIT. See `LICENSE`.
