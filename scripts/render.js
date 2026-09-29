'use strict';

/**
 * SVG generator. Receives WakaTime statistics and the SANITIZED portfolio only.
 * Self-contained output: no external fonts, scripts or images; works inside <img>.
 */

const U = require('./util');

const W = 900;
const PAD = 24;
const GAP = 16;
const INNER = W - PAD * 2;
const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

const C = {
  bg: '#0D1117', card: '#161B22', border: '#30363D', text: '#F0F6FC', muted: '#8B949E', faint: '#6E7681',
  track: '#21262D', grid: '#21262D', accent: '#8B7CF6', accentSoft: '#6E60D9',
  palette: ['#8B7CF6', '#5FA8F5', '#4FC1B2', '#E0B25C', '#E27C9A', '#9AA4B2'], other: '#484F58',
};
const ramp = (t) => U.mix(C.card, C.accent, t);
const HEAT = [C.track, ramp(0.3), ramp(0.52), ramp(0.76), C.accent];

const { esc, round, textWidth, fitText, wrapText, fmtDuration, fmtPercent } = U;
const text = (x, y, str, cls, extra = '') => `<text x="${round(x)}" y="${round(y)}" class="${cls}"${extra ? ` ${extra}` : ''}>${esc(str)}</text>`;
const rect = (x, y, w, h, extra = '') => `<rect x="${round(x)}" y="${round(y)}" width="${round(w)}" height="${round(h)}" ${extra}/>`;
const card = (x, y, w, h) => rect(x + 0.5, y + 0.5, w - 1, h - 1, `rx="10" fill="${C.card}" stroke="${C.border}"`);
const line = (x1, y1, x2, y2, stroke = C.border, extra = '') => `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${stroke}" stroke-width="1"${extra ? ` ${extra}` : ''}/>`;
const dot = (x, y, color, r = 4.5) => `<circle cx="${round(x)}" cy="${round(y)}" r="${r}" fill="${color}"/>`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const NOISE = new Set(['GitHub Actions', 'CSS', 'HTML', 'Shell', 'PowerShell', 'Docker']);
const FRAMEWORK_GROUPS = new Set(['mobile', 'web', 'backend', 'desktop']);
const SHORT_CATEGORY = { 'Mobile Applications': 'MOBILE', 'Web Applications': 'WEB', 'Backend Systems': 'BACKEND', 'Desktop Applications': 'DESKTOP', 'Business Software': 'BUSINESS SOFTWARE', 'AI & Automation': 'AI & AUTOMATION', 'Developer Tools': 'DEVELOPER TOOLS', 'Productivity': 'PRODUCTIVITY', 'E-commerce': 'E-COMMERCE', 'Games': 'GAMES', 'Infrastructure': 'INFRASTRUCTURE', 'Experimental': 'EXPERIMENTAL' };
const GROUP_COLOR = { mobile: C.palette[0], web: C.palette[1], backend: C.palette[2], database: C.palette[3], desktop: C.palette[4], ai: C.palette[4], tools: C.palette[5] };

/** Join items with a separator, dropping trailing items until the line fits (never cuts a name in half). */
function fitList(items, size, maxWidth, sep = ' · ', min = 1) {
  let arr = [...items];
  while (arr.length > min && textWidth(arr.join(sep), size) > maxWidth) arr.pop();
  const s = arr.join(sep);
  return textWidth(s, size) > maxWidth ? fitText(s, size, maxWidth) : s;
}

