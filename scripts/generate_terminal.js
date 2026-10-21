#!/usr/bin/env node
'use strict';

/**
 * Terminal profile card → assets/terminal.svg
 *
 *   GitHub GraphQL (profile + contribution calendar) ─┐
 *                                                     ├─→ animated terminal-style SVG
 *   WakaTime summaries (optional, last 7 days) ───────┘
 *
 * Only public profile fields and aggregate counts are rendered — no repository names,
 * so private work never leaks. The SVG is self-contained (no fonts, scripts or images)
 * and animates with CSS only, which GitHub keeps when it serves the file through <img>.
 *
 * Environment variables
 *   GH_PORTFOLIO_TOKEN / GITHUB_TOKEN   GraphQL token (either works; the profile data is public)
 *   GITHUB_REPOSITORY_OWNER / GH_LOGIN  GitHub login
 *   WAKATIME_API_KEY                    optional; without it the coding-time panel is omitted
 *   TERMINAL_OUTPUT                     output path (default assets/terminal.svg)
 *   GITHUB_GRAPHQL_FIXTURE / WAKATIME_FIXTURE   JSON fixtures for local development
 */

const fs = require('fs');
const path = require('path');
const U = require('./util');
const S = require('./sanitize');
const { fetchWakaTime, computeWakaStats } = require('./wakatime');

const OUTPUT = process.env.TERMINAL_OUTPUT || path.join(__dirname, '..', 'assets', 'terminal.svg');
const { esc, round } = U;

// ───────────────────────────────────────────────────────────────────────────────
// Data
// ───────────────────────────────────────────────────────────────────────────────

const QUERY = `query($login: String!) {
  user(login: $login) {
    login name bio location createdAt
    followers { totalCount }
    publicRepos: repositories(ownerAffiliations: OWNER, privacy: PUBLIC) { totalCount }
    allRepos: repositories(ownerAffiliations: OWNER) { totalCount }
    contributionsCollection {
      totalCommitContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date weekday contributionCount contributionLevel } }
      }
    }
  }
}`;

