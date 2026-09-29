#!/usr/bin/env node
'use strict';

/**
 * Developer profile generator
 *
 *   WakaTime API ─┐
 *                 ├─→ statistics ─→ SVG ─→ assets/profile.svg
 *   GitHub API ───┘   (repository analyzer → privacy sanitizer → public portfolio data)
 *
 * Environment variables
 *   WAKATIME_API_KEY           required. Basic-auth header only; never logged, never rendered.
 *   GH_PORTFOLIO_TOKEN         optional. A fine-grained personal access token with read access to
 *                              repository Contents + Metadata. Enables private-repository analysis.
 *                              Used only for API calls; never logged, never rendered.
 *   GITHUB_TOKEN               fallback (Actions default token): public repositories only.
 *   GITHUB_REPOSITORY_OWNER    GitHub login (set automatically in Actions).
 *   WAKATIME_RANGE_END         "yesterday" (default) or "today"
 *   WAKATIME_TIMEZONE          IANA timezone override
 *   WAKATIME_SESSION_GAP_MIN   break longer than this ends a session (default 15)
 *   PROFILE_OUTPUT             output SVG path (default assets/profile.svg)
 *   WAKATIME_FIXTURE / GITHUB_FIXTURE   JSON fixtures for local development (no API calls)
 *
 * Privacy: private repositories are described only with vocabulary from vocab.js. Both the
 * portfolio data and the final SVG are checked (sanitize.js); on any violation the process
 * exits non-zero and nothing is written.
 */

const fs = require('fs');
const path = require('path');
const U = require('./util');
const { fetchWakaTime, computeWakaStats } = require('./wakatime');
const { fetchGitHub, analyzeAll } = require('./github');
const S = require('./sanitize');
const { renderProfile } = require('./render');

const OUTPUT = process.env.PROFILE_OUTPUT || path.join(__dirname, '..', 'assets', 'profile.svg');
const CACHE = path.join(path.dirname(OUTPUT), 'portfolio.json');

async function loadPortfolio(now) {
  const token = process.env.GH_PORTFOLIO_TOKEN || process.env.GITHUB_TOKEN || '';
  const login = process.env.GITHUB_REPOSITORY_OWNER || process.env.GH_LOGIN || '';
  if (!process.env.GITHUB_FIXTURE && !token && !login) {
    U.warn('GitHub: no token and no repository owner configured — portfolio sections skipped');
    return { portfolio: null, analysis: null };
  }
  try {
    const fetched = await fetchGitHub({ token, login, fixture: process.env.GITHUB_FIXTURE, now });
    const analysis = analyzeAll(fetched, now);
    const portfolio = S.buildPortfolio(analysis, now);
    S.validatePortfolio(portfolio, analysis); // throws → build aborted (privacy is a hard failure)
    return { portfolio, analysis };
  } catch (e) {
    if (/sanitizer|privacy|secret/.test(e.message)) throw e;
    U.warn(`GitHub: ${e.message}`);
    if (fs.existsSync(CACHE)) {
      U.warn('GitHub: using the last successfully sanitized portfolio cache');
      return { portfolio: JSON.parse(fs.readFileSync(CACHE, 'utf8')), analysis: null, cached: true };
    }
    U.warn('GitHub: portfolio sections skipped');
    return { portfolio: null, analysis: null };
  }
}

(async () => {
  try {
    const now = new Date();
    const wakaRaw = await fetchWakaTime({
      apiKey: process.env.WAKATIME_API_KEY,
      rangeEnd: (process.env.WAKATIME_RANGE_END || 'yesterday').toLowerCase(),
      timezoneOverride: process.env.WAKATIME_TIMEZONE,
      fixture: process.env.WAKATIME_FIXTURE,
    });
    const waka = computeWakaStats(wakaRaw, Math.max(1, Number(process.env.WAKATIME_SESSION_GAP_MIN) || 15) * 60);

    const { portfolio, analysis, cached } = await loadPortfolio(now);

    const svg = renderProfile({ waka, portfolio });

    // Final-output assertions (second, independent privacy layer)
    S.assertNoSecrets(svg);
    if (analysis) S.assertNoLeak(svg, S.buildBlocklist(analysis), 'SVG');

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, svg, 'utf8');
    if (portfolio && !cached) fs.writeFileSync(CACHE, JSON.stringify(portfolio, null, 1) + '\n', 'utf8');

    U.log(`WakaTime: ${waka.start} → ${waka.end} (${waka.timezone}) · ${U.fmtDuration(waka.totalSeconds)} · active days ${waka.activeDays}/${waka.days.length} · sessions ${waka.heatmap ? 'available' : 'omitted'}`);
    if (portfolio) {
      const c = portfolio.counts;
      U.log(`GitHub: ${c.projects} projects (${c.public} public, ${c.private} private, ${c.excluded} excluded) · ${portfolio.technologies.length} technologies · ${portfolio.categories.length} categories · ${portfolio.activity.total} commits in window${cached ? ' · from cache' : ''}`);
    }
    U.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${svg.length} bytes)`);
  } catch (e) {
    U.fail(e && e.message ? e.message : String(e));
  }
})();