/** Order a project's stack by what characterizes it: frameworks → data/cloud → AI → languages → tools. */
function orderStack(techs, p) {
  const meta = new Map(p.technologies.map((t) => [t.name, t]));
  const hasFramework = techs.some((t) => { const m = meta.get(t); return m && !m.language && FRAMEWORK_GROUPS.has(m.group); });
  const rank = (t) => {
    const m = meta.get(t) || { group: 'tools', language: false };
    if (m.language) return 5;
    return { mobile: 0, web: 1, desktop: 1, backend: 2, database: 3, ai: 4, tools: 6 }[m.group] ?? 6;
  };
  const ordered = techs.filter((t) => !NOISE.has(t) && !(t === 'Node.js' && hasFramework)).sort((a, b) => rank(a) - rank(b) || (meta.get(b)?.count || 0) - (meta.get(a)?.count || 0));
  // A plain HTML/CSS site has nothing but "noise" — show it rather than nothing.
  return ordered.length ? ordered : techs.filter((t) => t !== 'GitHub Actions').sort((a, b) => rank(a) - rank(b));
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const toRad = (d) => ((d - 90) * Math.PI) / 180;
  const x0 = cx + r * Math.cos(toRad(startDeg)), y0 = cy + r * Math.sin(toRad(startDeg));
  const x1 = cx + r * Math.cos(toRad(endDeg)), y1 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${round(x0)} ${round(y0)} A ${r} ${r} 0 ${large} 1 ${round(x1)} ${round(y1)}`;
}
function roundedTopRect(x, y, w, h, r) {
  return `M ${round(x)} ${round(y + h)} V ${round(y + r)} Q ${round(x)} ${round(y)} ${round(x + r)} ${round(y)} H ${round(x + w - r)} Q ${round(x + w)} ${round(y)} ${round(x + w)} ${round(y + r)} V ${round(y + h)} Z`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Entry
// ───────────────────────────────────────────────────────────────────────────────

function renderProfile({ waka, portfolio }) {
  const parts = [];
  let y = PAD;

  y = renderHeader(parts, y, waka, portfolio);
  y = renderKpis(parts, y, waka, portfolio);

  {
    const h = 264, leftW = 424, rightW = INNER - leftW - GAP;
    parts.push(card(PAD, y, leftW, h));
    parts.push(...renderWeekly(waka, PAD, y, leftW, h));
    parts.push(card(PAD + leftW + GAP, y, rightW, h));
    parts.push(...renderDonut(waka, PAD + leftW + GAP, y, rightW, h));
    y += h + GAP;
  }
  {
    const h = waka.heatmap ? 258 : 196, heatW = 392, insW = INNER - heatW - GAP;
    parts.push(card(PAD, y, heatW, h));
    parts.push(...renderHourHeatmap(waka, PAD, y, heatW, h));
    parts.push(card(PAD + heatW + GAP, y, insW, h));
    parts.push(...renderInsights(waka, PAD + heatW + GAP, y, insW, h));
    y += h + GAP;
  }

  if (portfolio && portfolio.counts.projects > 0) {
    const c = portfolio.counts;
    const note = `${plural(c.projects, 'PROJECT', 'PROJECTS')} · ${c.public} PUBLIC · ${c.private} PRIVATE${portfolio.partial ? ' · PARTIAL' : ''}`;
    y = renderSectionHeader(parts, y, 'PROJECT ECOSYSTEM', note);
    y = renderEcosystem(parts, y, portfolio);
    y = renderMaturity(parts, y, portfolio);

    y = renderSectionHeader(parts, y, 'TECHNOLOGY ECOSYSTEM', `${plural(portfolio.technologies.length, 'TECHNOLOGY', 'TECHNOLOGIES')} DETECTED`);
    y = renderTechnology(parts, y, portfolio);

    y = renderSectionHeader(parts, y, 'PROJECT PORTFOLIO', 'PRIVATE PROJECTS ARE ANONYMIZED');
    y = renderPortfolio(parts, y, portfolio);

    y = renderSectionHeader(parts, y, 'DEVELOPMENT ACTIVITY', `GITHUB COMMITS · ${U.fmtDateRange(portfolio.activity.windowStart, portfolio.activity.windowEnd)}`);
    y = renderActivity(parts, y, portfolio);

    const build = buildBlocks(portfolio);
    if (build.length) {
      y = renderSectionHeader(parts, y, 'WHAT I BUILD', 'DERIVED FROM REPOSITORY DATA');
      y = renderWhatIBuild(parts, y, build);
    }
    y = renderPositioning(parts, y, portfolio);
  }

  const H = y - GAP + PAD;
  const desc = `Developer activity: ${fmtDuration(waka.totalSeconds)} of coding in the last 7 days, ${waka.activeDays} of ${waka.days.length} active days${portfolio ? `, ${portfolio.counts.projects} projects analyzed across ${portfolio.technologies.length} technologies` : ''}.`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="t d">
<title id="t">Developer activity — WakaTime and GitHub</title>
<desc id="d">${esc(desc)}</desc>
<style>
  text { font-family: ${FONT}; fill: ${C.text}; font-variant-numeric: tabular-nums; }
  .title { font-size: 20px; font-weight: 700; letter-spacing: 0.4px; }
  .range { font-size: 13px; font-weight: 600; letter-spacing: 1px; }
  .label { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; fill: ${C.muted}; }
  .label-accent { font-size: 11px; font-weight: 600; letter-spacing: 1.2px; fill: ${C.accent}; }
  .sec { font-size: 11.5px; font-weight: 700; letter-spacing: 1.6px; fill: ${C.text}; }
  .kpi { font-size: 30px; font-weight: 700; letter-spacing: -0.6px; }
  .kpi-suffix { font-size: 14px; font-weight: 500; letter-spacing: 0; fill: ${C.muted}; }
  .big { font-size: 22px; font-weight: 700; letter-spacing: -0.4px; }
  .big-suffix { font-size: 12px; font-weight: 500; letter-spacing: 0; fill: ${C.muted}; }
  .axis { font-size: 11px; font-weight: 500; fill: ${C.muted}; }
  .val { font-size: 11px; font-weight: 600; fill: ${C.muted}; }
  .val-hi { font-size: 11px; font-weight: 600; fill: ${C.text}; }
  .center { font-size: 19px; font-weight: 700; letter-spacing: -0.4px; }
  .center-sub { font-size: 9.5px; font-weight: 600; letter-spacing: 1.2px; fill: ${C.muted}; }
  .name { font-size: 13px; font-weight: 600; }
  .meta { font-size: 12px; font-weight: 500; fill: ${C.muted}; }
  .legend { font-size: 12.5px; font-weight: 500; }
  .heat { font-size: 10.5px; font-weight: 500; fill: ${C.muted}; }
  .ins { font-size: 15px; font-weight: 600; }
  .ins-sub { font-size: 13px; font-weight: 500; fill: ${C.muted}; }
  .empty { font-size: 12.5px; font-weight: 500; fill: ${C.muted}; }
  .dim { fill: ${C.muted}; }
  .faint { fill: ${C.faint}; }
  .sub { font-size: 11.5px; font-weight: 500; fill: ${C.muted}; }
  .body { font-size: 11.5px; font-weight: 500; fill: ${C.text}; }
  .tag { font-size: 8.5px; font-weight: 700; letter-spacing: 1px; fill: ${C.muted}; }
  .mat { font-size: 9.5px; font-weight: 600; letter-spacing: 1px; fill: ${C.faint}; }
  .pos { font-size: 14px; font-weight: 700; letter-spacing: 0.3px; }
</style>
<rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="${C.border}"/>
${parts.join('\n')}
</svg>
`;
}

// ───────────────────────────────────────────────────────────────────────────────
// Header + KPIs
// ───────────────────────────────────────────────────────────────────────────────