async function fetchProfile({ token, login, fixture }) {
  if (fixture) return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  if (!token) throw new Error('no GitHub token (GH_PORTFOLIO_TOKEN or GITHUB_TOKEN)');
  if (!login) throw new Error('GitHub login unknown: set GITHUB_REPOSITORY_OWNER');
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'github-profile-terminal' },
        body: JSON.stringify({ query: QUERY, variables: { login } }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
      const body = await res.json();
      if (body.errors && body.errors.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
      if (!body.data || !body.data.user) throw new Error('GraphQL: user not found');
      return body.data.user;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw lastError;
}

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

function computeStats(user, today) {
  const cal = user.contributionsCollection.contributionCalendar;
  const weeks = cal.weeks.map((w) => w.contributionDays.map((d) => ({ ...d, level: LEVEL[d.contributionLevel] || 0 })));
  const days = weeks.flat().filter((d) => d.date <= today);

  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  // Current streak: today may still be empty — then it counts from yesterday.
  let i = days.length - 1;
  if (i >= 0 && days[i].date === today && days[i].contributionCount === 0) i--;
  let current = 0;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;

  const weekly = weeks.slice(-26).map((w) => ({ start: w[0].date, total: U.sum(w.map((d) => d.contributionCount)) }));
  return {
    weeks,
    total: cal.totalContributions,
    commits: user.contributionsCollection.totalCommitContributions,
    activeDays: days.filter((d) => d.contributionCount > 0).length,
    current, longest, weekly,
  };
}

function uptime(createdAt, now) {
  const a = new Date(createdAt);
  let months = (now.getUTCFullYear() - a.getUTCFullYear()) * 12 + (now.getUTCMonth() - a.getUTCMonth());
  if (now.getUTCDate() < a.getUTCDate()) months--;
  const y = Math.floor(months / 12), m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} year${y === 1 ? '' : 's'}`);
  if (m || !y) parts.push(`${m} month${m === 1 ? '' : 's'}`);
  return parts.join(', ');
}

/** "Mobile & Web Developer · Flutter · Dart · … · Offline-first apps …" → role, stack, focus */
function parseBio(bio) {
  const parts = String(bio || '').split(/\s*[·|•]\s*/).map((s) => s.trim()).filter(Boolean);
  const role = parts[0] || '';
  const rest = parts.slice(1);
  const stack = rest.filter((p) => p.length <= 18 && p.split(/\s+/).length <= 2);
  const focus = rest.filter((p) => !stack.includes(p)).join(' · ');
  return { role, stack, focus };
}

function utcOffset(tz) {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return name ? name.value.replace('GMT', 'UTC') : '';
  } catch { return ''; }
}

// ───────────────────────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────────────────────

const W = 900;
const X0 = 40;                                  // content left edge
const MONO = `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace`;
const CH = 7.8;                                 // advance of a 13px monospace glyph; textLength pins it
const C = {
  win: '#0D1117', bar: '#161B22', border: '#30363D', text: '#E6EDF3', muted: '#8B949E', faint: '#6E7681',
  green: '#3FB950', blue: '#58A6FF', panel: '#11161D',
  levels: ['#161B22', '#0E4429', '#006D32', '#26A641', '#39D353'],
};
const LANG = ['#39D353', '#26A641', '#58A6FF', '#D29922', '#BC8CFF', '#6E7681'];

const t = (x, y, str, cls, extra = '') => `<text x="${round(x)}" y="${round(y)}" class="${cls}"${extra ? ` ${extra}` : ''}>${esc(str)}</text>`;
const r = (x, y, w, h, extra = '') => `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" ${extra}/>`;
const fit = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
function wrapWords(str, max) {
  const lines = [''];
  for (const w of String(str).split(/\s+/)) {
    const cur = lines[lines.length - 1];
    if (!cur) lines[lines.length - 1] = w;
    else if (cur.length + 1 + w.length <= max) lines[lines.length - 1] = `${cur} ${w}`;
    else lines.push(w);
  }
  return lines;
}
const delay = (s) => `style="animation-delay:${round(s, 2)}s"`;

/** Prompt line with a typed command (discrete width steps on a clip rect). */
function prompt(id, y, cmd, at, { cursor = false, login = 'linverno' } = {}) {
  const user = `${login}@github`;
  const head = `${user} ~ $ `;
  const x = X0 + head.length * CH;
  const out = [`<g class="fade" ${delay(at)}><text x="${X0}" y="${y}" class="m" textLength="${round((head.length - 1) * CH)}" lengthAdjust="spacing">` +
    `<tspan class="g b">${esc(user)}</tspan> <tspan class="bl b">~</tspan> <tspan class="mu">$</tspan></text></g>`];
  if (cmd) {
    const steps = cmd.length;
    const typeDur = Math.max(0.35, steps * 0.03);
    const values = Array.from({ length: steps + 1 }, (_, i) => round(i * CH + (i === steps ? 2 : 0), 1)).join(';');
    out.push(`<clipPath id="${id}"><rect x="${round(x - 1)}" y="${y - 14}" width="${round(steps * CH + 2)}" height="20">` +
      `<animate attributeName="width" values="${values}" dur="${round(typeDur, 2)}s" begin="${round(at + 0.25, 2)}s" fill="freeze" calcMode="discrete"/></rect></clipPath>`);
    out.push(t(x, y, cmd, 'm tx', `clip-path="url(#${id})" textLength="${round(steps * CH)}" lengthAdjust="spacing"`));
  }
  if (cursor) out.push(r(x + 1, y - 12, 8, 15, `fill="${C.green}" class="blink" ${delay(at)}`));
  return out.join('');
}

function heatmap(stats, y0, at) {
  const cell = 11, step = 14;
  const gx = X0 + 34;
  const out = [];
  // month labels at the first column of each month
  let lastLabelCol = -9;
  stats.weeks.forEach((w, col) => {
    const first = w.find((d) => d.date.slice(8) <= '07') || null;
    const d0 = w[0];
    const month = Number((first || d0).date.slice(5, 7)) - 1;
    const isNew = col === 0 ? Number(d0.date.slice(8)) <= 7 : w.some((d) => d.date.slice(8) === '01');
    if (isNew && col - lastLabelCol >= 3 && col <= stats.weeks.length - 2) {
      out.push(t(gx + col * step, y0, U.MONTHS[month], 'm s mu'));
      lastLabelCol = col;
    }
  });
  const top = y0 + 10;
  [['Mon', 1], ['Wed', 3], ['Fri', 5]].forEach(([lbl, row]) => out.push(t(X0, top + row * step + 9, lbl, 'm s mu')));
  const n = stats.weeks.length;
  stats.weeks.forEach((w, col) => {
    const d = at + (col / n) * 0.9;
    out.push(`<g class="pop" ${delay(d)}>`);
    for (const day of w) {
      out.push(r(gx + col * step, top + day.weekday * step, cell, cell, `rx="2" fill="${C.levels[day.level]}"`));
    }
    out.push('</g>');
  });
  const by = top + 7 * step + 18;
  out.push(`<g class="fade" ${delay(at + 0.9)}>`);
  out.push(t(gx, by, `${stats.total.toLocaleString('en-US')} contributions in the last year`, 'm s tx'));
  const lx = gx + n * step - 5 * step - 34;
  out.push(t(lx - 36, by, 'Less', 'm s mu'));
  C.levels.forEach((c, i) => out.push(r(lx + i * step, by - 10, cell, cell, `rx="2" fill="${c}"`)));
  out.push(t(lx + 5 * step + 4, by, 'More', 'm s mu'));
  out.push('</g>');
  return { svg: out.join(''), bottom: by };
}

// 7×9 pixel letters for the neofetch logo
const GLYPH = {
  M: ['X.....X', 'XX...XX', 'X.X.X.X', 'X..X..X', 'X.....X', 'X.....X', 'X.....X', 'X.....X', 'X.....X'],
  T: ['XXXXXXX', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...', '...X...'],
};

function logo(x0, y0, at) {
  const cols = 18, rows = 11, step = 14, cell = 11;
  const letters = ['M', 'T'];
  const out = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let on = false;
      const lr = row - 1;
      if (lr >= 0 && lr < 9) {
        const li = col - 1 < 7 ? 0 : col - 10 >= 0 && col - 10 < 7 ? 1 : -1;
        const lc = li === 0 ? col - 1 : col - 10;
        if (li >= 0 && lc >= 0 && lc < 7) on = GLYPH[letters[li]][lr][lc] === 'X';
      }
      const level = on ? 3 + ((row + col) % 2) : 0;
      const d = at + (row + col) * 0.018;
      out.push(r(x0 + col * step, y0 + row * step, cell, cell, `rx="2" fill="${C.levels[level]}" class="pop" ${delay(d)}`));
    }
  }
  return { svg: out.join(''), width: cols * step, height: rows * step };
}

