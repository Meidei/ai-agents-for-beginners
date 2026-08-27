'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const biwenger = require('./biwengerClient');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    name: 'biwenger.sid',
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60, // 1 hour
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.token) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  next();
}

// Log in with Biwenger credentials. The password is used once to obtain a
// token and is never stored (not in the session, not on disk, not logged).
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const token = await biwenger.login(email, password);
    const leagues = await biwenger.getAccount(token);
    req.session.token = token;
    res.json({ leagues });
  } catch (err) {
    res.status(err.status === 401 || err.status === 403 ? 401 : 502).json({
      error: err.message || 'Could not log in to Biwenger.',
    });
  }
});

// Temporary debug helper: shows exactly what Biwenger's /account endpoint
// returns, to diagnose cases where leagues aren't being found.
app.get('/api/debug/account', requireAuth, async (req, res) => {
  try {
    const raw = await biwenger.getAccountRaw(req.session.token);
    res.json(raw);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/leagues', requireAuth, async (req, res) => {
  try {
    const leagues = await biwenger.getAccount(req.session.token);
    res.json({ leagues });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/team', requireAuth, async (req, res) => {
  const { leagueId, userId } = req.query;
  if (!leagueId || !userId) {
    return res.status(400).json({ error: 'leagueId and userId query params are required.' });
  }

  try {
    const team = await biwenger.getTeam(req.session.token, leagueId, userId);
    res.json({ team });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/team/download', requireAuth, async (req, res) => {
  const { leagueId, userId, format = 'json' } = req.query;
  if (!leagueId || !userId) {
    return res.status(400).json({ error: 'leagueId and userId query params are required.' });
  }

  try {
    const team = await biwenger.getTeam(req.session.token, leagueId, userId);

    if (format === 'csv') {
      const players = Array.isArray(team.players) ? team.players : [];
      const csv = toCsv(players);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="biwenger-team.csv"');
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="biwenger-team.json"');
    res.send(JSON.stringify(team, null, 2));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Converts an array of (possibly nested) objects into a flat CSV. Nested
// objects/arrays are serialized to JSON within their cell so no data is lost
// even if Biwenger's response shape changes.
function toCsv(items) {
  if (!items.length) return '';

  const columns = [...new Set(items.flatMap((item) => Object.keys(item)))];
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const header = columns.map(escape).join(',');
  const rows = items.map((item) => columns.map((col) => escape(item[col])).join(','));
  return [header, ...rows].join('\n');
}

app.listen(PORT, () => {
  console.log(`Biwenger app running at http://localhost:${PORT}`);
});
