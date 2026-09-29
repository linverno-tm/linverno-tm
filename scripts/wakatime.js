'use strict';

/**
 * WakaTime data source.
 *
 *   GET /users/current                    → account timezone
 *   GET /users/current/summaries          → per-day totals and per-day languages
 *   GET /users/current/durations?date=…   → raw coding durations (sessions, hour-of-day heatmap)
 *
 * The API key is sent only as a Basic auth header. It is never logged and never
 * reaches the rendered output.
 */

const fs = require('fs');
const U = require('./util');

const API_BASE = 'https://wakatime.com/api/v1';
const DAYS = 7;
const TOP_LANGUAGES = 5;
const ACTIVE_DAY_MIN_SECONDS = 60;
const HEAT_COLS = 12; // 2-hour blocks

function makeClient(apiKey) {
  const auth = `Basic ${Buffer.from(apiKey, 'utf8').toString('base64')}`;
  return async function request(endpoint, params = {}) {
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'github-profile-dashboard' },
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

async function fetchWakaTime({ apiKey, rangeEnd = 'yesterday', timezoneOverride, fixture } = {}) {
  if (fixture) {
    U.log(`WakaTime: using fixture ${fixture}`);
    return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }
  if (!apiKey || !apiKey.trim()) throw new Error('WAKATIME_API_KEY is not set');
  const api = makeClient(apiKey.trim());

  let timezone = timezoneOverride;
  if (!timezone) {
    try {
      const me = await api('/users/current');
      timezone = me && me.data && me.data.timezone;
    } catch (e) {
      U.warn(`WakaTime: could not read account timezone (${e.message}); falling back to UTC`);
    }
  }
  if (!U.isValidTimezone(timezone)) {
    if (timezone) U.warn(`WakaTime: unknown timezone "${timezone}"; falling back to UTC`);
    timezone = 'UTC';
  }

  const today = U.localDate(new Date(), timezone);
  const end = rangeEnd === 'today' ? today : U.addDays(today, -1);
  const start = U.addDays(end, -(DAYS - 1));

  const summaries = await api('/users/current/summaries', { start, end, timezone });

  const durations = {};
  for (const date of U.eachDay(start, end)) {
    try {
      durations[date] = await api('/users/current/durations', { date, timezone });
    } catch (e) {
      U.warn(`WakaTime: durations for ${date} unavailable (${e.message}); session metrics will be omitted`);
      durations[date] = null;
    }
  }
  return { timezone, today, start, end, summaries, durations };
}

function computeWakaStats(raw, sessionGapSec = 15 * 60) {
  const tz = U.isValidTimezone(raw.timezone) ? raw.timezone : 'UTC';
  const dates = U.eachDay(raw.start, raw.end);
  if (!dates.length) throw new Error('WakaTime: invalid date range');

  const rows = Array.isArray(raw.summaries && raw.summaries.data) ? raw.summaries.data : [];
  const byDate = new Map(rows.filter((r) => r && r.range && r.range.date).map((r) => [r.range.date, r]));

  const days = dates.map((date) => {
    const row = byDate.get(date);
    const seconds = Number(row && row.grand_total && row.grand_total.total_seconds) || 0;
    const languages = (row && Array.isArray(row.languages) ? row.languages : []).filter((l) => l && l.name && Number(l.total_seconds) > 0);
    return { date, seconds, languages };
  });

  const totalSeconds = U.sum(days.map((d) => d.seconds));
  const activeDays = days.filter((d) => d.seconds >= ACTIVE_DAY_MIN_SECONDS).length;
  const dailyAverage = totalSeconds / days.length;
  const avgPerActiveDay = activeDays ? totalSeconds / activeDays : 0;
  const bestDay = totalSeconds > 0 ? days.reduce((a, b) => (b.seconds > a.seconds ? b : a)) : null;

  const langTotals = new Map();
  for (const d of days) for (const l of d.languages) langTotals.set(l.name, (langTotals.get(l.name) || 0) + Number(l.total_seconds));
  const langTotal = U.sum([...langTotals.values()]);
  const sorted = [...langTotals.entries()].map(([name, seconds]) => ({ name, seconds })).sort((a, b) => b.seconds - a.seconds);
  const named = sorted.filter((l) => l.name.toLowerCase() !== 'other');
  const top = named.slice(0, TOP_LANGUAGES);
  const otherSeconds = U.sum(named.slice(TOP_LANGUAGES).map((l) => l.seconds)) + U.sum(sorted.filter((l) => l.name.toLowerCase() === 'other').map((l) => l.seconds));
  const languages = top.map((l, i) => ({ ...l, percent: langTotal ? (l.seconds / langTotal) * 100 : 0, rank: i, other: false }));
  if (otherSeconds > 0) languages.push({ name: 'Other', seconds: otherSeconds, percent: langTotal ? (otherSeconds / langTotal) * 100 : 0, rank: -1, other: true });

  const detail = analyzeDurations(raw.durations, dates, tz, sessionGapSec);

  return {
    timezone: tz,
    start: raw.start,
    end: raw.end,
    generated: raw.today || U.localDate(new Date(), tz),
    days, totalSeconds, activeDays, dailyAverage, avgPerActiveDay, bestDay,
    languages, langTotal,
    mostUsed: top[0] || null,
    longestSession: detail ? detail.longest : null,
    heatmap: detail ? detail.buckets : null,
    peak: detail ? peakBlock(detail.buckets) : null,
    heatCols: HEAT_COLS,
  };
}

function analyzeDurations(durations, dates, tz, gapSec) {
  if (!durations) return null;
  if (!dates.every((d) => durations[d] && Array.isArray(durations[d].data))) return null;

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
      let s = U.secondsOfDay(it.time, tz);
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
      if (cur && start - cur.end <= gapSec) {
        cur.end = Math.max(cur.end, end);
        cur.active += it.duration;
      } else {
        if (cur) consider(cur);
        cur = { date, start, end, active: it.duration };
      }
    }
    if (cur) consider(cur);
  });

  if (longest) longest = { ...longest, startClock: U.localClock(longest.start, tz), endClock: U.localClock(longest.end, tz) };
  return { buckets, longest };
}

function peakBlock(buckets) {
  const cols = new Array(HEAT_COLS).fill(0);
  for (const row of buckets) row.forEach((v, i) => { cols[i] += v; });
  const max = Math.max(...cols);
  if (max <= 0) return null;
  const i = cols.indexOf(max);
  const hours = 24 / HEAT_COLS;
  return { from: `${U.pad2(i * hours)}:00`, to: `${U.pad2((i + 1) * hours)}:00`, seconds: max };
}

module.exports = { fetchWakaTime, computeWakaStats };