function neofetch(profile, waka, y0, at) {
  const lg = logo(X0, y0 + 22, at);
  const ix = X0 + lg.width + 40;
  const { role, stack, focus } = parseBio(profile.bio);
  const login = profile.login;
  const tz = waka && waka.timezone && waka.timezone !== 'UTC' ? waka.timezone : null;
  const rows = [
    ['Name', profile.name || login],
    ['Role', role],
    ['Location', profile.location || ''],
    ['Timezone', tz ? `${tz} (${utcOffset(tz)})` : ''],
    ['Uptime', `${uptime(profile.createdAt, new Date())} on GitHub`],
    ['Stack', stack.join(' · ')],
    ['Focus', focus],
    ['Repos', `${profile.publicRepos.totalCount} public · ${profile.allRepos.totalCount} total`],
  ].filter(([, v]) => v);
  const lh = 22;
  const out = [lg.svg];
  const line = (i, inner) => out.push(`<g class="fade" ${delay(at + 0.1 + i * 0.07)}>${inner}</g>`);
  line(0, `<text x="${ix}" y="${y0 + 14}" class="m" textLength="${round((login.length + 7) * CH)}" lengthAdjust="spacing">` +
    `<tspan class="g b">${esc(login)}</tspan><tspan class="tx">@</tspan><tspan class="g b">github</tspan></text>`);
  line(1, t(ix, y0 + 14 + lh, '─'.repeat(login.length + 7), 'm mu'));
  const vx = ix + 10 * CH, maxChars = Math.floor((W - X0 - vx) / CH);
  let n = 2;
  rows.forEach(([k, v]) => {
    const wrapped = wrapWords(v, maxChars).slice(0, 2);
    wrapped.forEach((part, j) => {
      const y = y0 + 14 + n * lh;
      line(n, (j === 0 ? t(ix, y, k, 'm g b') : '') + t(vx, y, j === 1 && wrapped.length === 2 ? fit(part, maxChars) : part, 'm tx'));
      n++;
    });
  });
  const py = y0 + 14 + n * lh + 4;
  line(n, [...C.levels.slice(1), ...LANG.slice(2)].map((c, i) => r(ix + i * 26, py - 12, 22, 14, `rx="2" fill="${c}"`)).join(''));
  const bottom = Math.max(py + 4, y0 + 22 + lg.height);
  return { svg: out.join(''), bottom };
}

