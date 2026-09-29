'use strict';

/**
 * Privacy Sanitizer.
 *
 *   GitHub API → Repository Analyzer → [ sanitize.js ] → Public Portfolio Data → SVG Generator
 *
 * Guarantees:
 *   1. Private repositories are described ONLY with strings from vocab.js: an anonymous
 *      title, category, platform, technologies, capabilities and maturity. Their names,
 *      descriptions, URLs, topics, owners, README and file contents never leave this module.
 *   2. validatePortfolio() walks EVERY string in the portfolio and throws if it is not in the
 *      allowed set (vocabulary ∪ public-repository facts ∪ fixed formats). A renderer can only
 *      show what passed this check.
 *   3. buildBlocklist() + assertNoLeak() independently scan the final SVG for private identifiers
 *      (names, name fragments, URLs, topics, collaborator logins). Any hit fails the build, so
 *      nothing is committed.
 *
 * Error messages never include the offending string.
 */

const U = require('./util');
const V = require('./vocab');

const AREA_LABELS = { mobile: 'Mobile', web: 'Web', backend: 'Backend', database: 'Database', desktop: 'Desktop', ai: 'AI & Automation', tools: 'Tools' };

/**
 * Technology groups that characterize a category. A project can belong to several
 * categories, so a category's technology list is ordered by relevance to THAT
 * category first — otherwise a web app that also counts as, say, a desktop project
 * would put its web stack on the desktop tile.
 */
const CATEGORY_GROUPS = {
  'Mobile Applications': ['mobile'],
  'Web Applications': ['web'],
  'Backend Systems': ['backend', 'database'],
  'Desktop Applications': ['desktop'],
  'AI & Automation': ['ai'],
  Games: ['mobile'],
};
const ROMAN = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
const IMPLIED_PAIRS = [['Flutter', 'Dart'], ['Next.js', 'React'], ['Cloud Firestore', 'Firebase'], ['Node.js', 'JavaScript'], ['Node.js', 'TypeScript'], ['Nuxt', 'Vue.js'], ['Cloud Functions', 'Firebase'], ['Cloud Functions', 'Node.js'], ['Cloudflare D1', 'Cloudflare Workers'], ['Riverpod', 'Dart'], ['Provider', 'Dart'], ['Flame', 'Dart'], ['Bloc', 'Dart'], ['GetX', 'Dart'], ['React', 'TypeScript'], ['Next.js', 'TypeScript'], ['Next.js', 'Node.js'], ['React', 'Node.js'], ['Tailwind CSS', 'Next.js'], ['Tailwind CSS', 'React'], ['Riverpod', 'Flutter'], ['Provider', 'Flutter'], ['Flame', 'Flutter'], ['Bloc', 'Flutter'], ['GetX', 'Flutter'], ['pandas', 'Python'], ['FastAPI', 'Python'], ['Django', 'Python'], ['Flask', 'Python'], ['CustomTkinter', 'Python'], ['PyInstaller', 'Python'], ['Tkinter', 'Python'], ['Express', 'Node.js'], ['Hono', 'Cloudflare Workers'], ['Cloud Firestore', 'Flutter'], ['Firebase', 'Flutter'], ['Firebase', 'Dart'], ['Cloud Firestore', 'Dart'], ['SQLite', 'Dart'], ['REST APIs', 'Dart'], ['REST APIs', 'Flutter'], ['REST APIs', 'Python'], ['Kotlin', 'Dart'], ['Kotlin', 'Flutter'], ['CSS', 'HTML'], ['JavaScript', 'HTML'], ['JavaScript', 'CSS'], ['GitHub Actions', 'Dart'], ['GitHub Actions', 'Flutter']];

const NOISE_TECHS = new Set(['GitHub Actions', 'CSS', 'HTML', 'Shell', 'PowerShell', 'Node.js', 'Docker']);
const LANGUAGE_TECHS = new Set(V.TECHNOLOGIES.filter((t) => t.lang).map((t) => t.name));

const publicDescription = (a) => U.fitText(String(a.description || '').replace(/\s+/g, ' ').trim(), 1, 220);

// ───────────────────────────────────────────────────────────────────────────────
// Anonymous titles
// ───────────────────────────────────────────────────────────────────────────────

