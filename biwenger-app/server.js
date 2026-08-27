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

// Temporary debug helper: shows the raw player/team database for a
// competition, to find where player names and team names live so the
// market/bids views can be enriched with them. Defaults to "la-liga" —
// override with ?competition=slug if that guess is wrong.
app.get('/api/debug/players', requireAuth, async (req, res) => {
  const competition = req.query.competition || 'la-liga';
  try {
    const raw = await biwenger.getCompetitionPlayersRaw(req.session.token, competition);
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

app.get('/api/market', requireAuth, async (req, res) => {
  const { leagueId, userId } = req.query;
  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId query param is required.' });
  }

  try {
    const market = await biwenger.getMarket(req.session.token, leagueId, userId);
    res.json({ market });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Temporary debug helper: shows exactly what Biwenger's /market endpoint
// returns, to diagnose cases where listings aren't being found.
app.get('/api/debug/market', requireAuth, async (req, res) => {
  const { leagueId, userId } = req.query;
  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId query param is required.' });
  }

  try {
    const raw = await biwenger.getMarketRaw(req.session.token, leagueId, userId);
    res.json(raw);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/market/download', requireAuth, async (req, res) => {
  const { leagueId, userId, format = 'json' } = req.query;
  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId query param is required.' });
  }

  try {
    const market = await biwenger.getMarket(req.session.token, leagueId, userId);

    if (format === 'csv') {
      const csv = toCsv(market);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="biwenger-market.csv"');
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="biwenger-market.json"');
    res.send(JSON.stringify(market, null, 2));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/market/bids', requireAuth, async (req, res) => {
  const { leagueId, userId } = req.query;
  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId query param is required.' });
  }

  try {
    const bids = await biwenger.getMarketBids(req.session.token, leagueId, userId);
    res.json({ bids });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/market/bids/download', requireAuth, async (req, res) => {
  const { leagueId, userId, format = 'json' } = req.query;
  if (!leagueId) {
    return res.status(400).json({ error: 'leagueId query param is required.' });
  }

  try {
    const bids = await biwenger.getMarketBids(req.session.token, leagueId, userId);

    if (format === 'csv') {
      const csv = toCsv(bids);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="biwenger-market-bids.csv"');
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="biwenger-market-bids.json"');
    res.send(JSON.stringify(bids, null, 2));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Flattens a nested object into a single-level object with dot-notation
// keys (e.g. { player: { name: 'X' } } -> { 'player.name': 'X' }), so every
// characteristic Biwenger returns becomes its own CSV column instead of
// being buried inside a JSON blob. Arrays are left as-is (and later
// JSON-stringified by `escape`) since they don't map to flat columns.
function flattenObject(obj, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const flatKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flattenObject(value, flatKey, result);
    } else {
      result[flatKey] = value;
    }
  }
  return result;
}

// Converts an array of (possibly nested) objects into a flat CSV. Nested
// objects are flattened into dot-notation columns; arrays are serialized to
// JSON within their cell so no data is lost even if Biwenger's response
// shape changes.
function toCsv(items) {
  if (!items.length) return '';

  const flatItems = items.map((item) => flattenObject(item));
  const columns = [...new Set(flatItems.flatMap((item) => Object.keys(item)))];
  const escape = (value) => {
    if (value === null || value === undefined) return '';
    const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${str.replace(/"/g, '""')}"`;
  };

  const header = columns.map(escape).join(',');
  const rows = flatItems.map((item) => columns.map((col) => escape(item[col])).join(','));
  return [header, ...rows].join('\n');
}

app.listen(PORT, () => {
  console.log(`Biwenger app running at http://localhost:${PORT}`);
});