function tiles(stats, y0, at) {
  const items = [
    [stats.commits.toLocaleString('en-US'), 'commits · last year'],
    [String(stats.activeDays), 'active days · last year'],
    [`${stats.current}d`, 'current streak'],
    [`${stats.longest}d`, 'longest streak'],
  ];
  const gap = 12, h = 74;
  const w = (W - X0 * 2 - gap * 3) / 4;
  const out = items.map(([v, l], i) => {
    const x = X0 + i * (w + gap);
    return `<g class="fade" ${delay(at + i * 0.08)}>` +
      r(x + 0.5, y0 + 0.5, w - 1, h - 1, `rx="8" fill="${C.panel}" stroke="${C.border}"`) +
      t(x + 16, y0 + 36, v, 'm big g') + t(x + 16, y0 + 58, l, 'm s mu') + '</g>';
  });
  return { svg: out.join(''), bottom: y0 + h };
}

function weeklyChart(stats, x0, y0, w, h, at) {
  const out = [r(x0 + 0.5, y0 + 0.5, w - 1, h - 1, `rx="8" fill="${C.panel}" stroke="${C.border}"`)];
  out.push(t(x0 + 16, y0 + 24, 'weekly contributions', 'm s tx') + t(x0 + w - 16, y0 + 24, 'last 26 weeks', 'm s mu', 'text-anchor="end"'));
  const bars = stats.weekly;
  const max = Math.max(1, ...bars.map((b) => b.total));
  const cx = x0 + 16, cw = w - 32, base = y0 + h - 30, ch = h - 74;
  const step = cw / bars.length, bw = Math.max(4, step - 5);
  bars.forEach((b, i) => {
    const bh = b.total ? Math.max(3, (b.total / max) * ch) : 2;
    const ratio = b.total / max;
    const color = !b.total ? C.levels[0] : ratio > 0.75 ? C.levels[4] : ratio > 0.45 ? C.levels[3] : ratio > 0.2 ? C.levels[2] : C.levels[1];
    out.push(r(cx + i * step, base - bh, bw, bh, `rx="2" fill="${color}" class="grow" ${delay(at + i * 0.02)}`));
  });
  out.push(`<line x1="${cx}" y1="${base + 0.5}" x2="${cx + cw}" y2="${base + 0.5}" stroke="${C.border}"/>`);
  const label = (ymd) => `${U.MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8))}`;
  out.push(t(cx, base + 18, label(bars[0].start), 'm s mu') + t(cx + cw, base + 18, `peak ${max}/week`, 'm s mu', 'text-anchor="end"'));
  return out.join('');
}