function renderHeader(parts, y, waka, portfolio) {
  parts.push(text(PAD, y + 22, 'DEVELOPER ACTIVITY', 'title'));
  parts.push(text(PAD, y + 44, portfolio ? 'WAKATIME + GITHUB • UPDATED DAILY' : 'WAKATIME • LAST 7 DAYS', 'label'));
  parts.push(text(W - PAD, y + 22, `CODING ${U.fmtDateRange(waka.start, waka.end)}`, 'range', 'text-anchor="end"'));
  parts.push(text(W - PAD, y + 44, `UPDATED ${U.fmtDateShort(waka.generated)}`, 'label', 'text-anchor="end"'));
  return y + 72;
}

function renderKpis(parts, y, waka, portfolio) {
  const kpis = [
    { value: fmtDuration(waka.totalSeconds), label: 'Coding time · 7 days' },
    { value: `${waka.activeDays} / ${waka.days.length}`, label: 'Active coding days' },
  ];
  if (portfolio && portfolio.counts.projects > 0) {
    kpis.push({ value: String(portfolio.counts.projects), label: 'Projects analyzed' });
    kpis.push({ value: String(portfolio.technologies.length), label: 'Technologies' });
  } else {
    kpis.push({ value: fmtDuration(waka.dailyAverage), suffix: '/day', label: 'Daily average' });
    kpis.push(waka.longestSession ? { value: fmtDuration(waka.longestSession.active), label: 'Longest session' } : { value: waka.bestDay ? fmtDuration(waka.bestDay.seconds) : '0m', label: 'Best day' });
  }
  const h = 88, w = (INNER - GAP * (kpis.length - 1)) / kpis.length;
  kpis.forEach((k, i) => {
    const x = PAD + i * (w + GAP);
    parts.push(card(x, y, w, h));
    const suffix = k.suffix ? `<tspan class="kpi-suffix" dx="4">${esc(k.suffix)}</tspan>` : '';
    const avail = w - 40 - (k.suffix ? textWidth(k.suffix, 14) + 4 : 0);
    const size = Math.min(30, Math.floor((avail / textWidth(k.value, 1)) * 10) / 10);
    parts.push(`<text x="${round(x + 20)}" y="${round(y + 46)}" class="kpi"${size < 30 ? ` style="font-size:${size}px"` : ''}>${esc(k.value)}${suffix}</text>`);
    parts.push(text(x + 20, y + 68, k.label.toUpperCase(), 'label'));
  });
  return y + h + GAP;
}

function renderSectionHeader(parts, y, title, note) {
  y += 8;
  parts.push(text(PAD, y + 12, title, 'sec'));
  const tw = textWidth(title, 11.5, 1.6) + 16;
  const nw = note ? textWidth(note, 11, 1.2) + 16 : 0;
  if (PAD + tw < W - PAD - nw) parts.push(line(PAD + tw, y + 8, W - PAD - nw, y + 8, C.border));
  if (note) parts.push(text(W - PAD, y + 12, note, 'label', 'text-anchor="end"'));
  return y + 32;
}

// ───────────────────────────────────────────────────────────────────────────────
// WakaTime sections
// ───────────────────────────────────────────────────────────────────────────────

function renderWeekly(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'WEEKLY CODING ACTIVITY', 'label'));
  out.push(text(x + w - 20, y + 30, 'HOURS PER DAY', 'label', 'text-anchor="end"'));
  const plotX = x + 58, plotR = x + w - 20, plotTop = y + 66, plotBottom = y + h - 40;
  const plotW = plotR - plotX, plotH = plotBottom - plotTop;
  const slot = plotW / stats.days.length;

  if (stats.totalSeconds <= 0) {
    out.push(line(plotX, plotBottom, plotR, plotBottom, C.grid));
    out.push(text(plotX - 10, plotBottom + 4, '0', 'axis', 'text-anchor="end"'));
    out.push(text(plotX + plotW / 2, plotTop + plotH / 2, 'No coding activity recorded in this period.', 'empty', 'text-anchor="middle"'));
    stats.days.forEach((d, i) => out.push(text(plotX + slot * i + slot / 2, plotBottom + 22, U.weekdayShort(d.date), 'axis', 'text-anchor="middle"')));
    return out;
  }
  const scale = U.niceScale(Math.max(...stats.days.map((d) => d.seconds)) / 3600);
  for (const t of scale.ticks) {
    const gy = plotBottom - (t / scale.top) * plotH;
    out.push(line(plotX, gy, plotR, gy, C.grid, t === 0 ? '' : 'stroke-dasharray="2 4"'));
    out.push(text(plotX - 10, gy + 4, U.fmtHours(t), 'axis', 'text-anchor="end"'));
  }
  const barW = Math.min(44, slot * 0.58);
  stats.days.forEach((d, i) => {
    const cx = plotX + slot * i + slot / 2, bx = cx - barW / 2;
    const bh = scale.top ? ((d.seconds / 3600) / scale.top) * plotH : 0;
    const isBest = stats.bestDay && d.date === stats.bestDay.date && d.seconds > 0;
    if (bh >= 1) {
      out.push(`<path d="${roundedTopRect(bx, plotBottom - bh, barW, bh, Math.min(5, barW / 2, bh / 2))}" fill="${isBest ? C.accent : C.accentSoft}"${isBest ? '' : ' fill-opacity="0.85"'}/>`);
      out.push(text(cx, plotBottom - bh - 8, fmtDuration(d.seconds), isBest ? 'val-hi' : 'val', 'text-anchor="middle"'));
    } else out.push(rect(bx, plotBottom - 3, barW, 3, `rx="1.5" fill="${C.track}"`));
    out.push(text(cx, plotBottom + 22, U.weekdayShort(d.date), 'axis', 'text-anchor="middle"'));
  });
  return out;
}

