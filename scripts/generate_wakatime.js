#!/usr/bin/env node
'use strict';

/**
 * WakaTime → SVG dashboard generator
 *
 *   WakaTime API → data processing → statistics → SVG → assets/wakatime.svg
 *
 * Data sources (official WakaTime API v1):
 *   GET /users/current                    → account timezone
 *   GET /users/current/summaries          → per-day totals and per-day languages
 *   GET /users/current/durations?date=…   → raw coding durations (sessions, hour-of-day heatmap)
 *
 * Environment variables:
 *   WAKATIME_API_KEY           required. Sent only as a Basic auth header; never logged, never rendered.
 *   WAKATIME_RANGE_END         "yesterday" (default, 7 complete days) or "today"
 *   WAKATIME_TIMEZONE          override the timezone reported by WakaTime (IANA name)
 *   WAKATIME_SESSION_GAP_MIN   a break longer than this ends a coding session (default 15)
 *   WAKATIME_OUTPUT            output path (default: assets/wakatime.svg)
 *   WAKATIME_FIXTURE           path to a JSON fixture — local development without API calls
 *
 * Zero dependencies. Requires Node 18+ (global fetch).
 */

const fs = require('fs');
const path = require('path');

// ───────────────────────────────────────────────────────────────────────────────
// Configuration
// ───────────────────────────────────────────────────────────────────────────────

const API_BASE = 'https://wakatime.com/api/v1';
const OUTPUT = process.env.WAKATIME_OUTPUT || path.join(__dirname, '..', 'assets', 'wakatime.svg');
const RANGE_END = (process.env.WAKATIME_RANGE_END || 'yesterday').toLowerCase();
const SESSION_GAP_SEC = Math.max(1, Number(process.env.WAKATIME_SESSION_GAP_MIN) || 15) * 60;
const DAYS = 7;
const TOP_LANGUAGES = 5;
const ACTIVE_DAY_MIN_SECONDS = 60; // a day counts as active with at least one minute of coding
const HEAT_COLS = 12; // 2-hour blocks

const COLOR = {
  bg: '#0D1117',
  card: '#161B22',
  border: '#30363D',
  text: '#F0F6FC',
  muted: '#8B949E',
  faint: '#6E7681',
  track: '#21262D',
  grid: '#21262D',
  accent: '#8B7CF6',
  accentSoft: '#6E60D9',
  languages: ['#8B7CF6', '#5FA8F5', '#4FC1B2', '#E0B25C', '#E27C9A'],
  other: '#484F58',
};