function codingPanel(waka, x0, y0, w, h, at) {
  const out = [r(x0 + 0.5, y0 + 0.5, w - 1, h - 1, `rx="8" fill="${C.panel}" stroke="${C.border}"`)];
  out.push(t(x0 + 16, y0 + 24, 'coding time', 'm s tx') + t(x0 + w - 16, y0 + 24, 'last 7 days', 'm s mu', 'text-anchor="end"'));
  out.push(`<g class="fade" ${delay(at)}>` + t(x0 + 16, y0 + 54, U.fmtDuration(waka.totalSeconds), 'm big g') +
    t(x0 + w - 16, y0 + 54, `${waka.activeDays}/${waka.days.length} days`, 'm s mu', 'text-anchor="end"') + '</g>');
  const langs = waka.languages.slice(0, 4);
  const bx = x0 + 16, bw = w - 32;
  langs.forEach((l, i) => {
    const y = y0 + 80 + i * 22;
    out.push(`<g class="fade" ${delay(at + 0.15 + i * 0.1)}>` + t(bx, y, fit(l.name, 14), 'm s tx') +
      t(bx + bw, y, `${Math.round(l.percent)}%`, 'm s mu', 'text-anchor="end"') +
      r(bx + 118, y - 8, bw - 160, 6, `rx="3" fill="${C.levels[0]}"`) + '</g>');
    out.push(r(bx + 118, y - 8, Math.max(3, (bw - 160) * (l.percent / 100)), 6, `rx="3" fill="${l.other ? LANG[5] : LANG[i]}" class="growx" ${delay(at + 0.2 + i * 0.1)}`));
  });
  return out.join('');
}