function renderDonut(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'LANGUAGE DISTRIBUTION', 'label'));
  out.push(text(x + w - 20, y + 30, '7 DAYS', 'label', 'text-anchor="end"'));
  const r = 56, stroke = 14, cx = x + 20 + r + stroke / 2 + 2, cy = y + 56 + (h - 56 - 20) / 2;
  const langs = stats.languages, total = U.sum(langs.map((l) => l.seconds));
  const color = (l) => (l.other ? C.other : C.palette[l.rank % 5]);

  if (!langs.length || total <= 0) {
    out.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${C.track}" stroke-width="${stroke}"/>`);
    out.push(text(cx, cy + 6, '0m', 'center', 'text-anchor="middle"'));
    out.push(text(cx, cy + 22, 'TOTAL TIME', 'center-sub', 'text-anchor="middle"'));
    out.push(text(cx + r + stroke / 2 + 22, cy + 4, 'No language data yet', 'empty'));
    return out;
  }
  const gapDeg = langs.length > 1 ? 2.4 : 0, totalDeg = 360 - gapDeg * langs.length;
  let angle = 0;
  if (langs.length === 1) out.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${r}" fill="none" stroke="${color(langs[0])}" stroke-width="${stroke}"/>`);
  else for (const l of langs) {
    const span = (l.seconds / total) * totalDeg;
    if (span > 0.5) out.push(`<path d="${arcPath(cx, cy, r, angle, angle + Math.min(span, 359.99))}" fill="none" stroke="${color(l)}" stroke-width="${stroke}"/>`);
    angle += span + gapDeg;
  }
  const centerText = fmtDuration(stats.totalSeconds);
  const innerW = (r - stroke / 2) * 2 - 14;
  const centerSize = Math.min(19, Math.floor((innerW / textWidth(centerText, 1)) * 10) / 10);
  out.push(text(cx, cy + 6, centerText, 'center', `text-anchor="middle" style="font-size:${centerSize}px"`));
  out.push(text(cx, cy + 22, 'TOTAL TIME', 'center-sub', 'text-anchor="middle"'));

  const lx = cx + r + stroke / 2 + 22, lr = x + w - 20, rowH = 25;
  const nameW = lr - (lx + 18) - textWidth('88h 88m · 88.8%', 12) - 12;
  const ly0 = cy - ((langs.length - 1) * rowH) / 2;
  langs.forEach((l, i) => {
    const ly = ly0 + i * rowH;
    out.push(dot(lx + 5, ly, color(l)));
    out.push(text(lx + 18, ly + 4.5, fitText(l.name, 12.5, nameW), l.other ? 'legend dim' : 'legend'));
    out.push(text(lr, ly + 4.5, `${fmtDuration(l.seconds)} · ${fmtPercent(l.percent)}`, 'meta', 'text-anchor="end"'));
  });
  return out;
}

function renderHourHeatmap(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'CODING HOURS HEATMAP', 'label'));
  const legendY = y + h - 22;
  if (stats.heatmap) {
    out.push(text(x + w - 20, y + 30, 'HOUR OF DAY', 'label', 'text-anchor="end"'));
    const cols = stats.heatCols, gx = x + 20 + 34, gr = x + w - 20, gap = 4;
    const cell = (gr - gx - gap * (cols - 1)) / cols, cellH = 20, gy = y + 62;
    const max = Math.max(...stats.heatmap.flat());
    for (let c = 0; c < cols; c += 3) out.push(text(gx + c * (cell + gap), gy - 8, U.pad2((24 / cols) * c), 'heat'));
    stats.days.forEach((d, row) => {
      const ry = gy + row * (cellH + gap);
      out.push(text(gx - 10, ry + cellH / 2 + 4, U.weekdayShort(d.date), 'heat', 'text-anchor="end"'));
      for (let c = 0; c < cols; c++) {
        const v = stats.heatmap[row][c];
        const level = v <= 0 || max <= 0 ? 0 : U.clamp(Math.ceil((v / max) * 4), 1, 4);
        out.push(rect(gx + c * (cell + gap), ry, cell, cellH, `rx="4" fill="${HEAT[level]}"`));
      }
    });
  } else {
    out.push(text(x + w - 20, y + 30, 'BY DAY', 'label', 'text-anchor="end"'));
    const gx = x + 20, gr = x + w - 20, gap = 6, cell = (gr - gx - gap * (stats.days.length - 1)) / stats.days.length, gy = y + 62;
    const max = Math.max(...stats.days.map((d) => d.seconds));
    stats.days.forEach((d, i) => {
      const cx = gx + i * (cell + gap);
      const level = d.seconds <= 0 || max <= 0 ? 0 : U.clamp(Math.ceil((d.seconds / max) * 4), 1, 4);
      out.push(rect(cx, gy, cell, 44, `rx="6" fill="${HEAT[level]}"`));
      out.push(text(cx + cell / 2, gy + 64, U.weekdayShort(d.date), 'heat', 'text-anchor="middle"'));
      out.push(text(cx + cell / 2, gy + 80, d.seconds > 0 ? fmtDuration(d.seconds) : '—', 'heat', 'text-anchor="middle"'));
    });
  }
  out.push(text(x + 20, legendY + 4, 'Less', 'heat'));
  HEAT.forEach((c, i) => out.push(rect(x + 20 + 34 + i * 16, legendY - 5, 12, 12, `rx="3" fill="${c}"`)));
  out.push(text(x + 20 + 34 + HEAT.length * 16 + 2, legendY + 4, 'More', 'heat'));
  return out;
}