// ───────────────────────────────────────────────────────────────────────────────
// Small utilities
// ───────────────────────────────────────────────────────────────────────────────

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stderr.write(`warning: ${msg}\n`);
const fail = (msg) => { process.stderr.write(`error: ${msg}\n`); process.exit(1); };

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad2 = (n) => String(n).padStart(2, '0');
const round = (v, d = 2) => Number(v.toFixed(d));

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function isValidTimezone(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** YYYY-MM-DD of a Date instance in a given IANA timezone. */
function localDate(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Seconds since local midnight for a unix timestamp in a given timezone. */
function secondsOfDay(unix, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(unix * 1000)).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
  return (Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
}

function localClock(unix, tz) {
  const s = secondsOfDay(unix, tz);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}

function parseDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function toYMD(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}
function addDays(ymd, n) {
  const d = parseDate(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return toYMD(d);
}
function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
const weekdayName = (ymd) => WEEKDAYS[parseDate(ymd).getUTCDay()];
const weekdayShort = (ymd) => weekdayName(ymd).slice(0, 3).toUpperCase();

/** "44h 23m", "23m", "0m" */
function fmtDuration(seconds) {
  const total = Math.round(Math.max(0, seconds || 0) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

/** Axis tick label in hours: "4h", "1.5h", "30m" */
function fmtHours(h) {
  if (h === 0) return '0';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h}h`;
}

function fmtPercent(p) {
  return `${p.toFixed(1)}%`;
}

/** "21 SEP — 27 SEP 2026" or "28 DEC 2025 — 3 JAN 2026" */
function fmtDateRange(start, end) {
  const a = parseDate(start), b = parseDate(end);
  const ay = a.getUTCFullYear(), by = b.getUTCFullYear();
  const left = `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}${ay !== by ? ` ${ay}` : ''}`;
  const right = `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]} ${by}`;
  return `${left} — ${right}`.toUpperCase();
}
function fmtDateShort(ymd) {
  const d = parseDate(ymd);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`.toUpperCase();
}

/**
 * Conservative text-width estimate (px) for a UI sans-serif at the given size.
 * GitHub renders the SVG with whatever system font the viewer has, so we never
 * measure — we over-estimate and lay out with margin.
 */
function textWidth(str, size, letterSpacing = 0) {
  let w = 0;
  for (const ch of String(str)) {
    if (/[A-Z]/.test(ch)) w += 0.72;
    else if (/[0-9]/.test(ch)) w += 0.64;
    else if (/[a-z]/.test(ch)) w += 0.58;
    else if (ch === ' ') w += 0.3;
    else if (/[.,:;'|!]/.test(ch)) w += 0.3;
    else if (/[·–—-]/.test(ch)) w += 0.4;
    else w += 0.66;
  }
  return w * size + letterSpacing * Math.max(0, str.length - 1);
}

/** Shorten a string with an ellipsis until it fits the given pixel width. */
function fitText(str, size, maxWidth) {
  let s = String(str);
  if (textWidth(s, size) <= maxWidth) return s;
  while (s.length > 1 && textWidth(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Mix two hex colours. t = 0 → a, t = 1 → b. */
function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16));
  const pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Choose a tick step (in hours) so the axis has 3–5 gridlines. */
function niceScale(maxHours) {
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 24];
  const target = Math.max(maxHours, 0.25);
  for (const step of steps) {
    const n = Math.ceil(target / step);
    if (n <= 4) return { step, top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
  }
  const step = 24, n = Math.ceil(target / step);
  return { step, top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) };
}

// ───────────────────────────────────────────────────────────────────────────────
// WakaTime API
// ───────────────────────────────────────────────────────────────────────────────

function makeClient(apiKey) {
  const auth = `Basic ${Buffer.from(apiKey, 'utf8').toString('base64')}`;
  return async function request(endpoint, params = {}) {
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'wakatime-readme-dashboard' },
          signal: AbortSignal.timeout(30000),
        });
        if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status} from ${endpoint}`);
          err.fatal = true;
          throw err;
        }
        return await res.json();
      } catch (e) {
        lastError = e;
        if (e.fatal) break;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw new Error(`${endpoint}: ${lastError && lastError.message}`);
  };
}

async function loadRaw() {
  if (process.env.WAKATIME_FIXTURE) {
    const fixture = JSON.parse(fs.readFileSync(process.env.WAKATIME_FIXTURE, 'utf8'));
    log(`Using fixture ${process.env.WAKATIME_FIXTURE}`);
    return fixture;
  }

  const apiKey = process.env.WAKATIME_API_KEY;
  if (!apiKey || !apiKey.trim()) fail('WAKATIME_API_KEY is not set.');
  const api = makeClient(apiKey.trim());

  let timezone = process.env.WAKATIME_TIMEZONE;
  if (!timezone) {
    try {
      const me = await api('/users/current');
      timezone = me && me.data && me.data.timezone;
    } catch (e) {
      warn(`could not read account timezone (${e.message}); falling back to UTC`);
    }
  }
  if (!isValidTimezone(timezone)) {
    if (timezone) warn(`unknown timezone "${timezone}"; falling back to UTC`);
    timezone = 'UTC';
  }

  const today = localDate(new Date(), timezone);
  const end = RANGE_END === 'today' ? today : addDays(today, -1);
  const start = addDays(end, -(DAYS - 1));

  const summaries = await api('/users/current/summaries', { start, end, timezone });

  // Durations are optional: if any day cannot be fetched the session/heatmap metrics are omitted.
  const durations = {};
  for (const date of eachDay(start, end)) {
    try {
      durations[date] = await api('/users/current/durations', { date, timezone });
    } catch (e) {
      warn(`durations for ${date} unavailable (${e.message}); session metrics will be omitted`);
      durations[date] = null;
    }
  }

  return { timezone, today, start, end, summaries, durations };
}

// ───────────────────────────────────────────────────────────────────────────────
// Statistics
// ───────────────────────────────────────────────────────────────────────────────

function computeStats(raw) {
  const tz = isValidTimezone(raw.timezone) ? raw.timezone : 'UTC';
  const dates = eachDay(raw.start, raw.end);
  if (dates.length === 0) fail('invalid date range');

  const rows = Array.isArray(raw.summaries && raw.summaries.data) ? raw.summaries.data : [];
  const byDate = new Map(rows.filter((r) => r && r.range && r.range.date).map((r) => [r.range.date, r]));

  const days = dates.map((date) => {
    const row = byDate.get(date);
    const seconds = Number(row && row.grand_total && row.grand_total.total_seconds) || 0;
    const languages = (row && Array.isArray(row.languages) ? row.languages : [])
      .filter((l) => l && l.name && Number(l.total_seconds) > 0);
    return { date, seconds, languages };
  });

  const totalSeconds = sum(days.map((d) => d.seconds));
  const activeDays = days.filter((d) => d.seconds >= ACTIVE_DAY_MIN_SECONDS).length;
  const dailyAverage = totalSeconds / days.length;
  const avgPerActiveDay = activeDays ? totalSeconds / activeDays : 0;
  const bestDay = totalSeconds > 0 ? days.reduce((a, b) => (b.seconds > a.seconds ? b : a)) : null;

  // Languages — aggregated across the window, top N + "Other".
  const langTotals = new Map();
  for (const d of days) for (const l of d.languages) langTotals.set(l.name, (langTotals.get(l.name) || 0) + Number(l.total_seconds));
  const langTotal = sum([...langTotals.values()]);
  const sorted = [...langTotals.entries()].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds);
  const named = sorted.filter((l) => l.name.toLowerCase() !== 'other');
  const top = named.slice(0, TOP_LANGUAGES);
  const otherSeconds = sum(named.slice(TOP_LANGUAGES).map((l) => l.seconds)) + sum(sorted.filter((l) => l.name.toLowerCase() === 'other').map((l) => l.seconds));
  const languages = top.map((l, i) => ({ ...l, percent: langTotal ? (l.seconds / langTotal) * 100 : 0, color: COLOR.languages[i % COLOR.languages.length], other: false }));
  if (otherSeconds > 0) languages.push({ name: 'Other', seconds: otherSeconds, percent: langTotal ? (otherSeconds / langTotal) * 100 : 0, color: COLOR.other, other: true });
  const mostUsed = top[0] || null;

  // Durations — sessions + hour-of-day heatmap (optional).
  const detail = analyzeDurations(raw.durations, dates, tz);

  const peak = detail ? peakBlock(detail.buckets) : null;

  return {
    timezone: tz,
    start: raw.start,
    end: raw.end,
    generated: raw.today || localDate(new Date(), tz),
    days,
    totalSeconds,
    activeDays,
    dailyAverage,
    avgPerActiveDay,
    bestDay,
    languages,
    langTotal,
    mostUsed,
    longestSession: detail ? detail.longest : null,
    heatmap: detail ? detail.buckets : null,
    peak,
  };
}

function analyzeDurations(durations, dates, tz) {
  if (!durations) return null;
  const complete = dates.every((d) => durations[d] && Array.isArray(durations[d].data));
  if (!complete) return null;

  const buckets = dates.map(() => new Array(HEAT_COLS).fill(0));
  const blockSeconds = 86400 / HEAT_COLS;
  let longest = null;
  const consider = (s) => { if (!longest || s.active > longest.active) longest = s; };

  dates.forEach((date, row) => {
    const items = durations[date].data
      .filter((x) => x && Number.isFinite(Number(x.time)) && Number(x.duration) > 0)
      .map((x) => ({ time: Number(x.time), duration: Number(x.duration) }))
      .sort((a, b) => a.time - b.time);

    for (const it of items) {
      let s = secondsOfDay(it.time, tz);
      let remaining = it.duration;
      while (remaining > 0 && s < 86400) {
        const col = Math.min(HEAT_COLS - 1, Math.floor(s / blockSeconds));
        const take = Math.min(remaining, (col + 1) * blockSeconds - s);
        buckets[row][col] += take;
        s += take;
        remaining -= take;
      }
    }

    let cur = null;
    for (const it of items) {
      const start = it.time, end = it.time + it.duration;
      if (cur && start - cur.end <= SESSION_GAP_SEC) {
        cur.end = Math.max(cur.end, end);
        cur.active += it.duration;
      } else {
        if (cur) consider(cur);
        cur = { date, start, end, active: it.duration };
      }
    }
    if (cur) consider(cur);
  });

  if (longest) {
    longest = { ...longest, startClock: localClock(longest.start, tz), endClock: localClock(longest.end, tz) };
  }
  return { buckets, longest };
}

function peakBlock(buckets) {
  const cols = new Array(HEAT_COLS).fill(0);
  for (const row of buckets) row.forEach((v, i) => { cols[i] += v; });
  const max = Math.max(...cols);
  if (max <= 0) return null;
  const i = cols.indexOf(max);
  const hours = 24 / HEAT_COLS;
  return { from: `${pad2(i * hours)}:00`, to: `${pad2((i + 1) * hours)}:00`, seconds: max };
}

// ───────────────────────────────────────────────────────────────────────────────
// SVG rendering
// ───────────────────────────────────────────────────────────────────────────────

const W = 900;
const PAD = 24;
const GAP = 16;
const INNER = W - PAD * 2;
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const text = (x, y, str, cls, extra = '') => `<text x="${round(x)}" y="${round(y)}" class="${cls}"${extra ? ` ${extra}` : ''}>${esc(str)}</text>`;
const rect = (x, y, w, h, extra = '') => `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" ${extra}/>`;
const card = (x, y, w, h) => rect(x + 0.5, y + 0.5, w - 1, h - 1, `rx="10" fill="${COLOR.card}" stroke="${COLOR.border}"`);

function arcPath(cx, cy, r, startDeg, endDeg) {
  const toRad = (d) => ((d - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(toRad(startDeg)), y0 = cy + r * Math.sin(toRad(startDeg));
  const x1 = cx + r * Math.cos(toRad(endDeg)), y1 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${round(x0)} ${round(y0)} A ${r} ${r} 0 ${large} 1 ${round(x1)} ${round(y1)}`;
}

function render(stats) {
  const parts = [];
  let y = PAD;

  // ── Header ──────────────────────────────────────────────────────────────
  parts.push(text(PAD, y + 22, 'CODING ACTIVITY', 'title'));
  parts.push(text(PAD, y + 44, 'WAKATIME • LAST 7 DAYS', 'label'));
  parts.push(text(W - PAD, y + 22, fmtDateRange(stats.start, stats.end), 'range', 'text-anchor="end"'));
  parts.push(text(W - PAD, y + 44, `UPDATED ${fmtDateShort(stats.generated)}`, 'label', 'text-anchor="end"'));
  y += 60 + 12;

  // ── KPI cards ───────────────────────────────────────────────────────────
  const kpis = [
    { value: fmtDuration(stats.totalSeconds), label: 'Total coding time' },
    { value: fmtDuration(stats.dailyAverage), suffix: '/day', label: 'Daily average' },
    { value: `${stats.activeDays} / ${stats.days.length}`, label: 'Active days' },
    stats.longestSession
      ? { value: fmtDuration(stats.longestSession.active), label: 'Longest session' }
      : { value: stats.bestDay ? fmtDuration(stats.bestDay.seconds) : '0m', label: 'Best day' },
  ];
  const kpiH = 88;
  const kpiW = (INNER - GAP * (kpis.length - 1)) / kpis.length;
  kpis.forEach((k, i) => {
    const x = PAD + i * (kpiW + GAP);
    parts.push(card(x, y, kpiW, kpiH));
    const suffix = k.suffix ? `<tspan class="kpi-suffix" dx="4">${esc(k.suffix)}</tspan>` : '';
    const avail = kpiW - 40 - (k.suffix ? textWidth(k.suffix, 14) + 4 : 0);
    const size = Math.min(30, Math.floor((avail / textWidth(k.value, 1)) * 10) / 10);
    parts.push(`<text x="${round(x + 20)}" y="${round(y + 46)}" class="kpi"${size < 30 ? ` style="font-size:${size}px"` : ''}>${esc(k.value)}${suffix}</text>`);
    parts.push(text(x + 20, y + 68, k.label.toUpperCase(), 'label'));
  });
  y += kpiH + GAP;

  // ── Weekly activity + language donut ────────────────────────────────────
  const rowH = 264;
  const leftW = 472;
  const rightW = INNER - leftW - GAP;
  parts.push(card(PAD, y, leftW, rowH));
  parts.push(...renderWeekly(stats, PAD, y, leftW, rowH));
  parts.push(card(PAD + leftW + GAP, y, rightW, rowH));
  parts.push(...renderDonut(stats, PAD + leftW + GAP, y, rightW, rowH));
  y += rowH + GAP;

  // ── Language breakdown ──────────────────────────────────────────────────
  const langRows = Math.max(1, Math.ceil(stats.languages.length / 2));
  const breakdownH = 44 + langRows * 48 + 8;
  parts.push(card(PAD, y, INNER, breakdownH));
  parts.push(...renderBreakdown(stats, PAD, y, INNER, breakdownH));
  y += breakdownH + GAP;

  // ── Heatmap + insights ──────────────────────────────────────────────────
  const heatW = 392;
  const insightW = INNER - heatW - GAP;
  const heatH = stats.heatmap ? 258 : 196;
  parts.push(card(PAD, y, heatW, heatH));
  parts.push(...renderHeatmap(stats, PAD, y, heatW, heatH));
  parts.push(card(PAD + heatW + GAP, y, insightW, heatH));
  parts.push(...renderInsights(stats, PAD + heatW + GAP, y, insightW, heatH));
  y += heatH + PAD;

  const H = y;
  const label = `Coding activity from WakaTime, ${fmtDateRange(stats.start, stats.end)}: ${fmtDuration(stats.totalSeconds)} total, ${stats.activeDays} of ${stats.days.length} active days.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Coding activity — WakaTime, last 7 days</title>
<desc id="d">${esc(label)}</desc>
<style>
  text { font-family: ${FONT}; fill: ${COLOR.text}; font-variant-numeric: tabular-nums; }
  .title { font-size: 20px; font-weight: 700; letter-spacing: 0.4px; }
  .range { font-size: 13px; font-weight: 600; letter-spacing: 1px; }
  .label { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; fill: ${COLOR.muted}; }
  .kpi { font-size: 30px; font-weight: 700; letter-spacing: -0.6px; }
  .kpi-suffix { font-size: 14px; font-weight: 500; letter-spacing: 0; fill: ${COLOR.muted}; }
  .axis { font-size: 11px; font-weight: 500; fill: ${COLOR.muted}; }
  .val { font-size: 11px; font-weight: 600; fill: ${COLOR.muted}; }
  .val-hi { font-size: 11px; font-weight: 600; fill: ${COLOR.text}; }
  .center { font-size: 19px; font-weight: 700; letter-spacing: -0.4px; }
  .center-sub { font-size: 9.5px; font-weight: 600; letter-spacing: 1.2px; fill: ${COLOR.muted}; }
  .name { font-size: 13px; font-weight: 600; }
  .meta { font-size: 12px; font-weight: 500; fill: ${COLOR.muted}; }
  .legend { font-size: 12.5px; font-weight: 500; }
  .heat { font-size: 10.5px; font-weight: 500; fill: ${COLOR.muted}; }
  .ins { font-size: 15px; font-weight: 600; }
  .ins-sub { font-size: 13px; font-weight: 500; fill: ${COLOR.muted}; }
  .empty { font-size: 12.5px; font-weight: 500; fill: ${COLOR.muted}; }
  .dim { fill: ${COLOR.muted}; }
</style>
<rect width="${W}" height="${H}" rx="12" fill="${COLOR.bg}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${COLOR.border}"/>
${parts.join('\n')}
</svg>
`;
}

function renderWeekly(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'WEEKLY ACTIVITY', 'label'));
  out.push(text(x + w - 20, y + 30, 'HOURS PER DAY', 'label', 'text-anchor="end"'));

  const plotX = x + 58, plotR = x + w - 20;
  const plotTop = y + 66, plotBottom = y + h - 40;
  const plotW = plotR - plotX, plotH = plotBottom - plotTop;

  const maxHours = Math.max(...stats.days.map((d) => d.seconds)) / 3600;
  const scale = niceScale(maxHours);

  if (stats.totalSeconds <= 0) {
    out.push(`<line x1="${round(plotX)}" y1="${round(plotBottom)}" x2="${round(plotR)}" y2="${round(plotBottom)}" stroke="${COLOR.grid}" stroke-width="1"/>`);
    out.push(text(plotX - 10, plotBottom + 4, '0', 'axis', 'text-anchor="end"'));
    out.push(text(plotX + plotW / 2, plotTop + plotH / 2, 'No coding activity recorded in this period.', 'empty', 'text-anchor="middle"'));
    stats.days.forEach((d, i) => {
      const slot = plotW / stats.days.length;
      out.push(text(plotX + slot * i + slot / 2, plotBottom + 22, weekdayShort(d.date), 'axis', 'text-anchor="middle"'));
    });
    return out;
  }

  // Grid lines + axis labels
  for (const t of scale.ticks) {
    const gy = plotBottom - (t / scale.top) * plotH;
    out.push(`<line x1="${round(plotX)}" y1="${round(gy)}" x2="${round(plotR)}" y2="${round(gy)}" stroke="${COLOR.grid}" stroke-width="1"${t === 0 ? '' : ' stroke-dasharray="2 4"'}/>`);
    out.push(text(plotX - 10, gy + 4, fmtHours(t), 'axis', 'text-anchor="end"'));
  }

  const slot = plotW / stats.days.length;
  const barW = Math.min(44, slot * 0.58);
  const best = stats.bestDay;
  stats.days.forEach((d, i) => {
    const cx = plotX + slot * i + slot / 2;
    const bx = cx - barW / 2;
    const hours = d.seconds / 3600;
    const bh = scale.top ? (hours / scale.top) * plotH : 0;
    const isBest = best && d.date === best.date && d.seconds > 0;
    if (bh >= 1) {
      const r = Math.min(5, barW / 2, bh / 2);
      out.push(`<path d="${roundedTopRect(bx, plotBottom - bh, barW, bh, r)}" fill="${isBest ? COLOR.accent : COLOR.accentSoft}"${isBest ? '' : ' fill-opacity="0.85"'}/>`);
      out.push(text(cx, plotBottom - bh - 8, fmtDuration(d.seconds), isBest ? 'val-hi' : 'val', 'text-anchor="middle"'));
    } else {
      out.push(rect(bx, plotBottom - 3, barW, 3, `rx="1.5" fill="${COLOR.track}"`));
    }
    out.push(text(cx, plotBottom + 22, weekdayShort(d.date), 'axis', 'text-anchor="middle"'));
  });
  return out;
}

function roundedTopRect(x, y, w, h, r) {
  return `M ${round(x)} ${round(y + h)} V ${round(y + r)} Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} H ${round(x + w - r)} Q ${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r)} V ${round(y + h)} Z`;
}

function renderDonut(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'LANGUAGES', 'label'));

  const r = 58, stroke = 14;
  const cx = x + 20 + r + stroke / 2 + 2;
  const cy = y + 56 + (h - 56 - 20) / 2;

  const langs = stats.languages;
  const total = sum(langs.map((l) => l.seconds));

  if (!langs.length || total <= 0) {
    out.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${COLOR.track}" stroke-width="${stroke}"/>`);
    out.push(text(cx, cy + 6, '0m', 'center', 'text-anchor="middle"'));
    out.push(text(cx, cy + 22, 'TOTAL TIME', 'center-sub', 'text-anchor="middle"'));
    out.push(text(x + 20 + 2 * r + stroke + 24, cy + 4, 'No language data yet', 'empty'));
    return out;
  }

  const gapDeg = langs.length > 1 ? 2.4 : 0;
  let angle = 0;
  const totalDeg = 360 - gapDeg * langs.length;
  if (langs.length === 1) {
    out.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${langs[0].color}" stroke-width="${stroke}"/>`);
  } else {
    for (const l of langs) {
      const span = (l.seconds / total) * totalDeg;
      if (span > 0.5) {
        out.push(`<path d="${arcPath(cx, cy, r, angle, angle + Math.min(span, 359.99))}" fill="none" stroke="${l.color}" stroke-width="${stroke}"/>`);
      }
      angle += span + gapDeg;
    }
  }

  const centerText = fmtDuration(stats.totalSeconds);
  const innerW = (r - stroke / 2) * 2 - 14;
  const centerSize = Math.min(19, Math.floor((innerW / textWidth(centerText, 1)) * 10) / 10);
  out.push(text(cx, cy + 6, centerText, 'center', `text-anchor="middle" style="font-size:${centerSize}px"`));
  out.push(text(cx, cy + 22, 'TOTAL TIME', 'center-sub', 'text-anchor="middle"'));

  // Legend
  const lx = cx + r + stroke / 2 + 22;
  const lr = x + w - 20;
  const legendNameW = lr - (lx + 18) - textWidth('88.8%', 12) - 12;
  const rowH = 25;
  const ly0 = cy - ((langs.length - 1) * rowH) / 2;
  langs.forEach((l, i) => {
    const ly = ly0 + i * rowH;
    out.push(`<circle cx="${round(lx + 5)}" cy="${round(ly)}" r="4.5" fill="${l.color}"/>`);
    out.push(text(lx + 18, ly + 4.5, fitText(l.name, 12.5, legendNameW), l.other ? 'legend dim' : 'legend'));
    out.push(text(lr, ly + 4.5, fmtPercent(l.percent), 'meta', 'text-anchor="end"'));
  });
  return out;
}