function privateTitle(a) {
  const caps = new Set(a.caps);
  const business = caps.has('Inventory management') || caps.has('Sales & POS') || caps.has('Accounting & invoicing') || caps.has('Customer management') || caps.has('Installment & credit tracking') || caps.has('Employee & HR workflows');
  switch (a.primary) {
    case 'Business Software':
      if (caps.has('Inventory management') || caps.has('Sales & POS')) return 'Retail Operations Platform';
      if (caps.has('Accounting & invoicing') || caps.has('Bank statement processing')) return 'Financial Reporting Tool';
      if (caps.has('Customer management') || caps.has('Installment & credit tracking')) return 'Customer Management System';
      if (caps.has('Employee & HR workflows')) return 'Workforce Management System';
      return 'Business Management System';
    case 'E-commerce': return 'E-commerce Application';
    case 'AI & Automation':
      if (caps.has('Telegram bot automation')) return 'Telegram Automation Bot';
      if (caps.has('AI integration')) return 'AI-Assisted Workflow Tool';
      if (caps.has('Browser automation & scraping') || caps.has('Data processing')) return 'Data Automation Pipeline';
      return 'Automation Service';
    case 'Games': return a.platform === 'Mobile' ? 'Mobile Game' : 'Game Project';
    case 'Productivity': return a.platform === 'Mobile' ? 'Mobile Productivity App' : 'Productivity Application';
    case 'Developer Tools': return 'Internal Developer Tool';
    case 'Infrastructure': return 'Infrastructure Configuration';
    case 'Mobile Applications': return business ? 'Mobile Business Application' : 'Mobile Application';
    case 'Web Applications':
      if (caps.has('Reporting & analytics')) return 'Web Dashboard';
      if (caps.has('Static site generation')) return 'Marketing Website';
      return 'Web Platform';
    case 'Backend Systems': return 'API Service';
    case 'Desktop Applications': return 'Windows Desktop Tool';
    case 'Experimental': return 'Experimental Project';
    default: return 'Software Project';
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Portfolio
// ───────────────────────────────────────────────────────────────────────────────

function rankOf(a, now) {
  const days = a.pushedAt ? (now - new Date(a.pushedAt)) / 86400000 : 9999;
  let r = days <= 45 ? 3 : days <= 180 ? 2 : days <= 365 ? 1 : 0;
  r += Math.min(a.stars, 5) + a.techs.length * 0.2 + a.caps.length * 0.2 + (a.commitTotal != null && a.commitTotal >= 20 ? 1 : 0);
  if (a.maturity === 'Archived') r -= 2;
  if (a.excluded) r -= 10;
  return r;
}

function countBy(items, key) {
  const m = new Map();
  for (const it of items) for (const k of key(it)) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

function buildActivity(repos, windowStartISO, now) {
  const start = windowStartISO.slice(0, 10);
  const end = U.toYMD(now);
  const days = U.eachDay(start, end);
  const counts = new Map(days.map((d) => [d, 0]));
  const perRepo = new Map();
  for (const r of repos) {
    let n = 0;
    for (const d of r.commits) { if (counts.has(d)) { counts.set(d, counts.get(d) + 1); n++; } }
    perRepo.set(r, n);
  }
  const series = days.map((date) => ({ date, count: counts.get(date) }));
  const d90 = U.addDays(end, -90), d30 = U.addDays(end, -30);
  const last90 = U.sum(series.filter((x) => x.date >= d90).map((x) => x.count));
  const activeProjects30 = repos.filter((r) => r.commits.some((d) => d >= d30 && d <= end)).length;
  let longest = 0, cur = 0;
  for (const x of series) { cur = x.count > 0 ? cur + 1 : 0; longest = Math.max(longest, cur); }
  let current = 0;
  for (let i = series.length - 1; i >= 0 && series[i].count > 0; i--) current++;
  if (series.length && series[series.length - 1].count === 0) { current = 0; for (let i = series.length - 2; i >= 0 && series[i].count > 0; i--) current++; }
  let most = null;
  for (const [r, n] of perRepo) if (n > 0 && (!most || n > most.n)) most = { r, n };
  return {
    windowStart: start, windowEnd: end, days: series, total: U.sum(series.map((x) => x.count)), last90, activeProjects30, longestStreak: longest, currentStreak: current,
    mostActive: most ? (most.r.private ? { kind: 'private', commits: most.n } : { kind: 'public', name: most.r.name, commits: most.n }) : null,
  };
}

/**
 * analysis: output of github.analyzeAll(). Returns public-safe portfolio data.
 */
function buildPortfolio(analysis, now = new Date()) {
  const all = analysis.repos;
  const projects = all.filter((r) => !r.excluded);
  const pub = projects.filter((r) => !r.private), priv = projects.filter((r) => r.private);

  const titles = new Map();
  const entries = projects
    .map((a) => ({ a, rank: rankOf(a, now) }))
    .sort((x, y) => y.rank - x.rank)
    .map(({ a, rank }) => {
      const base = { category: a.primary, platform: a.platform, technologies: [...a.techs], capabilities: [...a.caps], maturity: a.maturity, rank };
      if (!a.private) return { kind: 'public', name: a.name, description: publicDescription(a), url: a.url, stars: a.stars, forks: a.forks, ...base };
      const t = privateTitle(a);
      const n = titles.get(t) || 0; // numbered in rank order, so "II" always follows the first
      titles.set(t, n + 1);
      return { kind: 'private', title: `${t}${ROMAN[Math.min(n, ROMAN.length - 1)]}`, ...base };
    });

  const techCount = countBy(projects, (r) => r.techs);
  const techGroup = new Map(V.TECHNOLOGIES.map((t) => [t.name, t.group]));
  const technologies = [...techCount.entries()].map(([name, count]) => ({ name, group: techGroup.get(name) || 'tools', language: LANGUAGE_TECHS.has(name), count, percent: projects.length ? (count / projects.length) * 100 : 0 }))
    .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));

  const catCount = countBy(projects, (r) => r.categories);
  const categories = V.CATEGORIES.filter((c) => catCount.get(c.name)).map((c) => {
    const members = projects.filter((r) => r.categories.includes(c.name));
    const tc = countBy(members, (r) => r.techs.filter((t) => !NOISE_TECHS.has(t)));
    const relevant = CATEGORY_GROUPS[c.name] || null;
    const onTopic = (t) => (relevant ? (relevant.includes(techGroup.get(t)) ? 0 : 1) : 0);
    // category-relevant first, then frequency, then frameworks/services before languages
    const top = [...tc.entries()]
      .sort((x, y) => onTopic(x[0]) - onTopic(y[0]) || y[1] - x[1] || (LANGUAGE_TECHS.has(x[0]) - LANGUAGE_TECHS.has(y[0])) || x[0].localeCompare(y[0]))
      .slice(0, 6).map((x) => x[0]);
    const cc = countBy(members, (r) => r.caps);
    const caps = [...cc.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 6).map((x) => x[0]);
    return { name: c.name, domain: !!c.domain, count: members.length, public: members.filter((r) => !r.private).length, private: members.filter((r) => r.private).length, technologies: top, capabilities: caps };
  }).sort((x, y) => y.count - x.count);

  const pairCount = new Map();
  const topTechs = technologies.filter((t) => !t.language && !NOISE_TECHS.has(t.name)).slice(0, 14).map((t) => t.name);
  for (const r of projects) {
    const ts = r.techs.filter((t) => topTechs.includes(t)).sort();
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) {
      if (IMPLIED_PAIRS.some(([a, b]) => (a === ts[i] && b === ts[j]) || (a === ts[j] && b === ts[i]))) continue;
      const k = `${ts[i]}|${ts[j]}`;
      pairCount.set(k, (pairCount.get(k) || 0) + 1);
    }
  }
  const pairs = [...pairCount.entries()].filter((x) => x[1] >= 2).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, count]) => { const [a, b] = k.split('|'); return { a, b, count }; });

  const stackByArea = Object.entries(AREA_LABELS).map(([group, area]) => ({ area, technologies: technologies.filter((t) => t.group === group).slice(0, 5).map((t) => t.name) })).filter((s) => s.technologies.length);

  const maturity = V.MATURITY.map((name) => ({ name, count: projects.filter((r) => r.maturity === name).length })).filter((m) => m.count);

  return {
    login: analysis.login, mode: analysis.mode, partial: analysis.partial, generatedAt: U.toYMD(now),
    counts: { repositories: all.length, projects: projects.length, public: pub.length, private: priv.length, excluded: all.length - projects.length },
    projects: entries, categories, technologies, pairs, stackByArea, maturity,
    activity: buildActivity(projects, analysis.windowStart, now),
  };
}