function renderInsights(stats, x, y, w, h) {
  const out = [];
  out.push(text(x + 20, y + 30, 'CODING INSIGHTS', 'label'));
  if (stats.totalSeconds <= 0) { out.push(text(x + 20, y + 72, 'No coding activity recorded in this period.', 'empty')); return out; }
  const items = [];
  if (stats.mostUsed) items.push({ label: 'Most used language', value: stats.mostUsed.name, sub: fmtDuration(stats.mostUsed.seconds) });
  if (stats.bestDay) items.push({ label: 'Most productive day', value: U.weekdayName(stats.bestDay.date), sub: fmtDuration(stats.bestDay.seconds) });
  items.push({ label: 'Daily average', value: fmtDuration(stats.dailyAverage), sub: `${fmtDuration(stats.avgPerActiveDay)} per active day` });
  if (stats.longestSession) items.push({ label: 'Longest session', value: fmtDuration(stats.longestSession.active), sub: `${U.weekdayName(stats.longestSession.date).slice(0, 3)} ${stats.longestSession.startClock}–${stats.longestSession.endClock}` });
  items.push({ label: 'Active days', value: `${stats.activeDays} / ${stats.days.length}`, sub: `${Math.round((stats.activeDays / stats.days.length) * 100)}% of the week` });
  if (stats.peak) items.push({ label: 'Peak hours', value: `${stats.peak.from}–${stats.peak.to}`, sub: fmtDuration(stats.peak.seconds) });
  const colW = (w - 40) / 2, rowH = 62;
  items.slice(0, 6).forEach((it, i) => {
    const ix = x + 20 + (i % 2) * colW, iy = y + 60 + Math.floor(i / 2) * rowH, maxW = colW - 16;
    out.push(text(ix, iy, it.label.toUpperCase(), 'label'));
    const value = fitText(it.value, 15, maxW);
    const subFits = it.sub && textWidth(value, 15) + textWidth(` · ${it.sub}`, 13) <= maxW;
    out.push(`<text x="${round(ix)}" y="${round(iy + 22)}" class="ins">${esc(value)}${subFits ? `<tspan class="ins-sub"> · ${esc(it.sub)}</tspan>` : ''}</text>`);
  });
  return out;
}

// ───────────────────────────────────────────────────────────────────────────────
// GitHub sections
// ───────────────────────────────────────────────────────────────────────────────

function renderEcosystem(parts, y, p) {
  const cats = p.categories.slice(0, 8);
  const perRow = 4, w = (INNER - GAP * (perRow - 1)) / perRow, h = 88;
  cats.forEach((c, i) => {
    const x = PAD + (i % perRow) * (w + GAP), cy = y + Math.floor(i / perRow) * (h + 12);
    parts.push(card(x, cy, w, h));
    parts.push(dot(x + 20 + 4, cy + 25, C.palette[i % C.palette.length], 4));
    parts.push(text(x + 34, cy + 29, fitText(SHORT_CATEGORY[c.name] || c.name.toUpperCase(), 11, w - 54), 'label'));
    parts.push(`<text x="${round(x + 20)}" y="${round(cy + 57)}" class="big">${c.count}<tspan class="big-suffix" dx="5">${c.count === 1 ? 'project' : 'projects'}</tspan></text>`);
    parts.push(text(x + 20, cy + 75, c.technologies.length ? fitList(c.technologies.slice(0, 3), 11, w - 40) : '—', 'sub'));
  });
  return y + Math.ceil(cats.length / perRow) * (h + 12) - 12 + GAP;
}

function renderMaturity(parts, y, p) {
  const h = 60;
  parts.push(card(PAD, y, INNER, h));
  parts.push(text(PAD + 20, y + 35, 'PROJECT MATURITY', 'label'));
  const total = U.sum(p.maturity.map((m) => m.count)) || 1;
  const colors = { Active: C.accent, Maintained: ramp(0.62), Experimental: ramp(0.38), Archived: C.other };
  const legendW = U.sum(p.maturity.map((m) => 14 + textWidth(`${m.name.toUpperCase()} ${m.count}`, 11, 1.2) + 18));
  const bx = PAD + 190, by = y + 26, bh = 8;
  const bw = Math.max(120, (PAD + INNER - 20) - legendW - 28 - bx);
  parts.push(rect(bx, by, bw, bh, `rx="4" fill="${C.track}"`));
  let cx = bx;
  const segs = p.maturity.filter((m) => m.count);
  segs.forEach((m, i) => {
    const sw = (m.count / total) * bw - (i < segs.length - 1 ? 2 : 0);
    if (sw > 0) parts.push(rect(cx, by, sw, bh, `rx="4" fill="${colors[m.name]}"`));
    cx += (m.count / total) * bw;
  });
  let lx = bx + bw + 28;
  for (const m of p.maturity) {
    parts.push(dot(lx + 4, y + 30, colors[m.name], 4));
    const label = `${m.name.toUpperCase()} ${m.count}`;
    parts.push(text(lx + 14, y + 34, label, 'label'));
    lx += 14 + textWidth(label, 11, 1.2) + 18;
  }
  return y + h + GAP;
}

