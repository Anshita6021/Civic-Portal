'use strict';
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === 'production';
const DB_PATH = path.join(__dirname, 'data', 'civic-portal.sqlite');
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new sqlite3.Database(DB_PATH);

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes }); }));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  name: 'civic.sid',
  secret: process.env.SESSION_SECRET || 'development-only-change-this-session-secret-please',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 1000 * 60 * 60 * 8 }
}));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use(express.static(path.join(__dirname, 'public')));

const publicUser = user => ({ id: user.id, name: user.name, email: user.email, role: user.role, department: user.department || null, createdAt: user.created_at });
const requireAuth = (req, res, next) => req.session.user ? next() : res.status(401).json({ error: 'Please sign in to continue.' });
const requireRole = (...roles) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Please sign in to continue.' });
  if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'You do not have permission to do that.' });
  next();
};
const safeText = (value, max = 5000) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const makeId = prefix => `${prefix}-${crypto.randomUUID()}`;

async function initializeDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'citizen' CHECK(role IN ('citizen','officer','admin')),
    department TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
    status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','in_progress','resolved','rejected')),
    location TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', reporter_id TEXT NOT NULL,
    assigned_officer_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(reporter_id) REFERENCES users(id), FOREIGN KEY(assigned_officer_id) REFERENCES users(id)
  )`);
  await run('CREATE INDEX IF NOT EXISTS idx_issues_created_at ON issues(created_at DESC)');
  await run('CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status)');
  // Safe bootstrap admin: only created when explicitly configured and no matching account exists.
  if (process.env.BOOTSTRAP_ADMIN_EMAIL && process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL.trim().toLowerCase();
    const exists = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (!exists) {
      const hash = await bcrypt.hash(process.env.BOOTSTRAP_ADMIN_PASSWORD, 12);
      await run('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)', [makeId('usr'), 'Portal Administrator', email, hash, 'admin']);
      console.log(`Bootstrap admin created for ${email}`);
    }
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'Civic Connect API', timestamp: new Date().toISOString() }));
app.get('/api/auth/me', (req, res) => res.json({ user: req.session.user || null }));
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = safeText(req.body.name, 100);
    const email = safeText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10) {
      return res.status(400).json({ error: 'Enter a valid name and email. Passwords must be at least 10 characters.' });
    }
    const existing = await get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });
    const passwordHash = await bcrypt.hash(password, 12);
    const user = { id: makeId('usr'), name, email, role: 'citizen', department: null, created_at: new Date().toISOString() };
    await run('INSERT INTO users (id,name,email,password_hash,role) VALUES (?,?,?,?,?)', [user.id, name, email, passwordHash, user.role]);
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = publicUser(user);
      res.status(201).json({ user: req.session.user });
    });
  } catch (err) { next(err); }
});
app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = safeText(req.body.email, 254).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = await get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.user = publicUser(user);
      res.json({ user: req.session.user });
    });
  } catch (err) { next(err); }
});
app.post('/api/auth/logout', (req, res) => req.session.destroy(err => {
  if (err) return res.status(500).json({ error: 'Could not sign out.' });
  res.clearCookie('civic.sid'); res.json({ ok: true });
}));

app.get('/api/stats', async (_req, res, next) => {
  try {
    const [total, resolved, progress, submitted] = await Promise.all([
      get('SELECT COUNT(*) AS count FROM issues'), get("SELECT COUNT(*) AS count FROM issues WHERE status='resolved'"),
      get("SELECT COUNT(*) AS count FROM issues WHERE status='in_progress'"), get("SELECT COUNT(*) AS count FROM issues WHERE status='submitted'")
    ]);
    res.json({ total: total.count, resolved: resolved.count, inProgress: progress.count, submitted: submitted.count });
  } catch (err) { next(err); }
});
app.get('/api/issues', async (req, res, next) => {
  try {
    const user = req.session.user;
    let rows;
    if (user?.role === 'admin') {
      rows = await all(`SELECT i.*, u.name AS reporter_name, o.name AS officer_name FROM issues i JOIN users u ON u.id=i.reporter_id LEFT JOIN users o ON o.id=i.assigned_officer_id ORDER BY i.created_at DESC LIMIT 250`);
    } else if (user?.role === 'officer') {
      rows = await all(`SELECT i.*, u.name AS reporter_name, o.name AS officer_name FROM issues i JOIN users u ON u.id=i.reporter_id LEFT JOIN users o ON o.id=i.assigned_officer_id WHERE i.assigned_officer_id=? ORDER BY i.created_at DESC LIMIT 250`, [user.id]);
    } else if (user) {
      rows = await all(`SELECT i.*, u.name AS reporter_name, o.name AS officer_name FROM issues i JOIN users u ON u.id=i.reporter_id LEFT JOIN users o ON o.id=i.assigned_officer_id WHERE i.reporter_id=? ORDER BY i.created_at DESC LIMIT 100`, [user.id]);
    } else {
      rows = await all(`SELECT id,title,category,priority,status,location,city,created_at,updated_at FROM issues ORDER BY created_at DESC LIMIT 12`);
    }
    res.json({ issues: rows });
  } catch (err) { next(err); }
});
app.post('/api/issues', requireAuth, async (req, res, next) => {
  try {
    const title = safeText(req.body.title, 140), description = safeText(req.body.description, 4000);
    const category = safeText(req.body.category, 60), location = safeText(req.body.location, 240), city = safeText(req.body.city, 100);
    const priority = ['low','medium','high'].includes(req.body.priority) ? req.body.priority : 'medium';
    if (title.length < 5 || description.length < 15 || !category || location.length < 3) return res.status(400).json({ error: 'Add a clear title, a description of at least 15 characters, a category and a location.' });
    const issue = { id: makeId('ISS'), title, description, category, priority, status: 'submitted', location, city, reporter_id: req.session.user.id };
    await run('INSERT INTO issues (id,title,description,category,priority,status,location,city,reporter_id) VALUES (?,?,?,?,?,?,?,?,?)', [issue.id,title,description,category,priority,'submitted',location,city,issue.reporter_id]);
    io.emit('issues:changed', { type: 'created', id: issue.id });
    res.status(201).json({ issue });
  } catch (err) { next(err); }
});
app.patch('/api/issues/:id/status', requireRole('officer','admin'), async (req, res, next) => {
  try {
    const status = req.body.status;
    if (!['submitted','in_progress','resolved','rejected'].includes(status)) return res.status(400).json({ error: 'Invalid issue status.' });
    const issue = await get('SELECT * FROM issues WHERE id=?', [req.params.id]);
    if (!issue) return res.status(404).json({ error: 'Issue not found.' });
    if (req.session.user.role === 'officer' && issue.assigned_officer_id !== req.session.user.id) return res.status(403).json({ error: 'You can only update issues assigned to you.' });
    await run('UPDATE issues SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', [status, req.params.id]);
    io.emit('issues:changed', { type: 'status', id: req.params.id, status });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
app.get('/api/officers', requireRole('admin'), async (_req, res, next) => {
  try { res.json({ officers: await all("SELECT id,name,email,department,created_at FROM users WHERE role='officer' ORDER BY name") }); }
  catch (err) { next(err); }
});
app.post('/api/officers', requireRole('admin'), async (req, res, next) => {
  try {
    const name = safeText(req.body.name, 100), email = safeText(req.body.email, 254).toLowerCase();
    const department = safeText(req.body.department, 100), password = typeof req.body.password === 'string' ? req.body.password : '';
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || !department) return res.status(400).json({ error: 'Provide name, valid email, department and a password of at least 10 characters.' });
    const hash = await bcrypt.hash(password, 12), id = makeId('usr');
    await run("INSERT INTO users (id,name,email,password_hash,role,department) VALUES (?,?,?,?, 'officer', ?)", [id,name,email,hash,department]);
    io.emit('officers:changed', { type: 'created' }); res.status(201).json({ officer: { id,name,email,department } });
  } catch (err) { if (String(err.message).includes('UNIQUE')) return res.status(409).json({ error: 'An account with this email already exists.' }); next(err); }
});
app.patch('/api/issues/:id/assign', requireRole('admin'), async (req, res, next) => {
  try {
    const officer = await get("SELECT id FROM users WHERE id=? AND role='officer'", [req.body.officerId]);
    if (!officer) return res.status(400).json({ error: 'Choose a valid officer.' });
    const result = await run("UPDATE issues SET assigned_officer_id=?, status='in_progress', updated_at=CURRENT_TIMESTAMP WHERE id=?", [officer.id, req.params.id]);
    if (!result.changes) return res.status(404).json({ error: 'Issue not found.' });
    io.emit('issues:changed', { type: 'assigned', id: req.params.id }); res.json({ ok: true });
  } catch (err) { next(err); }
});
app.get('/api/users', requireRole('admin'), async (_req, res, next) => {
  try { res.json({ users: await all('SELECT id,name,email,role,department,created_at FROM users ORDER BY created_at DESC LIMIT 500') }); }
  catch (err) { next(err); }
});

const civicAnswers = [
  { keys: ['report','submit','complaint','issue','शिकायत','रिपोर्ट'], answer: 'Sign in or create a citizen account, choose “Report an issue”, describe the problem, select a category and add a precise location. You can then follow its status in your dashboard.' },
  { keys: ['status','track','tracking','track my','स्थिति','ट्रैक'], answer: 'Open your dashboard after signing in to see the issues you submitted and their latest status: Submitted, In progress, Resolved or Rejected.' },
  { keys: ['account','register','signup','sign up','पासवर्ड','खाता'], answer: 'Choose Sign in → Create account. Citizen accounts are self-service. Officer accounts should be provisioned by an authorized administrator.' },
  { keys: ['urgent','emergency','danger','life threatening','आपातकाल'], answer: 'This portal is not an emergency service. If there is immediate danger, contact your local emergency services directly.' },
  { keys: ['privacy','data','personal','गोपनीयता'], answer: 'Share only the information needed to describe the civic issue. Do not post passwords, identity numbers or other sensitive personal data in a report.' }
];
app.post('/api/chat', async (req, res) => {
  const message = safeText(req.body.message, 1500);
  if (message.length < 1) return res.status(400).json({ error: 'Please enter a message.' });
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'X-Title': 'Civic Connect Portal' },
        body: JSON.stringify({ model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-8b-instruct:free', messages: [
          { role: 'system', content: 'You are Civic Connect, a concise assistant for a civic issue reporting demo in India. Explain portal workflows and general civic reporting guidance. Never claim to be a government official or promise that a complaint was filed. For emergencies, tell the user to contact emergency services. Do not request sensitive personal data.' },
          { role: 'user', content: message }
        ], max_tokens: 350 })
      });
      if (response.ok) { const data = await response.json(); const answer = data?.choices?.[0]?.message?.content; if (answer) return res.json({ answer, source: 'assistant' }); }
    } catch (e) { console.error('Optional chatbot provider unavailable:', e.message); }
  }
  const lower = message.toLowerCase();
  const match = civicAnswers.find(item => item.keys.some(key => lower.includes(key)));
  res.json({ answer: match ? match.answer : 'I can help with reporting a civic issue, tracking its status, account access and privacy. Tell me which step you need help with. For emergencies, contact local emergency services directly.', source: 'built-in-guidance' });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => err && next(err));
});
app.use((err, _req, res, _next) => {
  console.error(err.stack || err);
  res.status(500).json({ error: isProduction ? 'Something went wrong. Please try again.' : err.message });
});

initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Civic Connect running at http://localhost:${PORT}`);
    if (isProduction && !process.env.SESSION_SECRET) console.warn('WARNING: Set SESSION_SECRET in production.');
  });
}).catch(err => { console.error('Database initialization failed:', err); process.exit(1); });

process.on('SIGINT', () => { server.close(() => db.close(() => process.exit(0))); });
