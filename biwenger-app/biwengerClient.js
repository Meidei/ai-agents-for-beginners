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

// The list of market listings has been observed under different keys
// depending on account/league type. Try the known candidates before
// giving up.
function extractMarketItems(data) {
  if (Array.isArray(data)) return data;
  const candidates = [
    data && data.sales,
    data && data.players,
    data && data.data && Array.isArray(data.data) && data.data,
    data && data.data && data.data.sales,
    data && data.market && data.market.sales,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

/** Lists the players currently on the transfer market for a league. */
async function getMarket(token, leagueId, userId) {
  const data = await getMarketRaw(token, leagueId, userId);
  const items = extractMarketItems(data);

  if (!items.length) {
    console.warn(
      '[biwenger] No market listings found. Raw payload for debugging:\n',
      JSON.stringify(data, null, 2)
    );
  }

  return items;
}

// The list of bids/offers on a single market listing has been observed
// under different keys. Try the known candidates before giving up.
function extractBids(item) {
  const candidates = [item.offers, item.bids, item.requests, item.sale && item.sale.offers];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractPlayerInfo(item) {
  const player = item.player || item.playerMaster || item;
  return {
    playerId: player.id,
    playerName: player.name,
  };
}

// The bidder is embedded under different keys depending on listing type
// (free agent vs. player put up for sale by another manager).
function extractBidder(bid) {
  const candidates = [bid.from, bid.user, bid.manager, bid.by, bid.owner];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') return candidate;
  }
  return null;
}

function extractAmount(bid) {
  if (bid.amount !== undefined) return bid.amount;
  if (bid.price !== undefined) return bid.price;
  if (bid.value !== undefined) return bid.value;
  return undefined;
}

function extractDate(bid) {
  return bid.date || bid.createdAt || bid.timestamp || bid.until;
}

/** Lists every bid/offer placed on each market listing, with who placed it. */
async function getMarketBids(token, leagueId, userId) {
  const items = await getMarket(token, leagueId, userId);

  const rows = [];
  for (const item of items) {
    const bids = extractBids(item);
    if (!bids.length) continue;

    const { playerId, playerName } = extractPlayerInfo(item);
    for (const bid of bids) {
      const bidder = extractBidder(bid);
      rows.push({
        playerId,
        playerName,
        bidAmount: extractAmount(bid),
        bidderId: bidder && bidder.id,
        bidderName: bidder && (bidder.name || bidder.userName),
        date: extractDate(bid),
      });
    }
  }

  if (items.length && !rows.length) {
    console.warn(
      '[biwenger] Market listings found but no bids could be extracted from them. ' +
        'Raw first listing for debugging:\n',
      JSON.stringify(items[0], null, 2)
    );
  }

  return rows;
}

module.exports = {
  login,
  getAccount,
  getAccountRaw,
  getTeam,
  getMarket,
  getMarketRaw,
  getMarketBids,
};