function renderTechnology(parts, y, p) {
  const leftW = 540, rightW = INNER - leftW - GAP;
  const techs = p.technologies.filter((t) => !NOISE.has(t.name)).slice(0, 8);
  const rows = techs.length, rowH = 34;
  const pairs = p.pairs;
  const leftH = 52 + rows * rowH + (pairs.length ? 34 : 6);
  const areas = p.stackByArea;
  const rightH = 52 + areas.length * 40 - 4;
  const h = Math.max(leftH, rightH, 120);

  parts.push(card(PAD, y, leftW, h));
  parts.push(text(PAD + 20, y + 30, 'MOST USED TECHNOLOGIES', 'label'));
  parts.push(text(PAD + leftW - 20, y + 30, 'PROJECTS · SHARE', 'label', 'text-anchor="end"'));
  const max = Math.max(...techs.map((t) => t.count), 1);
  const bx = PAD + 20, bw = leftW - 40;
  techs.forEach((t, i) => {
    const ty = y + 52 + i * rowH;
    parts.push(text(bx, ty + 12, t.name, 'name'));
    parts.push(text(bx + bw, ty + 12, `${plural(t.count, 'project')} · ${Math.round(t.percent)}%`, 'meta', 'text-anchor="end"'));
    parts.push(rect(bx, ty + 20, bw, 5, `rx="2.5" fill="${C.track}"`));
    parts.push(rect(bx, ty + 20, Math.max(5, (t.count / max) * bw), 5, `rx="2.5" fill="${GROUP_COLOR[t.group] || C.palette[5]}"`));
  });
  if (pairs.length) {
    const py = y + 52 + rows * rowH + 14;
    parts.push(text(bx, py, 'OFTEN COMBINED', 'label'));
    const lw = textWidth('OFTEN COMBINED', 11, 1.2) + 14;
    parts.push(text(bx + lw, py, fitList(pairs.map((q) => `${q.a} + ${q.b} (${q.count})`), 11.5, bw - lw, '  ·  '), 'sub'));
  }

  const rx = PAD + leftW + GAP;
  parts.push(card(rx, y, rightW, h));
  parts.push(text(rx + 20, y + 30, 'STACK BY AREA', 'label'));
  const groupOfArea = Object.fromEntries(Object.entries(require('./sanitize').AREA_LABELS).map(([g, a]) => [a, g]));
  areas.forEach((a, i) => {
    const ay = y + 52 + i * 40;
    parts.push(dot(rx + 24, ay + 6, GROUP_COLOR[groupOfArea[a.area]] || C.palette[5], 3.5));
    parts.push(text(rx + 34, ay + 10, a.area.toUpperCase(), 'tag'));
    parts.push(text(rx + 20, ay + 27, fitList(a.technologies.slice(0, 4), 12, rightW - 40), 'legend'));
  });
  return y + h + GAP;
}

function renderPortfolio(parts, y, p) {
  const groups = [];
  for (const c of p.categories) {
    const items = p.projects.filter((pr) => pr.category === c.name);
    if (items.length) groups.push({ name: c.name, items });
  }
  const orphan = p.projects.filter((pr) => !pr.category);
  if (orphan.length) groups.push({ name: 'Other Projects', items: orphan });
  // Largest groups first; ties broken by the strongest project inside the group.
  groups.sort((a, b) => b.items.length - a.items.length || Math.max(...b.items.map((i) => i.rank)) - Math.max(...a.items.map((i) => i.rank)));
  groups.forEach((g, i) => { g.color = g.name === 'Other Projects' ? C.other : C.palette[i % C.palette.length]; });
  const shown = groups.slice(0, 6);
  const perRow = 2, w = (INNER - GAP * (perRow - 1)) / perRow, maxItems = 4, entryH = 52;
  const boxH = (g) => 42 + Math.min(g.items.length, maxItems) * entryH + (g.items.length > maxItems ? 22 : 0) + 6;
  let rowY = y;
  for (let r = 0; r < shown.length; r += perRow) {
    const row = shown.slice(r, r + perRow);
    const h = Math.max(...row.map(boxH));
    row.forEach((g, i) => {
      const x = PAD + i * (w + GAP);
      parts.push(card(x, rowY, w, h));
      parts.push(dot(x + 20 + 4, rowY + 25, g.color, 4));
      parts.push(text(x + 34, rowY + 29, fitText(g.name.toUpperCase(), 11, w - 34 - 20 - 90), 'label'));
      parts.push(text(x + w - 20, rowY + 29, plural(g.items.length, 'PROJECT', 'PROJECTS'), 'label', 'text-anchor="end"'));
      g.items.slice(0, maxItems).forEach((pr, j) => parts.push(...renderEntry(pr, x + 20, rowY + 42 + j * entryH, w - 40, p)));
      if (g.items.length > maxItems) parts.push(text(x + 20, rowY + 42 + maxItems * entryH + 16, `+ ${plural(g.items.length - maxItems, 'more project')}`, 'sub faint'));
    });
    rowY += h + GAP;
  }
  return rowY;
}

function renderEntry(pr, x, y, w, p) {
  const out = [];
  const mat = pr.maturity ? pr.maturity.toUpperCase() : '';
  const matW = mat ? textWidth(mat, 9.5, 1) + 8 : 0;
  let right = x + w;
  if (mat) { out.push(text(right, y + 14.5, mat, 'mat', 'text-anchor="end"')); right -= matW + 10; }
  if (pr.kind === 'private') {
    const tagW = textWidth('PRIVATE', 8.5, 1) + 12;
    out.push(rect(right - tagW, y + 4, tagW, 15, `rx="3" fill="none" stroke="${C.border}"`));
    out.push(text(right - tagW / 2, y + 14.5, 'PRIVATE', 'tag', 'text-anchor="middle"'));
    right -= tagW + 10;
  }
  out.push(text(x, y + 15, fitText(pr.kind === 'private' ? pr.title : pr.name, 13, right - x), 'name'));
  const ordered = orderStack(pr.technologies, p);
  out.push(text(x, y + 31, ordered.length ? fitList(ordered, 11.5, w) : (pr.platform || '—'), 'sub'));
  const caps = pr.capabilities.filter((c) => !['State management', 'CI/CD pipelines'].includes(c)).slice(0, 4);
  const fallback = [pr.platform, pr.category].filter(Boolean).join(' · ');
  if (pr.kind === 'private' || !pr.description) out.push(text(x, y + 46, caps.length ? fitList(caps, 11.5, w) : fallback, 'sub faint'));
  else out.push(text(x, y + 46, fitText(pr.description, 11.5, w), 'sub faint'));
  return out;
}