// ───────────────────────────────────────────────────────────────────────────────
// Validation layer 1: every string in the portfolio must be explicitly allowed
// ───────────────────────────────────────────────────────────────────────────────

function allowedStrings(analysis) {
  const s = new Set(V.ALLOWED_OUTPUT_STRINGS);
  for (const [k, v] of Object.entries(AREA_LABELS)) { s.add(k); s.add(v); }
  for (const k of ['public', 'private', 'Active', 'Maintained', 'Experimental', 'Archived']) s.add(k);
  s.add(analysis.login);
  s.add(analysis.mode || 'public');
  for (const a of analysis.repos) {
    if (a.private || a.excluded) continue;
    s.add(a.name); s.add(publicDescription(a)); s.add(a.url);
  }
  return s;
}

function validatePortfolio(portfolio, analysis) {
  const allowed = allowedStrings(analysis);
  const titleRe = new RegExp(`^(${V.PRIVATE_TITLES.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})( (II|III|IV|V|VI|VII|VIII|IX|X))?$`);
  const dateRe = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;
  const problems = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (allowed.has(node) || titleRe.test(node) || dateRe.test(node) || node === '') return;
      problems.push(path);
    } else if (Array.isArray(node)) node.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
  };
  walk(portfolio, 'portfolio');
  if (problems.length) throw new Error(`sanitizer: ${problems.length} string(s) outside the allowed vocabulary at ${problems.slice(0, 5).join(', ')} — build aborted`);
  const privateKeys = new Set(['kind', 'title', 'category', 'platform', 'technologies', 'capabilities', 'maturity', 'rank']);
  for (const p of portfolio.projects) {
    if (p.kind !== 'private') continue;
    for (const k of Object.keys(p)) if (!privateKeys.has(k)) throw new Error(`sanitizer: unexpected field "${k}" on a private project — build aborted`);
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Validation layer 2: private identifiers must not appear in the final output
// ───────────────────────────────────────────────────────────────────────────────

function tokensOf(str) {
  return String(str || '').toLowerCase().split(/[^a-z0-9а-яёʼ']+/).filter((t) => t.length >= 5);
}

function buildBlocklist(analysis) {
  const login = String(analysis.login || '').toLowerCase();
  const publicTokens = new Set();
  const vocabTokens = new Set();
  for (const a of analysis.repos) if (!a.private) for (const t of [...tokensOf(a.name), ...tokensOf(a.description), ...a.topics.flatMap(tokensOf)]) publicTokens.add(t);
  for (const v of V.ALLOWED_OUTPUT_STRINGS) for (const t of tokensOf(v)) vocabTokens.add(t);
  for (const v of Object.values(AREA_LABELS)) for (const t of tokensOf(v)) vocabTokens.add(t);

  const block = new Set();
  for (const a of analysis.repos) {
    if (!a.private) continue;
    for (const v of [a.name, a.fullName, a.url, a.homepage, ...(a.topics || [])]) if (v && String(v).length >= 3) block.add(String(v).toLowerCase());
    if (a.owner && a.owner.toLowerCase() !== login) block.add(a.owner.toLowerCase());
    for (const t of tokensOf(a.name)) if (!V.STOPWORDS.has(t) && !publicTokens.has(t) && !vocabTokens.has(t)) block.add(t);
  }
  return [...block];
}

function assertNoLeak(text, blocklist, label = 'output') {
  const hay = String(text).toLowerCase();
  const hits = [];
  blocklist.forEach((item, i) => {
    const simple = /^[a-z0-9а-яё]+$/.test(item);
    const found = simple ? new RegExp(`(^|[^a-z0-9а-яё])${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9а-яё]|$)`).test(hay) : hay.includes(item);
    if (found) hits.push(i);
  });
  if (hits.length) throw new Error(`privacy check failed: ${hits.length} private identifier(s) found in the ${label} (blocklist entries ${hits.slice(0, 5).join(', ')}) — build aborted`);
}

function assertNoSecrets(text) {
  if (/\b(waka_[0-9a-f-]{8,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|ghs_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,})/.test(String(text))) {
    throw new Error('secret check failed: a token-like string appeared in the output — build aborted');
  }
}

module.exports = { buildPortfolio, validatePortfolio, buildBlocklist, assertNoLeak, assertNoSecrets, AREA_LABELS };