function renderBreakdown(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'LANGUAGE BREAKDOWN', 'label'));
  const langs = stats.languages;
  if (!langs.length) {
    out.push(text(x + 20, y + 72, 'No language data recorded in this period.', 'empty'));
    return out;
  }
  out.push(text(x + w - 20, y + 30, 'SHARE OF TOTAL TIME', 'label', 'text-anchor="end"'));

  const colGap = 40;
  const colW = (w - 40 - colGap) / 2;
  const maxSeconds = Math.max(...langs.map((l) => l.seconds));
  const rowH = 48;
  langs.forEach((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const bx = x + 20 + col * (colW + colGap);
    const by = y + 44 + row * rowH;
    out.push(`<circle cx="${round(bx + 5)}" cy="${round(by + 12)}" r="4.5" fill="${l.color}"/>`);
    const meta = `${fmtDuration(l.seconds)}  ·  ${fmtPercent(l.percent)}`;
    out.push(text(bx + 18, by + 16.5, fitText(l.name, 13, colW - 18 - textWidth(meta, 12) - 16), l.other ? 'name dim' : 'name'));
    out.push(text(bx + colW, by + 16.5, meta, 'meta', 'text-anchor="end"'));
    out.push(rect(bx, by + 28, colW, 6, `rx="3" fill="${COLOR.track}"`));
    const fw = Math.max(6, (l.seconds / maxSeconds) * colW);
    out.push(rect(bx, by + 28, fw, 6, `rx="3" fill="${l.color}"${l.other ? ' fill-opacity="0.9"' : ''}`));
  });
  return out;
}

