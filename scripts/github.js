'use strict';

/**
 * GitHub data source + repository analyzer.
 *
 *   GET /user                                            → login (with a personal access token)
 *   GET /user/repos?affiliation=owner,collaborator       → repositories incl. private (PAT)
 *   GET /users/{login}/repos                             → public repositories only (no PAT)
 *   per repository:
 *     /languages, /git/trees/{branch}?recursive=1, /readme, /contents/{manifest}, /commits
 *
 * Everything returned here is INTERNAL. Private repository data must pass through
 * sanitize.js before it can be rendered. This module never logs repository names,
 * descriptions, file contents or API responses — only counts.
 */

const fs = require('fs');
const U = require('./util');
const V = require('./vocab');

const API_BASE = 'https://api.github.com';
const ACTIVITY_WEEKS = 26;
const MAX_MANIFESTS = 8;
const MAX_MANIFEST_BYTES = 200000;

// ───────────────────────────────────────────────────────────────────────────────
// Client
// ───────────────────────────────────────────────────────────────────────────────

function makeClient(token) {
  const base = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'github-profile-dashboard' };
  if (token) base.Authorization = `Bearer ${token}`;
  const state = { remaining: Infinity, calls: 0 };

  /** `label` is used in messages instead of the endpoint so private names never reach logs. */
  async function request(endpoint, { params = {}, raw = false, allow = [], label = 'request' } = {}) {
    const url = new URL(API_BASE + endpoint);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const headers = raw ? { ...base, Accept: 'application/vnd.github.raw+json' } : base;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
        state.calls++;
        const rem = Number(res.headers.get('x-ratelimit-remaining'));
        if (Number.isFinite(rem)) state.remaining = rem;
        if (allow.includes(res.status)) return { status: res.status, data: null, headers: res.headers };
        if (res.status === 403 && rem === 0) { const e = new Error(`${label}: API rate limit exhausted`); e.fatal = true; throw e; }
        if (res.status === 202 || res.status === 429 || res.status >= 500) throw new Error(`${label}: HTTP ${res.status}`);
        if (!res.ok) { const e = new Error(`${label}: HTTP ${res.status}`); e.fatal = true; throw e; }
        return { status: res.status, data: raw ? await res.text() : await res.json(), headers: res.headers };
      } catch (e) {
        lastError = e;
        if (e.fatal) break;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    throw lastError;
  }
  return { request, state };
}

const isPersonalToken = (token) => /^(ghp_|github_pat_)/.test(token || '');

// ───────────────────────────────────────────────────────────────────────────────
// Fetch
// ───────────────────────────────────────────────────────────────────────────────