function renderTerminal({ profile, stats, waka }) {
  const parts = [];
  let y = 76, at = 0.1;
  const login = profile.login;
  parts.push(prompt('c1', y, './contributions.sh', at, { login }));
  at += 0.75;
  const hm = heatmap(stats, y + 30, at);
  parts.push(hm.svg);
  at += 1.15;
  y = hm.bottom + 46;
  parts.push(prompt('c2', y, 'neofetch', at, { login }));
  at += 0.5;
  const nf = neofetch(profile, waka, y + 14, at);
  parts.push(nf.svg);
  at += 1.0;
  y = nf.bottom + 40;
  parts.push(prompt('c3', y, './stats.sh --weekly', at, { login }));
  at += 0.75;
  const tl = tiles(stats, y + 18, at);
  parts.push(tl.svg);
  at += 0.35;
  const py = tl.bottom + 12, ph = 170;
  if (waka && waka.totalSeconds > 0) {
    const lw = 486;
    parts.push(weeklyChart(stats, X0, py, lw, ph, at));
    parts.push(codingPanel(waka, X0 + lw + 12, py, W - X0 * 2 - lw - 12, ph, at + 0.3));
  } else {
    parts.push(weeklyChart(stats, X0, py, W - X0 * 2, ph, at));
  }
  at += 0.9;
  y = py + ph + 42;
  parts.push(prompt('c4', y, '', at, { cursor: true, login }));
  const H = y + 30;

  const desc = `${profile.name || profile.login}: ${stats.total} contributions in the last year, ${stats.commits} commits, ` +
    `current streak ${stats.current} days, longest ${stats.longest} days` +
    (waka && waka.totalSeconds > 0 ? `, ${U.fmtDuration(waka.totalSeconds)} of coding in the last 7 days.` : '.');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="tt td">
<title id="tt">${esc(profile.login)} — terminal</title>
<desc id="td">${esc(desc)}</desc>
<style>
  .m { font-family: ${MONO}; font-size: 13px; }
  .s { font-size: 11.5px; }
  .big { font-size: 24px; font-weight: 700; }
  .b { font-weight: 700; }
  .g { fill: ${C.green}; } .bl { fill: ${C.blue}; } .tx { fill: ${C.text}; } .mu { fill: ${C.muted}; }
  .ttl { font-family: ${MONO}; font-size: 12px; fill: ${C.muted}; }
  .fade { animation: fade .45s ease-out both; }
  .pop { animation: pop .35s ease-out both; }
  .grow { transform-box: fill-box; transform-origin: 50% 100%; animation: grow .6s cubic-bezier(.2,.8,.2,1) both; }
  .growx { transform-box: fill-box; transform-origin: 0 50%; animation: growx .8s cubic-bezier(.2,.8,.2,1) both; }
  .blink { animation: fade .3s both, blink 1.1s steps(1) infinite; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes pop { from { opacity: 0; } to { opacity: 1; } }
  @keyframes grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  @keyframes growx { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes blink { 50% { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .fade, .pop, .grow, .growx, .blink { animation: none; } }
</style>
${r(0.5, 0.5, W - 1, H - 1, `rx="12" fill="${C.win}" stroke="${C.border}"`)}
<path d="M0.5 40.5 V12.5 a12 12 0 0 1 12 -12 H${W - 12.5} a12 12 0 0 1 12 12 V40.5 Z" fill="${C.bar}"/>
<line x1="0.5" y1="40.5" x2="${W - 0.5}" y2="40.5" stroke="${C.border}"/>
<circle cx="22" cy="20.5" r="6" fill="#FF5F57"/><circle cx="42" cy="20.5" r="6" fill="#FEBC2E"/><circle cx="62" cy="20.5" r="6" fill="#28C840"/>
<text x="${W / 2}" y="25" class="ttl" text-anchor="middle">${esc(profile.login)}@github: ~ — zsh</text>
${parts.join('\n')}
</svg>
`;
}

// ───────────────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const login = process.env.GITHUB_REPOSITORY_OWNER || process.env.GH_LOGIN || '';
    const token = process.env.GH_PORTFOLIO_TOKEN || process.env.GITHUB_TOKEN || '';
    let profile;
    try {
      profile = await fetchProfile({ token, login, fixture: process.env.GITHUB_GRAPHQL_FIXTURE });
    } catch (e) {
      // A fine-grained token may lack GraphQL access to the calendar — retry with the Actions token.
      if (!process.env.GITHUB_TOKEN || token === process.env.GITHUB_TOKEN) throw e;
      U.warn(`GitHub: ${e.message}; retrying with GITHUB_TOKEN`);
      profile = await fetchProfile({ token: process.env.GITHUB_TOKEN, login });
    }

    let waka = null;
    if (process.env.WAKATIME_API_KEY || process.env.WAKATIME_FIXTURE) {
      try {
        const raw = await fetchWakaTime({ apiKey: process.env.WAKATIME_API_KEY, rangeEnd: 'yesterday', fixture: process.env.WAKATIME_FIXTURE });
        waka = computeWakaStats(raw);
      } catch (e) {
        U.warn(`WakaTime: ${e.message} — coding panel omitted`);
      }
    }

    const tz = (waka && waka.timezone) || 'Asia/Tashkent';
    const stats = computeStats(profile, U.localDate(new Date(), tz));
    const svg = renderTerminal({ profile, stats, waka });
    S.assertNoSecrets(svg);

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, svg, 'utf8');
    U.log(`Terminal: ${stats.total} contributions · ${stats.commits} commits · streak ${stats.current}/${stats.longest} · ${waka ? U.fmtDuration(waka.totalSeconds) : 'no WakaTime'}`);
    U.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${svg.length} bytes)`);
  } catch (e) {
    U.fail(e && e.message ? e.message : String(e));
  }
})();