function renderActivity(parts, y, p) {
  const a = p.activity;
  const leftW = 540, rightW = INNER - leftW - GAP, h = 214;
  parts.push(card(PAD, y, leftW, h));
  parts.push(text(PAD + 20, y + 30, 'COMMIT ACTIVITY', 'label'));
  parts.push(text(PAD + leftW - 20, y + 30, 'ALL ANALYZED REPOSITORIES', 'label', 'text-anchor="end"'));

  // Calendar grid, Monday-first columns
  const startDow = (U.parseDate(a.windowStart).getUTCDay() + 6) % 7; // 0 = Monday
  const gridStart = U.addDays(a.windowStart, -startDow);
  const days = U.eachDay(gridStart, a.windowEnd);
  const byDate = new Map(a.days.map((d) => [d.date, d.count]));
  const weeks = Math.ceil(days.length / 7);
  const cell = 11, gap = 3, gx = PAD + 20 + 34, gy = y + 64;
  const max = Math.max(...a.days.map((d) => d.count), 1);
  let lastMonth = '', lastLabelWk = -10;
  for (let wk = 0; wk < weeks; wk++) {
    const first = days[wk * 7];
    const m = first ? first.slice(0, 7) : '';
    if (first && m !== lastMonth) {
      if (U.parseDate(first).getUTCDate() <= 7 && wk - lastLabelWk >= 3) {
        parts.push(text(gx + wk * (cell + gap), gy - 8, U.monthShort(first), 'heat'));
        lastLabelWk = wk;
      }
      lastMonth = m;
    }
    for (let d = 0; d < 7; d++) {
      const date = days[wk * 7 + d];
      if (!date) continue;
      const v = byDate.get(date) || 0;
      const inWindow = date >= a.windowStart;
      const level = v <= 0 ? 0 : U.clamp(Math.ceil((v / max) * 4), 1, 4);
      parts.push(rect(gx + wk * (cell + gap), gy + d * (cell + gap), cell, cell, `rx="2.5" fill="${inWindow ? HEAT[level] : C.card}"`));
    }
  }
  ['MON', '', 'WED', '', 'FRI', '', 'SUN'].forEach((l, d) => { if (l) parts.push(text(gx - 10, gy + d * (cell + gap) + cell - 2, l, 'heat', 'text-anchor="end"')); });
  const legendY = y + h - 22;
  parts.push(text(PAD + 20, legendY + 4, 'Less', 'heat'));
  HEAT.forEach((c, i) => parts.push(rect(PAD + 20 + 34 + i * 16, legendY - 5, 12, 12, `rx="3" fill="${c}"`)));
  parts.push(text(PAD + 20 + 34 + HEAT.length * 16 + 2, legendY + 4, 'More', 'heat'));

  const rx = PAD + leftW + GAP;
  parts.push(card(rx, y, rightW, h));
  parts.push(`<text x="${round(rx + 20)}" y="${round(y + 46)}" class="kpi" style="font-size:26px">${a.total}<tspan class="kpi-suffix" dx="5">commits</tspan></text>`);
  parts.push(text(rx + 20, y + 66, `LAST ${Math.round(U.daysBetween(a.windowStart, a.windowEnd) / 7)} WEEKS`, 'label'));
  const rows = [
    ['Last 90 days', plural(a.last90, 'commit')],
    ['Active projects · 30 days', String(a.activeProjects30)],
    ['Longest streak', plural(a.longestStreak, 'day')],
    ['Most active', a.mostActive ? (a.mostActive.kind === 'public' ? a.mostActive.name : 'Private project') : '—'],
  ];
  rows.forEach(([k, v], i) => {
    const ry = y + 96 + i * 28;
    parts.push(text(rx + 20, ry, k, 'sub'));
    parts.push(text(rx + rightW - 20, ry, fitText(v, 12.5, rightW - 40 - textWidth(k, 11.5) - 12), 'legend', 'text-anchor="end"'));
  });
  return y + h + GAP;
}

// ── What I build ──

const BUSINESS_CAPS = ['Inventory management', 'Sales & POS', 'Accounting & invoicing', 'Bank statement processing', 'Installment & credit tracking', 'Customer management', 'Employee & HR workflows', 'Reporting & analytics', 'Receipt printing', 'ERP integration', 'Multi-branch data consolidation'];
const AUTOMATION_CAPS = ['Telegram bot automation', 'AI integration', 'Browser automation & scraping', 'Scheduled jobs', 'Data processing', 'API integration'];
const GENERIC_CAPS = ['State management', 'CI/CD pipelines'];

const PHRASE = {
  'Sales & POS': 'sales', 'Inventory management': 'inventory', 'Accounting & invoicing': 'accounting', 'Reporting & analytics': 'reporting', 'Customer management': 'customer management',
  'Installment & credit tracking': 'installment tracking', 'Employee & HR workflows': 'HR workflows', 'Bank statement processing': 'bank statements', 'ERP integration': 'ERP integration',
  'Receipt printing': 'receipt printing', 'Multi-branch data consolidation': 'multi-branch data', 'Telegram bot automation': 'Telegram bots', 'Scheduled jobs': 'scheduled jobs',
  'Browser automation & scraping': 'browser automation', 'AI integration': 'AI-assisted workflows', 'Data processing': 'data processing', 'API integration': 'API integrations',
};

