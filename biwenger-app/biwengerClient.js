// Thin client around Biwenger's unofficial web API.
// There is no official public API/SDK for Biwenger, this reverse-engineers
// the same requests the biwenger.as.com web app makes from the browser.
'use strict';

const BASE_URL = 'https://biwenger.as.com/api/v2';

// Biwenger rejects requests without a plausible client version/user-agent.
const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'X-Version': '665',
  'X-Lang': 'es',
  'User-Agent': 'Mozilla/5.0 (compatible; biwenger-app/1.0)',
};

async function biwengerFetch(path, { method = 'GET', token, league, user, body } = {}) {
  const headers = { ...COMMON_HEADERS };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (league) headers['X-League'] = String(league);
  if (user) headers['X-User'] = String(user);

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page from Biwenger (e.g. rate limiting, maintenance).
  }

  if (!res.ok) {
    const message = (data && (data.message || data.error)) || `Biwenger request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return data;
}

/** Logs in with Biwenger credentials and returns the session token. */
async function login(email, password) {
  const data = await biwengerFetch('/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  const token = data && data.token;
  if (!token) {
    throw new Error('Login succeeded but Biwenger did not return a token.');
  }
  return token;
}

/** Fetches the raw, unparsed /account payload — useful for debugging when
 * Biwenger's (undocumented) response shape doesn't match what we expect. */
async function getAccountRaw(token) {
  return biwengerFetch('/account', { token });
}

/** Lists the leagues (and the user id within each) available to this account. */
async function getAccount(token) {
  const data = await getAccountRaw(token);

  // Biwenger's /account shape isn't documented and has been observed to vary
  // (leagues at the top level vs. nested under a wrapper). Try the known
  // candidates before giving up.
  const leagues =
    (data && Array.isArray(data.leagues) && data.leagues) ||
    (data && data.data && Array.isArray(data.data.leagues) && data.data.leagues) ||
    (data && data.account && Array.isArray(data.account.leagues) && data.account.leagues) ||
    [];

  if (!leagues.length) {
    console.warn(
      '[biwenger] No leagues found in /account response. Raw payload for debugging:\n',
      JSON.stringify(data, null, 2)
    );
  }

  return leagues.map((l) => ({
    id: l.id,
    name: l.name,
    competition: l.competition && l.competition.name,
    userId: l.user && l.user.id,
    teamName: l.user && l.user.name,
  }));
}

/** Fetches the full squad/team data for the given league + user. */
async function getTeam(token, leagueId, userId) {
  const data = await biwengerFetch(`/user?fields=*,players`, {
    token,
    league: leagueId,
    user: userId,
  });
  return data;
}

/** Fetches the raw, unparsed /market payload for a league. */
async function getMarketRaw(token, leagueId, userId) {
  return biwengerFetch('/market', { token, league: leagueId, user: userId });
}

// Biwenger wraps the market payload as { status, data: { sales, offers, ... } }
// but that wrapping depth has been observed to vary. Find the object that
// actually holds `sales`/`offers`, checking the raw payload itself and one
// or two levels of `.data` nesting.
function findMarketPayload(raw) {
  const candidates = [raw, raw && raw.data, raw && raw.data && raw.data.data];
  for (const candidate of candidates) {
    if (candidate && (Array.isArray(candidate.sales) || Array.isArray(candidate.offers))) {
      return candidate;
    }
  }
  return {};
}

function toIso(epochSeconds) {
  if (!epochSeconds && epochSeconds !== 0) return undefined;
  return new Date(epochSeconds * 1000).toISOString();
}

/** Lists the players currently on the transfer market for a league
 * (both free-agent listings and clause buyouts other managers put up). */
async function getMarket(token, leagueId, userId, competition = 'la-liga') {
  const raw = await getMarketRaw(token, leagueId, userId);
  const payload = findMarketPayload(raw);
  const sales = Array.isArray(payload.sales) ? payload.sales : [];

  if (!sales.length) {
    console.warn(
      '[biwenger] No market listings (sales) found. Raw payload for debugging:\n',
      JSON.stringify(raw, null, 2)
    );
  }

  const db = await getPlayerDatabase(token, competition);
  for (const sale of sales) {
    if (sale.player) enrichPlayer(sale.player, db);
  }

  return sales;
}

/**
 * Lists every bid/offer placed on the market, with who placed it.
 *
 * Biwenger returns bids as a top-level `offers` array (sibling to `sales`,
 * not nested inside each listing). Each offer carries `requestedPlayers`
 * (the player id(s) it targets) and `from` (the bidder) — so bids are
 * cross-referenced against `sales` by player id to attach the asking price.
 * Biwenger's /market response doesn't include player names, only ids.
 */
async function getMarketBids(token, leagueId, userId, competition = 'la-liga') {
  const raw = await getMarketRaw(token, leagueId, userId);
  const payload = findMarketPayload(raw);
  const sales = Array.isArray(payload.sales) ? payload.sales : [];
  const offers = Array.isArray(payload.offers) ? payload.offers : [];

  const saleByPlayerId = new Map();
  for (const sale of sales) {
    const playerId = sale.player && sale.player.id;
    if (playerId !== undefined) saleByPlayerId.set(playerId, sale);
  }

  const db = await getPlayerDatabase(token, competition);

  const rows = [];
  for (const offer of offers) {
    const requestedPlayers = Array.isArray(offer.requestedPlayers) ? offer.requestedPlayers : [];
    const bidder = offer.from || null;

    for (const playerId of requestedPlayers) {
      const sale = saleByPlayerId.get(playerId);
      const player = { id: playerId };
      enrichPlayer(player, db);
      rows.push({
        playerId,
        playerName: player.name,
        teamName: player.team,
        askingPrice: sale ? sale.price : undefined,
        bidAmount: offer.amount,
        bidderId: bidder && bidder.id,
        bidderName: bidder && bidder.name,
        status: offer.status,
        type: offer.type,
        date: toIso(offer.created),
        until: toIso(offer.until),
      });
    }
  }

  if (offers.length && !rows.length) {
    console.warn(
      '[biwenger] Offers found but none referenced a player via requestedPlayers. ' +
        'Raw offers for debugging:\n',
      JSON.stringify(offers, null, 2)
    );
  } else if (!offers.length) {
    console.warn(
      '[biwenger] No offers found in /market response. Raw payload for debugging:\n',
      JSON.stringify(raw, null, 2)
    );
  }

  return rows;
}

/** Fetches the raw, unparsed player/team database for a competition (e.g.
 * "la-liga"). This is where player names and team names live — the /market
 * and /user endpoints only return player ids. */
async function getCompetitionPlayersRaw(token, competition = 'la-liga') {
  return biwengerFetch(`/competitions/${competition}/data?fields=id,name,players,teams`, { token });
}

// Same wrapping uncertainty as the market payload — find the object that
// actually holds `players`/`teams`.
function findPlayersPayload(raw) {
  const candidates = [raw, raw && raw.data, raw && raw.data && raw.data.data];
  for (const candidate of candidates) {
    if (candidate && (candidate.players || candidate.teams)) return candidate;
  }
  return {};
}

// Biwenger returns both `players` and `teams` as objects keyed by id
// (confirmed for players against a real payload) rather than arrays.
// Handle both shapes defensively.
function normalizeDict(value) {
  const map = new Map();
  if (!value) return map;

  const entries = Array.isArray(value) ? value.map((item, i) => [i, item]) : Object.entries(value);
  for (const [key, item] of entries) {
    if (!item || typeof item !== 'object') continue;
    const id = item.id !== undefined ? item.id : Number(key);
    map.set(id, item);
  }
  return map;
}

const playerDbCache = new Map(); // competition slug -> { players, teams }

/** Fetches (and caches, per server process) the player/team lookup for a
 * competition. Degrades gracefully — if the competition slug is wrong or
 * the request fails, logs a warning and returns empty maps instead of
 * breaking the caller (market/bids still work, just without names). */
async function getPlayerDatabase(token, competition = 'la-liga') {
  if (playerDbCache.has(competition)) return playerDbCache.get(competition);

  let players = new Map();
  let teams = new Map();
  try {
    const raw = await getCompetitionPlayersRaw(token, competition);
    const payload = findPlayersPayload(raw);
    players = normalizeDict(payload.players);
    teams = normalizeDict(payload.teams);

    if (!players.size) {
      console.warn(
        `[biwenger] Competition "${competition}" data had no players. Raw payload for debugging:\n`,
        JSON.stringify(raw, null, 2)
      );
    } else if (!teams.size) {
      console.warn(
        `[biwenger] Competition "${competition}" data had players but no teams — team names won't resolve. ` +
          'Raw payload for debugging:\n',
        JSON.stringify(raw, null, 2)
      );
    }
  } catch (err) {
    console.warn(
      `[biwenger] Could not fetch competition "${competition}" player database (${err.message}). ` +
        'Player/team names will be unavailable.'
    );
  }

  const db = { players, teams };
  playerDbCache.set(competition, db);
  return db;
}

/** Mutates a `{ id }` player reference in place, adding `name` and `team`
 * (team name) from the player database when available. */
function enrichPlayer(player, db) {
  const info = db.players.get(player.id);
  if (!info) return;
  player.name = info.name;
  const team = db.teams.get(info.teamID);
  player.team = team ? team.name : undefined;
}

module.exports = {
  login,
  getAccount,
  getAccountRaw,
  getTeam,
  getMarket,
  getMarketRaw,
  getMarketBids,
  getCompetitionPlayersRaw,
};
