'use strict';

/**
 * Shared helpers: logging, formatting, dates, text measurement, colour math.
 * Zero dependencies.
 */

const log = (msg) => process.stdout.write(`${msg}\n`);
const warn = (msg) => process.stderr.write(`warning: ${msg}\n`);
const fail = (msg) => { process.stderr.write(`error: ${msg}\n`); process.exit(1); };

const sum = (arr) => arr.reduce((a, b) => a + b, 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad2 = (n) => String(n).padStart(2, '0');
const round = (v, d = 2) => Number(Number(v).toFixed(d));
const uniq = (arr) => [...new Set(arr)];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Time zones & dates ──────────────────────────────────────────────────────

function isValidTimezone(tz) {
  if (!tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** YYYY-MM-DD of a Date in a given IANA timezone. */
function localDate(date, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return `${p.year}-${p.month}-${p.day}`;
}

/** Seconds since local midnight for a unix timestamp in a timezone. */
function secondsOfDay(unix, tz) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(unix * 1000)).reduce((acc, x) => (acc[x.type] = x.value, acc), {});
  return (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
}

function localClock(unix, tz) {
  const s = secondsOfDay(unix, tz);
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}`;
}

function parseDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const toYMD = (date) => `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
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
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);

/** "44h 23m", "23m", "0m" */
function fmtDuration(seconds) {
  const total = Math.round(Math.max(0, seconds || 0) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h === 0 ? `${m}m` : `${h}h ${pad2(m)}m`;
}

function fmtHours(h) {
  if (h === 0) return '0';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h}h`;
}

const fmtPercent = (p) => `${p.toFixed(1)}%`;
const fmtInt = (n) => String(Math.round(n));

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
const monthShort = (ymd) => MONTHS[parseDate(ymd).getUTCMonth()].toUpperCase();

// ── Text measurement (estimates: GitHub renders with the viewer's system font) ──

/**
 * Conservative width estimate (px) for a UI sans-serif at a given size.
 * We never measure the real font; we over-estimate and lay out with margin.
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

/** Shorten with an ellipsis until it fits the given pixel width. */
function fitText(str, size, maxWidth) {
  let s = String(str);
  if (textWidth(s, size) <= maxWidth) return s;
  while (s.length > 1 && textWidth(`${s}…`, size) > maxWidth) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Greedy word wrap into at most maxLines lines; the last line is ellipsised if needed. */
function wrapText(str, size, maxWidth, maxLines) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, size) <= maxWidth) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    if (lines.length === maxLines) break;
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length > maxLines) lines.length = maxLines;
  const consumed = lines.join(' ').length;
  if (consumed < words.join(' ').length && lines.length) lines[lines.length - 1] = fitText(`${lines[lines.length - 1]} …`, size, maxWidth);
  return lines.map((l) => (textWidth(l, size) > maxWidth ? fitText(l, size, maxWidth) : l));
}

/** Natural-language list: "A, B and C" */
function listPhrase(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

// ── Colour & scales ─────────────────────────────────────────────────────────

/** Mix two hex colours. t = 0 → a, t = 1 → b. */
function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16));
  const pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** Choose a tick step (hours) so an axis has 3–5 gridlines. */
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

module.exports = {
  log, warn, fail, sum, clamp, pad2, round, uniq, esc,
  MONTHS, WEEKDAYS,
  isValidTimezone, localDate, secondsOfDay, localClock,
  parseDate, toYMD, addDays, eachDay, weekdayName, weekdayShort, daysBetween,
  fmtDuration, fmtHours, fmtPercent, fmtInt, fmtDateRange, fmtDateShort, monthShort,
  textWidth, fitText, wrapText, listPhrase,
  mix, niceScale,
};