function renderHeatmap(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'ACTIVITY HEATMAP', 'label'));

  const ramp = [COLOR.track, mix(COLOR.card, COLOR.accent, 0.3), mix(COLOR.card, COLOR.accent, 0.52), mix(COLOR.card, COLOR.accent, 0.76), COLOR.accent];
  const legendY = y + h - 22;

  if (stats.heatmap) {
    out.push(text(x + w - 20, y + 30, 'HOUR OF DAY', 'label', 'text-anchor="end"'));
    const labelW = 34;
    const gx = x + 20 + labelW, gr = x + w - 20;
    const gap = 4;
    const cell = (gr - gx - gap * (HEAT_COLS - 1)) / HEAT_COLS;
    const cellH = 20;
    const gy = y + 62;
    const max = Math.max(...stats.heatmap.flat());

    for (let c = 0; c < HEAT_COLS; c += 3) {
      const hour = (24 / HEAT_COLS) * c;
      out.push(text(gx + c * (cell + gap), gy - 8, pad2(hour), 'heat'));
    }
    stats.days.forEach((d, row) => {
      const ry = gy + row * (cellH + gap);
      out.push(text(gx - 10, ry + cellH / 2 + 4, weekdayShort(d.date), 'heat', 'text-anchor="end"'));
      for (let c = 0; c < HEAT_COLS; c++) {
        const v = stats.heatmap[row][c];
        const level = v <= 0 || max <= 0 ? 0 : clamp(Math.ceil((v / max) * 4), 1, 4);
        out.push(rect(gx + c * (cell + gap), ry, cell, cellH, `rx="4" fill="${ramp[level]}"`));
      }
    });
  } else {
    // Fallback: per-day intensity only (durations endpoint unavailable).
    out.push(text(x + w - 20, y + 30, 'BY DAY', 'label', 'text-anchor="end"'));
    const gx = x + 20, gr = x + w - 20;
    const gap = 6;
    const cell = (gr - gx - gap * (stats.days.length - 1)) / stats.days.length;
    const gy = y + 62;
    const max = Math.max(...stats.days.map((d) => d.seconds));
    stats.days.forEach((d, i) => {
      const cx = gx + i * (cell + gap);
      const level = d.seconds <= 0 || max <= 0 ? 0 : clamp(Math.ceil((d.seconds / max) * 4), 1, 4);
      out.push(rect(cx, gy, cell, 44, `rx="6" fill="${ramp[level]}"`));
      out.push(text(cx + cell / 2, gy + 64, weekdayShort(d.date), 'heat', 'text-anchor="middle"'));
      out.push(text(cx + cell / 2, gy + 80, d.seconds > 0 ? fmtDuration(d.seconds) : '—', 'heat', 'text-anchor="middle"'));
    });
  }

  // Legend
  out.push(text(x + 20, legendY + 4, 'Less', 'heat'));
  ramp.forEach((c, i) => out.push(rect(x + 20 + 34 + i * 16, legendY - 5, 12, 12, `rx="3" fill="${c}"`)));
  out.push(text(x + 20 + 34 + ramp.length * 16 + 2, legendY + 4, 'More', 'heat'));
  return out;
}