const MANIFEST_ROOT = ['pubspec.yaml', 'package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'composer.json', 'go.mod', 'Cargo.toml', 'Gemfile',
  'build.gradle', 'build.gradle.kts', 'app/build.gradle', 'app/build.gradle.kts', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc', 'firebase.json'];
const MANIFEST_NESTED = /^(?!node_modules\/|build\/|dist\/|\.dart_tool\/|vendor\/)[^/]+\/(package\.json|pubspec\.yaml|requirements\.txt|pyproject\.toml)$/;

function selectManifests(tree) {
  const bySize = new Map(tree.map((t) => [t.path, t.size]));
  const paths = tree.map((t) => t.path);
  const root = MANIFEST_ROOT.filter((p) => bySize.has(p));
  const nested = paths.filter((p) => MANIFEST_NESTED.test(p)).sort();
  return U.uniq([...root, ...nested]).filter((p) => (bySize.get(p) || 0) <= MAX_MANIFEST_BYTES).slice(0, MAX_MANIFESTS);
}

function pickMeta(r) {
  return {
    name: r.name, full_name: r.full_name, owner: r.owner && r.owner.login, private: !!r.private, fork: !!r.fork, archived: !!r.archived,
    disabled: !!r.disabled, description: r.description || '', topics: Array.isArray(r.topics) ? r.topics : [], size: r.size || 0,
    stargazers_count: r.stargazers_count || 0, forks_count: r.forks_count || 0, pushed_at: r.pushed_at, created_at: r.created_at, updated_at: r.updated_at,
    default_branch: r.default_branch, html_url: r.html_url, homepage: r.homepage || '', language: r.language || null,
    license: r.license && r.license.spdx_id ? r.license.spdx_id : null, visibility: r.visibility || (r.private ? 'private' : 'public'),
  };
}

async function fetchRepoDetails(api, meta, login, sinceISO, index) {
  const full = meta.full_name;
  const label = `repo #${index}`;
  const out = { meta, languages: {}, tree: [], readme: '', manifests: {}, commits: [], commitTotal: null, truncatedTree: false, detailErrors: 0 };
  const attempt = async (fn) => { try { await fn(); } catch (e) { out.detailErrors++; if (e.fatal && /rate limit/.test(e.message)) throw e; U.warn(`${label}: ${e.message}`); } };

  await attempt(async () => { out.languages = (await api.request(`/repos/${full}/languages`, { label: `${label} languages` })).data || {}; });

  if (meta.default_branch) {
    await attempt(async () => {
      const t = await api.request(`/repos/${full}/git/trees/${encodeURIComponent(meta.default_branch)}`, { params: { recursive: 1 }, allow: [404, 409], label: `${label} tree` });
      if (t.data && Array.isArray(t.data.tree)) {
        out.tree = t.data.tree.filter((x) => x.type === 'blob').map((x) => ({ path: x.path, size: x.size || 0 }));
        out.truncatedTree = !!t.data.truncated;
      }
    });
  }

  await attempt(async () => {
    const r = await api.request(`/repos/${full}/readme`, { raw: true, allow: [404], label: `${label} readme` });
    if (r.data) out.readme = String(r.data).slice(0, 30000);
  });

  for (const p of selectManifests(out.tree)) {
    await attempt(async () => {
      const c = await api.request(`/repos/${full}/contents/${p.split('/').map(encodeURIComponent).join('/')}`, { raw: true, allow: [404], label: `${label} manifest` });
      if (c.data) out.manifests[p] = String(c.data).slice(0, 60000);
    });
  }

  await attempt(async () => {
    for (let page = 1; page <= 3; page++) {
      const c = await api.request(`/repos/${full}/commits`, { params: { author: login, since: sinceISO, per_page: 100, page }, allow: [409], label: `${label} commits` });
      if (!c.data || !c.data.length) break;
      out.commits.push(...c.data.map((x) => x.commit && ((x.commit.author && x.commit.author.date) || (x.commit.committer && x.commit.committer.date))).filter(Boolean));
      if (c.data.length < 100) break;
    }
  });

  await attempt(async () => {
    const c = await api.request(`/repos/${full}/commits`, { params: { per_page: 1 }, allow: [409], label: `${label} commit count` });
    if (!c.data) { out.commitTotal = 0; return; }
    const link = c.headers.get('link') || '';
    const m = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
    out.commitTotal = m ? Number(m[1]) : c.data.length;
  });

  return out;
}

/**
 * Returns { login, fetchedAt, windowStart, repos: [RepoRaw], partial, apiCalls, mode }.
 * mode: 'private' (PAT: public + private repositories) or 'public' (public only).
 */
async function fetchGitHub({ token, login, fixture, now = new Date() } = {}) {
  if (fixture) {
    U.log(`GitHub: using fixture ${fixture}`);
    return JSON.parse(fs.readFileSync(fixture, 'utf8'));
  }
  const api = makeClient(token);
  const pat = isPersonalToken(token);
  const mode = pat ? 'private' : 'public';

  if (!login && pat) {
    const me = await api.request('/user', { label: 'user' });
    login = me.data && me.data.login;
  }
  if (!login) throw new Error('GitHub login unknown: set GITHUB_REPOSITORY_OWNER or provide a personal access token');

  const list = [];
  for (let page = 1; page <= 10; page++) {
    const endpoint = pat ? '/user/repos' : `/users/${encodeURIComponent(login)}/repos`;
    const params = pat ? { per_page: 100, page, affiliation: 'owner,collaborator', sort: 'pushed' } : { per_page: 100, page, type: 'owner', sort: 'pushed' };
    const r = await api.request(endpoint, { params, label: 'repository list' });
    if (!Array.isArray(r.data) || !r.data.length) break;
    list.push(...r.data);
    if (r.data.length < 100) break;
  }

  const since = new Date(now.getTime() - ACTIVITY_WEEKS * 7 * 86400000);
  const sinceISO = since.toISOString();
  const metas = list.map(pickMeta).filter((m) => !m.fork && m.name.toLowerCase() !== login.toLowerCase());
  U.log(`GitHub: ${list.length} repositories listed (${mode} mode), ${metas.length} candidates`);

  const repos = [];
  let partial = false;
  for (let i = 0; i < metas.length; i++) {
    if (api.state.remaining < 25) { partial = true; U.warn('GitHub: rate limit nearly exhausted — remaining repositories skipped'); break; }
    try {
      repos.push(await fetchRepoDetails(api, metas[i], login, sinceISO, i + 1));
    } catch (e) {
      partial = true;
      U.warn(`GitHub: stopped early (${e.message})`);
      break;
    }
  }
  return { login, fetchedAt: now.toISOString(), windowStart: sinceISO, repos, partial, apiCalls: api.state.calls, mode };
}

// ───────────────────────────────────────────────────────────────────────────────
// Manifest parsing → namespaced dependency set + flags
// ───────────────────────────────────────────────────────────────────────────────

function parseManifests(manifests, flags, deps) {
  const add = (eco, name) => {
    if (!name) return;
    const n = String(name).toLowerCase().trim();
    if (!n) return;
    deps.add(`${eco}:${n}`);
    deps.add(`${eco}:${n.replace(/_/g, '-')}`);
    deps.add(`${eco}:${n.replace(/-/g, '_')}`);
  };
  for (const [path, text] of Object.entries(manifests)) {
    const file = path.split('/').pop();
    try {
      if (file === 'pubspec.yaml') {
        if (/^\s+sdk:\s*flutter\s*$/m.test(text) || /^\s{2}flutter:\s*$/m.test(text)) flags.flutter = true;
        else flags.dartPackage = true;
        const section = /^(dependencies|dev_dependencies):\s*$([\s\S]*?)(?=^\S|\Z)/gm;
        let m;
        while ((m = section.exec(text))) for (const line of m[2].split('\n')) { const d = line.match(/^\s{2}([a-z0-9_]+):/); if (d) add('dart', d[1]); }
      } else if (file === 'package.json') {
        const j = JSON.parse(text);
        flags.node = true;
        if (j.bin) flags.npmBin = true;
        for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) if (j[k] && typeof j[k] === 'object') for (const n of Object.keys(j[k])) add('npm', n);
      } else if (file === 'requirements.txt') {
        for (const line of text.split('\n')) { const d = line.trim().match(/^([A-Za-z0-9][A-Za-z0-9_.\-]*)/); if (d && !line.trim().startsWith('#') && !line.trim().startsWith('-')) add('py', d[1]); }
      } else if (file === 'pyproject.toml') {
        if (/^\[project\]/m.test(text) && !/^\[tool\.poetry\]/m.test(text)) flags.pyPackage = true;
        const arrays = /dependencies\s*=\s*\[([\s\S]*?)\]/g;
        let m;
        while ((m = arrays.exec(text))) for (const q of m[1].match(/["']([A-Za-z0-9_.\-]+)/g) || []) add('py', q.slice(1));
        const poetry = text.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=^\[|\Z)/m);
        if (poetry) for (const line of poetry[1].split('\n')) { const d = line.match(/^([A-Za-z0-9_.\-]+)\s*=/); if (d && d[1].toLowerCase() !== 'python') add('py', d[1]); }
      } else if (file === 'Pipfile') {
        const sec = text.match(/\[packages\]([\s\S]*?)(?=^\[|\Z)/m);
        if (sec) for (const line of sec[1].split('\n')) { const d = line.match(/^([A-Za-z0-9_.\-]+)\s*=/); if (d) add('py', d[1]); }
      } else if (file === 'composer.json') {
        const j = JSON.parse(text);
        for (const k of ['require', 'require-dev']) if (j[k]) for (const n of Object.keys(j[k])) add('php', n);
      } else if (file === 'go.mod') {
        for (const m of text.matchAll(/^\s*([a-z0-9.\-]+\/[^\s]+)\s+v/gm)) { add('go', m[1]); add('go', m[1].split('/').pop()); }
      } else if (file === 'Cargo.toml') {
        const sec = text.match(/\[dependencies\]([\s\S]*?)(?=^\[|\Z)/m);
        if (sec) for (const line of sec[1].split('\n')) { const d = line.match(/^([A-Za-z0-9_\-]+)\s*=/); if (d) add('rust', d[1]); }
      } else if (file === 'Gemfile') {
        for (const m of text.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) add('ruby', m[1]);
      } else if (/^build\.gradle(\.kts)?$/.test(file)) {
        for (const m of text.matchAll(/(?:implementation|api|compile)\s*\(?\s*['"]([^'"]+):([^'":]+):/g)) add('gradle', m[2]);
        if (/com\.android\.application/.test(text)) flags.androidNative = true;
      } else if (/^wrangler\.(toml|json|jsonc)$/.test(file)) {
        flags.workers = true;
        if (/d1_databases/.test(text)) flags.d1 = true;
      } else if (file === 'firebase.json') {
        flags.firebase = true;
      }
    } catch { /* malformed manifest — ignore */ }
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Detection
// ───────────────────────────────────────────────────────────────────────────────

function keywordMatcher(text) {
  const cache = new Map();
  return (kw) => {
    if (cache.has(kw)) return cache.get(kw);
    const k = kw.toLowerCase();
    let hit;
    if (/^[a-z0-9]+$/.test(k)) hit = new RegExp(`(^|[^a-z0-9])${k}([^a-z0-9]|$)`).test(text);
    else hit = text.includes(k);
    cache.set(kw, hit);
    return hit;
  };
}

function detectTechnologies(ctx) {
  const found = new Set();
  const { langBytes, totalBytes, deps, paths, has, flags } = ctx;
  for (const t of V.TECHNOLOGIES) {
    let hit = false;
    if (t.lang) {
      const langs = Array.isArray(t.lang) ? t.lang : [t.lang];
      const bytes = U.sum(langs.map((l) => langBytes[l] || 0));
      const min = t.minBytes || 2000;
      if (bytes >= min && (totalBytes === 0 || bytes / totalBytes >= 0.01)) hit = true;
    }
    if (!hit && t.flag && flags[t.flag]) hit = true;
    if (!hit && t.deps && t.deps.some((d) => deps.has(d))) hit = true;
    if (!hit && t.files && paths.some((p) => t.files.some((re) => re.test(p)))) hit = true;
    if (!hit && t.keywords && t.keywords.some(has)) hit = true;
    if (hit) found.add(t.name);
  }
  if (flags.flutter) { found.add('Flutter'); found.add('Dart'); }
  if (found.has('Flutter') && flags.flutterWebOnly && !flags.flutterMobile) found.delete('Kotlin');
  return [...found];
}

function detectCapabilities(ctx) {
  const found = new Set();
  const { deps, paths, has, flags } = ctx;
  for (const c of V.CAPABILITIES) {
    let hit = false;
    if (c.flag && flags[c.flag]) hit = true;
    if (!hit && c.deps && c.deps.some((d) => deps.has(d))) hit = true;
    if (!hit && c.files && paths.some((p) => c.files.some((re) => re.test(p)))) hit = true;
    if (!hit && c.keywords && c.keywords.some(has)) hit = true;
    if (hit) found.add(c.name);
  }
  return [...found];
}

function scoreCategories(ctx, techs, caps) {
  const techSet = new Set(techs), capSet = new Set(caps);
  const { has, flags, paths } = ctx;
  const fileSignals = {
    action: paths.some((p) => /^action\.ya?ml$/.test(p)),
    terraform: paths.some((p) => /\.tf$/.test(p)),
    helm: paths.some((p) => /(^|\/)Chart\.yaml$/.test(p)),
    ansible: paths.some((p) => /(^|\/)(playbook|site)\.ya?ml$/.test(p) || /^ansible\//.test(p)),
  };
  const scores = {};
  for (const cat of V.CATEGORIES) {
    let s = 0;
    for (const [t, w] of Object.entries(cat.techs || {})) if (techSet.has(t)) s += w;
    for (const [c, w] of Object.entries(cat.caps || {})) if (capSet.has(c)) s += w;
    for (const [k, w] of Object.entries(cat.keywords || {})) if (has(k)) s += w;
    for (const [f, w] of Object.entries(cat.flags || {})) if (flags[f]) s += w;
    for (const [f, w] of Object.entries(cat.files || {})) if (fileSignals[f]) s += w;
    scores[cat.name] = s;
  }
  // A marketing/landing site that merely mentions a business is not business software.
  if (capSet.has('Static site generation') && !techSet.has('PostgreSQL') && !techSet.has('Prisma') && !techSet.has('Supabase') && !techSet.has('Firebase')) {
    scores['Business Software'] = Math.max(0, scores['Business Software'] - 4);
    scores['E-commerce'] = Math.max(0, scores['E-commerce'] - 4);
  }
  return scores;
}

function pickCategories(scores) {
  const members = [];
  for (const cat of V.CATEGORIES) {
    const min = cat.minScore || 2;
    if (scores[cat.name] >= min) members.push(cat.name);
  }
  // Primary: a clearly detected domain (what the project is for) beats the platform it runs on.
  let primary = null, best = -1;
  const strongDomain = V.CATEGORIES.filter((c) => c.domain && members.includes(c.name) && scores[c.name] >= 4);
  const pool = strongDomain.length ? strongDomain : V.CATEGORIES.filter((c) => members.includes(c.name));
  for (const cat of pool) {
    const s = scores[cat.name] + (cat.domain ? 0.5 : 0);
    if (s > best) { best = s; primary = cat.name; }
  }
  let platform = null, pbest = -1;
  for (const cat of V.CATEGORIES) {
    if (!cat.platform || !members.includes(cat.name)) continue;
    if (scores[cat.name] > pbest) { pbest = scores[cat.name]; platform = V.PLATFORMS[cat.name]; }
  }
  return { members, primary, platform };
}

function maturityOf(meta, primary, commitTotal, now) {
  if (meta.archived) return 'Archived';
  if (primary === 'Experimental') return 'Experimental';
  const days = meta.pushed_at ? (now - new Date(meta.pushed_at)) / 86400000 : Infinity;
  if (days <= 45) return 'Active';
  if (days <= 365) return 'Maintained';
  return 'Archived';
}

function analyzeRepo(raw, login, now) {
  const meta = raw.meta;
  const paths = (raw.tree || []).map((t) => t.path);
  const langBytes = raw.languages || {};
  const totalBytes = U.sum(Object.values(langBytes).map(Number));
  const deps = new Set();
  const flags = {};
  parseManifests(raw.manifests || {}, flags, deps);

  const top = new Set(paths.map((p) => p.split('/')[0]));
  const hasMobileDirs = top.has('android') || top.has('ios');
  const hasDesktopDirs = top.has('windows') || top.has('linux') || top.has('macos');
  if (flags.flutter) {
    flags.flutterMobile = hasMobileDirs;
    flags.flutterWebOnly = top.has('web') && !hasMobileDirs;
    flags.flutterDesktopOnly = hasDesktopDirs && !hasMobileDirs && !top.has('web');
    const kt = langBytes.Kotlin || 0, sw = langBytes.Swift || 0, jv = langBytes.Java || 0;
    if (kt >= 4000 || sw >= 4000 || jv >= 4000) flags.nativeInFlutter = true;
  } else {
    if (paths.some((p) => /(^|\/)AndroidManifest\.xml$/.test(p)) && (langBytes.Kotlin || langBytes.Java)) flags.androidNative = true;
    if (paths.some((p) => /\.xcodeproj\//.test(p)) && langBytes.Swift) flags.iosNative = true;
  }
  if (!flags.node && paths.some((p) => /^index\.html$/.test(p)) && !flags.flutter) flags.staticSite = true;
  const commitTotal = Number.isFinite(raw.commitTotal) ? raw.commitTotal : null;
  if (commitTotal != null && commitTotal <= 3 && (meta.size || 0) < 100) flags.tiny = true;

  const nameWords = meta.name.replace(/[-_.]+/g, ' ');
  const text = `${nameWords} ${meta.description || ''} ${(meta.topics || []).join(' ')} ${(raw.readme || '').slice(0, 20000)}`.toLowerCase();
  const has = keywordMatcher(text);
  const ctx = { langBytes, totalBytes, deps, paths, has, flags };

  const techs = detectTechnologies(ctx);
  const caps = detectCapabilities(ctx);
  const scores = scoreCategories(ctx, techs, caps);
  const { members, primary, platform } = pickCategories(scores);

  const isEmpty = paths.length === 0 && totalBytes === 0;
  const nonProject = V.NON_PROJECT_KEYWORDS.some((k) => `${nameWords} ${meta.description || ''}`.toLowerCase().includes(k));
  let excluded = null;
  if (isEmpty) excluded = 'empty';
  else if (nonProject) excluded = 'non-project';
  else if (techs.length === 0 && !primary) excluded = 'insufficient-data';

  return {
    name: meta.name, fullName: meta.full_name, owner: meta.owner, private: meta.private, archived: meta.archived,
    description: meta.description || '', topics: meta.topics || [], url: meta.html_url, homepage: meta.homepage || '',
    stars: meta.stargazers_count || 0, forks: meta.forks_count || 0, sizeKB: meta.size || 0,
    pushedAt: meta.pushed_at || null, createdAt: meta.created_at || null, license: meta.license,
    techs, caps, categories: members, primary, platform, scores,
    maturity: maturityOf(meta, primary, commitTotal, now),
    commits: (raw.commits || []).map((d) => String(d).slice(0, 10)),
    commitTotal, excluded, truncatedTree: !!raw.truncatedTree, detailErrors: raw.detailErrors || 0,
  };
}

function analyzeAll(fetched, now = new Date()) {
  const repos = fetched.repos.map((r) => analyzeRepo(r, fetched.login, now));
  const excluded = repos.filter((r) => r.excluded);
  U.log(`GitHub: analyzed ${repos.length} repositories · ${repos.length - excluded.length} projects · ${excluded.length} excluded (${U.uniq(excluded.map((r) => r.excluded)).join(', ') || 'none'})`);
  return { login: fetched.login, fetchedAt: fetched.fetchedAt, windowStart: fetched.windowStart, partial: !!fetched.partial, mode: fetched.mode || 'public', repos };
}

module.exports = { fetchGitHub, analyzeAll, analyzeRepo, ACTIVITY_WEEKS };