function buildBlocks(p) {
  const blocks = [];
  // Most frequent technologies within the category (noise removed) — what the category is actually built with.
  const techsOf = (c, exclude = []) => c.technologies.filter((t) => !NOISE.has(t) && t !== 'Node.js' && !exclude.includes(t)).slice(0, 3);
  const capsOf = (c, prefer = null, n = 3) => {
    const caps = c.capabilities.filter((x) => !GENERIC_CAPS.includes(x));
    const ordered = prefer ? [...caps.filter((x) => prefer.includes(x)), ...caps.filter((x) => !prefer.includes(x))] : caps;
    return ordered.slice(0, n);
  };
  const with_ = (arr) => (arr.length ? ` with ${U.listPhrase(arr)}` : '');
  const cap1 = (str) => str.charAt(0).toUpperCase() + str.slice(1);
  // Domain categories (what the software is for) before platform categories (where it runs).
  const ordered = [...p.categories.filter((c) => c.domain), ...p.categories.filter((c) => !c.domain)];
  for (const c of ordered) {
    if (c.name === 'Experimental' || c.name === 'Infrastructure') continue;
    let sentence, caps, techs;
    switch (c.name) {
      case 'Mobile Applications': {
        const t = techsOf(c, ['Dart', 'Kotlin', 'Swift']);
        const flutter = t[0] === 'Flutter';
        techs = flutter ? t.slice(1) : t;
        sentence = (tt) => `Cross-platform ${flutter ? 'Flutter' : 'mobile'} applications${with_(tt)}.`;
        caps = capsOf(c, ['Authentication', 'Offline-first sync', 'Push notifications', 'Native platform integration', 'Real-time updates', 'Local database']);
        break;
      }
      case 'Business Software': {
        const bc = c.capabilities.filter((x) => BUSINESS_CAPS.includes(x)).slice(0, 3);
        techs = techsOf(c);
        sentence = (tt) => `Custom tools for ${bc.length ? U.listPhrase(bc.map((x) => PHRASE[x] || x)) : 'day-to-day operations'}${with_(tt)}.`;
        caps = capsOf(c, BUSINESS_CAPS);
        break;
      }
      case 'AI & Automation': {
        const ac = c.capabilities.filter((x) => AUTOMATION_CAPS.includes(x)).slice(0, 3);
        techs = techsOf(c);
        sentence = (tt) => `${cap1(ac.length ? U.listPhrase(ac.map((x) => PHRASE[x] || x)) : 'automation workflows')}${with_(tt)}.`;
        caps = capsOf(c, AUTOMATION_CAPS);
        break;
      }
      case 'Web Applications': techs = techsOf(c); sentence = (tt) => `Websites, dashboards and web applications${with_(tt)}.`; caps = capsOf(c); break;
      case 'Backend Systems': techs = techsOf(c); sentence = (tt) => `APIs and backend services${with_(tt)}.`; caps = capsOf(c); break;
      case 'Desktop Applications': techs = techsOf(c); sentence = (tt) => `Desktop tools for Windows${with_(tt)}.`; caps = capsOf(c, ['Excel & PDF processing', 'Data processing', 'Reporting & analytics']); break;
      case 'Developer Tools': techs = techsOf(c); sentence = (tt) => `Internal utilities and developer tooling${with_(tt)}.`; caps = capsOf(c); break;
      case 'Games': techs = techsOf(c, ['Dart']); sentence = (tt) => `Games and interactive experiences${with_(tt)}.`; caps = capsOf(c, ['Game mechanics']); break;
      case 'Productivity': techs = techsOf(c, ['Dart']); sentence = (tt) => `Personal productivity applications${with_(tt)}.`; caps = capsOf(c, ['Task & schedule management', 'Offline-first sync', 'Push notifications']); break;
      case 'E-commerce': techs = techsOf(c); sentence = (tt) => `Online store applications${with_(tt)}.`; caps = capsOf(c, ['Payments integration']); break;
      default: continue;
    }
    blocks.push({ title: `${c.name.toUpperCase()} · ${plural(c.count, 'PROJECT', 'PROJECTS')}`, count: c.count, sentence, techs, caps });
  }
  return blocks.slice(0, 6);
}

function renderWhatIBuild(parts, y, blocks) {
  const perRow = 3, colW = (INNER - 40 - 24 * (perRow - 1)) / perRow, rowH = 86;
  const rows = Math.ceil(blocks.length / perRow);
  const h = 24 + rows * rowH + 4;
  parts.push(card(PAD, y, INNER, h));
  blocks.forEach((b, i) => {
    const x = PAD + 20 + (i % perRow) * (colW + 24), by = y + 30 + Math.floor(i / perRow) * rowH;
    parts.push(text(x, by, fitText(b.title, 11, colW - 18), 'label'));
    // Prefer fewer technologies over a truncated sentence.
    let lines = null;
    for (let n = b.techs.length; n >= 0; n--) {
      const candidate = b.sentence(b.techs.slice(0, n));
      const wrapped = wrapText(candidate, 11.5, colW, 2);
      if (wrapped.join(' ') === candidate || n === 0) { lines = wrapped; break; }
    }
    lines.forEach((l, j) => parts.push(text(x, by + 18 + j * 16, l, 'body')));
    if (b.caps.length) parts.push(text(x, by + 18 + 2 * 16, fitList(b.caps, 11, colW), 'sub faint'));
  });
  return y + h + GAP;
}

const AREA_PHRASES = { 'Mobile Applications': 'Mobile applications', 'Business Software': 'Business systems', 'Web Applications': 'Web platforms', 'AI & Automation': 'Automation & AI tools', 'Backend Systems': 'APIs & backend services', 'Desktop Applications': 'Desktop tools', 'Developer Tools': 'Developer tooling', 'Games': 'Games', 'Productivity': 'Productivity apps', 'E-commerce': 'E-commerce' };

function renderPositioning(parts, y, p) {
  const h = 84;
  parts.push(card(PAD, y, INNER, h));
  parts.push(text(PAD + 20, y + 36, 'BUILDING SOFTWARE THAT SOLVES REAL PROBLEMS', 'pos'));
  const areas = p.categories.map((c) => AREA_PHRASES[c.name]).filter(Boolean).slice(0, 4);
  parts.push(text(PAD + 20, y + 58, fitText(areas.join('  ·  '), 12, INNER - 40 - 250), 'meta'));
  parts.push(text(W - PAD - 20, y + 36, 'AVAILABLE FOR SELECTED PROJECTS', 'label-accent', 'text-anchor="end"'));
  parts.push(text(W - PAD - 20, y + 58, 'GitHub  ·  LinkedIn  ·  Contact', 'meta', 'text-anchor="end"'));
  return y + h + GAP;
}

module.exports = { renderProfile };