function renderInsights(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'DEVELOPER INSIGHTS', 'label'));

  const items = [];
  if (stats.mostUsed) items.push({ label: 'Most used', value: stats.mostUsed.name, sub: fmtDuration(stats.mostUsed.seconds) });
  if (stats.bestDay) items.push({ label: 'Most productive day', value: weekdayName(stats.bestDay.date), sub: fmtDuration(stats.bestDay.seconds) });
  items.push({ label: 'Avg per active day', value: fmtDuration(stats.avgPerActiveDay), sub: stats.activeDays ? `${stats.activeDays} active ${stats.activeDays === 1 ? 'day' : 'days'}` : null });
  if (stats.longestSession) items.push({ label: 'Longest session', value: fmtDuration(stats.longestSession.active), sub: `${weekdayName(stats.longestSession.date).slice(0, 3)} ${stats.longestSession.startClock}–${stats.longestSession.endClock}` });
  items.push({ label: 'Active days', value: `${stats.activeDays} / ${stats.days.length}`, sub: `${Math.round((stats.activeDays / stats.days.length) * 100)}% of the week` });
  if (stats.peak) items.push({ label: 'Peak hours', value: `${stats.peak.from}–${stats.peak.to}`, sub: fmtDuration(stats.peak.seconds) });

  if (stats.totalSeconds <= 0) {
    out.push(text(x + 20, y + 72, 'No coding activity recorded in this period.', 'empty'));
    return out;
  }

  const cols = 2;
  const colW = (w - 40) / cols;
  const rowH = 62;
  items.slice(0, 6).forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const ix = x + 20 + col * colW;
    const iy = y + 60 + row * rowH;
    out.push(text(ix, iy, it.label.toUpperCase(), 'label'));
    const maxW = colW - 16;
    let value = fitText(it.value, 15, maxW);
    const subFits = it.sub && textWidth(value, 15) + textWidth(` · ${it.sub}`, 13) <= maxW;
    const sub = subFits ? `<tspan class="ins-sub"> · ${esc(it.sub)}</tspan>` : '';
    out.push(`<text x="${round(ix)}" y="${round(iy + 22)}" class="ins">${esc(value)}${sub}</text>`);
  });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────

(async () => {
  try {
    const raw = await loadRaw();
    const stats = computeStats(raw);
    const svg = render(stats);

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, svg, 'utf8');

    log(`Range ${stats.start} → ${stats.end} (${stats.timezone})`);
    log(`Total ${fmtDuration(stats.totalSeconds)} · active days ${stats.activeDays}/${stats.days.length} · languages ${stats.languages.length}`);
    log(`Sessions/heatmap: ${stats.heatmap ? 'available' : 'omitted'}`);
    log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${svg.length} bytes)`);
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
})();
