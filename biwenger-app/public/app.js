'use strict';

const loginSection = document.getElementById('login-section');
const leagueSection = document.getElementById('league-section');
const teamSection = document.getElementById('team-section');
const loginError = document.getElementById('login-error');

let currentLeague = null; // { id, userId }

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await postJson('/api/login', { email, password });
    renderLeagues(res.leagues);
    loginSection.classList.add('hidden');
    leagueSection.classList.remove('hidden');
  } catch (err) {
    loginError.textContent = err.message;
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.reload();
});

function renderLeagues(leagues) {
  const wrap = document.getElementById('leagues');
  wrap.innerHTML = '';

  if (!leagues.length) {
    wrap.textContent = 'No se encontraron ligas asociadas a esta cuenta.';
    return;
  }

  leagues.forEach((league) => {
    const row = document.createElement('div');
    row.className = 'league-option';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(league.name)}</strong><br />
        <span class="hint">${escapeHtml(league.competition || '')} &middot; equipo: ${escapeHtml(league.teamName || '')}</span>
      </div>
    `;
    const btn = document.createElement('button');
    btn.textContent = 'Cargar equipo';
    btn.addEventListener('click', () => loadTeam(league.id, league.userId));
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

async function loadTeam(leagueId, userId) {
  currentLeague = { id: leagueId, userId };
  const res = await getJson(`/api/team?leagueId=${leagueId}&userId=${userId}`);
  renderTeam(res.team);
  teamSection.classList.remove('hidden');
  teamSection.scrollIntoView({ behavior: 'smooth' });
}

function renderTeam(team) {
  const summary = document.getElementById('team-summary');
  const tableWrap = document.getElementById('team-table-wrap');

  const players = Array.isArray(team.players) ? team.players : [];
  summary.innerHTML = `
    <p><strong>${escapeHtml(team.name || 'Tu equipo')}</strong> &mdash; ${players.length} jugadores</p>
  `;

  if (!players.length) {
    tableWrap.innerHTML = '<pre>' + escapeHtml(JSON.stringify(team, null, 2)) + '</pre>';
    return;
  }

  const field = (item, ...names) => {
    for (const n of names) {
      if (item[n] !== undefined) return item[n];
      if (item.player && item.player[n] !== undefined) return item.player[n];
      if (item.playerMaster && item.playerMaster[n] !== undefined) return item.playerMaster[n];
    }
    return '';
  };

  const rows = players
    .map((p) => {
      const name = field(p, 'name');
      const position = field(p, 'position', 'positionName');
      const price = field(p, 'price', 'marketValue');
      const points = field(p, 'points', 'fantasyPoints');
      return `<tr>
        <td>${escapeHtml(String(name))}</td>
        <td>${escapeHtml(String(position))}</td>
        <td>${escapeHtml(String(price))}</td>
        <td>${escapeHtml(String(points))}</td>
      </tr>`;
    })
    .join('');

  tableWrap.innerHTML = `
    <table>
      <thead><tr><th>Jugador</th><th>Posición</th><th>Valor</th><th>Puntos</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

document.getElementById('download-json').addEventListener('click', () => download('json'));
document.getElementById('download-csv').addEventListener('click', () => download('csv'));

function download(format) {
  if (!currentLeague) return;
  const url = `/api/team/download?leagueId=${currentLeague.id}&userId=${currentLeague.userId}&format=${format}`;
  window.location.href = url;
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error inesperado.');
  return data;
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error inesperado.');
  return data;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
