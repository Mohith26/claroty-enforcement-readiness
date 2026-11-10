import {
  analyzePair, aggregateInterval, backtest, discoveryCurve, predictNew, hostLevelIncidence,
  incidenceStats, expectedNew, DEFAULTS,
} from './core/readiness.js';

const $ = (s) => document.querySelector(s);
const fmt = (x, d = 1) => (Math.round(x * 10 ** d) / 10 ** d).toFixed(d);
const int = (x) => Math.round(x).toLocaleString('en-US');
const ZONE_ORDER = ['PL1', 'PL2', 'SCADA', 'EWS', 'HIST', 'FIRE', 'BC', 'SRV', 'CAM', 'PRN', 'DMZ', 'CORP'];
const REC = {
  ready: { label: 'Ready to Enforce', cell: '#a0daa3', icon: 'ti-shield-check' },
  extend: { label: 'Extend Learning', cell: '#f0df98', icon: 'ti-hourglass' },
  generalize: { label: 'Generalize to Group Rule', cell: '#f9c592', icon: 'ti-arrows-maximize' },
  jit: { label: 'Route via Secure Access', cell: '#d9bff0', icon: 'ti-lock-access' },
  review: { label: 'Manual Review', cell: '#f3aeaf', icon: 'ti-eye-search' },
};

const [site, truth] = await Promise.all([
  fetch('data/site.json').then((r) => r.json()),
  fetch('data/truth.json').then((r) => r.json()),
]);
const T = site.meta.T;
const start = new Date(site.meta.learnStart + 'T12:00:00Z');
const dayDate = (d) => new Date(start.getTime() + d * 864e5);
const md = (d) => dayDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const mdy = (d) => { const x = dayDate(d); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}/${String(x.getUTCFullYear()).slice(2)}`; };
const zone = Object.fromEntries(site.zones.map((z) => [z.id, z]));
const svc = site.services;
const truthById = Object.fromEntries(truth.pairs.map((p) => [p.id, p.newTypes]));

const state = { h: 30, sel: 'EWS>PL1', sortK: 'est', sortDir: -1, q: '', recOff: new Set() };
// deep links: #h=14&pair=DMZ>EWS
const hp = new URLSearchParams(location.hash.slice(1));
if ([7, 14, 30].includes(+hp.get('h'))) state.h = +hp.get('h');
if (site.pairs.some((p) => p.id === hp.get('pair'))) state.sel = hp.get('pair');
document.querySelectorAll('#hseg button').forEach((x) => x.classList.toggle('on', +x.dataset.h === state.h));
let results = [], byId = {};

// rolling-origin backtest on history: 14-day forecasts made on day 14, 21 and 28
const BT = backtest(site.pairs, [14, 21, 28], 14);

function compute() {
  const o = { ...DEFAULTS, horizon: state.h };
  results = site.pairs.map((p, i) => {
    const r = analyzePair(p, T, o, 7 + i);
    const actual = (truthById[p.id] || []).filter((t) => t[3] < T + state.h).length;
    const devs = new Set();
    for (const ty of p.types) { devs.add(p.src + ':' + ty[0]); devs.add(p.dst + ':' + ty[1]); }
    return { ...r, src: p.src, dst: p.dst, pair: p, actual, inside: actual >= Math.floor(r.lo) && actual <= Math.ceil(r.hi), devs, daily: 1 - Math.exp(-r.unseenDailyRate) };
  });
  byId = Object.fromEntries(results.map((r) => [r.id, r]));
}

function render() {
  compute();
  document.querySelectorAll('.hzn').forEach((e) => (e.textContent = state.h));
  document.querySelector('.hzl').textContent = `(${state.h}D)`;
  $('#windowLbl').textContent = `${md(0)} - ${md(T - 1)} (${T} days)`;
  renderKpis();
  renderGauge();
  renderMatrix();
  renderCurve();
  renderDetail();
  renderBacktest();
  renderTable();
}

function renderKpis() {
  const ready = results.filter((r) => r.rec.code === 'ready');
  // a device is ready only if every zone pair it takes part in is ready
  const notReadyDev = new Set(), allDev = new Set();
  for (const r of results) for (const d of r.devs) { allDev.add(d); if (r.rec.code !== 'ready') notReadyDev.add(d); }
  $('#totPairs').textContent = results.length;
  $('#kReadyPairs').textContent = ready.length;
  $('#kReadyDev').textContent = int(allDev.size - notReadyDev.size);
  $('#kNotPairs').textContent = results.length - ready.length;
  $('#kNotDev').textContent = int(notReadyDev.size);
  const agg = aggregateInterval(results);
  $('#kUnseen').textContent = int(agg.est);
  $('#kRange').textContent = `${int(agg.lo)} - ${int(agg.hi)}`;
  $('#kCov').textContent = `${BT.covered}/${BT.n}`;
  $('#kMae').textContent = fmt(BT.mae, 1);
}

function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}
function lerpColor(stops, t) {
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const u = (t - t0) / (t1 - t0);
      const h = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
      const a = h(c0), b = h(c1);
      return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * u)).join(',')})`;
    }
  }
  return stops[stops.length - 1][1];
}
function renderGauge() {
  const ready = results.filter((r) => r.rec.code === 'ready').length;
  const pct = (ready / results.length) * 100;
  const cx = 110, cy = 106, r = 84, a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;
  const stops = [[0, '#e5484d'], [0.25, '#f07a3c'], [0.5, '#f2c12e'], [0.75, '#b8d35a'], [1, '#9ccc65']];
  let s = '';
  const N = 60;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1.15) / N;
    s += `<path d="${arcPath(cx, cy, r, a0 + (a1 - a0) * t0, a0 + (a1 - a0) * Math.min(1, t1))}" stroke="${lerpColor(stops, t0)}" stroke-width="13" fill="none"/>`;
  }
  const av = a0 + (a1 - a0) * (pct / 100);
  const ix = cx + (r - 18) * Math.cos(av), iy = cy + (r - 18) * Math.sin(av), ox = cx + (r + 9) * Math.cos(av), oy = cy + (r + 9) * Math.sin(av);
  s += `<line x1="${ix}" y1="${iy}" x2="${ox}" y2="${oy}" stroke="#1a1523" stroke-width="2" stroke-dasharray="3 2"/>`;
  s += `<path d="M${ox} ${oy} l${(6 * Math.cos(av + 2.6)).toFixed(2)} ${(6 * Math.sin(av + 2.6)).toFixed(2)} M${ox} ${oy} l${(6 * Math.cos(av - 2.6)).toFixed(2)} ${(6 * Math.sin(av - 2.6)).toFixed(2)}" stroke="#1a1523" stroke-width="1.6"/>`;
  s += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="27" font-weight="500" fill="#1a1523">${fmt(pct, 1)}%</text>`;
  s += `<text x="${cx}" y="${cy + 27}" text-anchor="middle" font-size="12" fill="#1a1523">Zone Pairs Ready</text>`;
  $('#gauge').innerHTML = s;
}

function cellColor(r) { return r ? REC[r.rec.code].cell : '#f4f2f4'; }
function renderMatrix() {
  const cs = 23;
  let h = '<table class="mx"><tr><td></td><td></td><td colspan="12" class="axisT">Destination Zones</td></tr>';
  h += '<tr><td></td><td></td>' + ZONE_ORDER.map((z) => `<td class="cl"><div>${zone[z].name}</div></td>`).join('') + '</tr>';
  ZONE_ORDER.forEach((s, i) => {
    h += '<tr>';
    if (i === 0) h += `<td rowspan="12" class="axisL">Source Zones</td>`;
    h += `<td class="rl" title="${zone[s].name}">${zone[s].name}</td>`;
    for (const d of ZONE_ORDER) {
      const r = byId[`${s}>${d}`];
      const off = r && state.recOff.has(r.rec.code);
      const sel = r && r.id === state.sel ? ' sel' : '';
      h += `<td class="cell${r ? ' has' : ''}${sel}" data-id="${r ? r.id : ''}" style="background:${off ? '#f4f2f4' : cellColor(r)};width:${cs}px;height:${cs}px">${r && r.est >= 10 && !off ? '<span class="d" style="background:#c62a2f"></span>' : ''}</td>`;
    }
    h += '</tr>';
  });
  h += '</table>';
  $('#matrix').innerHTML = h;
  $('#matrix').querySelectorAll('.cell.has').forEach((c) => {
    c.addEventListener('click', () => { state.sel = c.dataset.id; render(); });
    c.addEventListener('mousemove', (e) => {
      const r = byId[c.dataset.id];
      tip(e, `<b>${zone[r.src].name} → ${zone[r.dst].name}</b><br><span>${r.rec.label}</span><br>${r.observed} observed · ${fmt(r.est)} predicted unseen (${state.h}d)`);
    });
    c.addEventListener('mouseleave', hideTip);
  });
  let lg = '';
  for (const [k, v] of Object.entries(REC)) {
    const n = results.filter((r) => r.rec.code === k).length;
    lg += `<span data-k="${k}" class="${state.recOff.has(k) ? 'off' : ''}"><i style="background:${v.cell}"></i>${v.label} (${n})</span>`;
  }
  lg += `<span><i style="background:#f4f2f4"></i>No Traffic (Deny All)</span><span><i style="background:#fff;border-radius:50%;position:relative"><b style="position:absolute;left:3px;top:3px;width:7px;height:7px;border-radius:50%;background:#c62a2f"></b></i>10+ Predicted Unseen</span>`;
  $('#mlegend').innerHTML = lg;
  $('#mlegend').querySelectorAll('span[data-k]').forEach((s) => s.addEventListener('click', () => {
    const k = s.dataset.k;
    state.recOff.has(k) ? state.recOff.delete(k) : state.recOff.add(k);
    renderMatrix(); renderTable();
  }));
}

function niceMax(v) {
  const e = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

function renderCurve() {
  const r = byId[state.sel];
  const p = r.pair;
  const h = state.h;
  const c = discoveryCurve(p.types, T, h);
  const st = incidenceStats(hostLevelIncidence(p.types, T), T);
  // prediction band at several horizons
  const steps = [];
  for (let m = 0; m <= h; m += Math.max(1, Math.round(h / 6))) steps.push(m);
  if (steps[steps.length - 1] !== h) steps.push(h);
  const band = steps.map((m) => {
    if (m === 0) return { m, lo: 0, hi: 0 };
    const pr = predictNew(hostLevelIncidence(p.types, T), T, m, { B: 200, seed: 31 + m });
    return { m, lo: pr.lo, hi: pr.hi };
  });
  const tr = (truthById[p.id] || []).map((t) => t[3]).filter((d) => d < T + h);
  const truthCum = [];
  for (let m = 1; m <= h; m++) truthCum.push(tr.filter((d) => d < T + m).length);
  const W = 600, H = 372, L = 50, R = 22, Tp = 26, Bm = 58;
  const xMax = T - 1 + h;
  const yTop = niceMax(Math.max(c.observed[T - 1] + band[band.length - 1].hi, c.observed[T - 1] + (truthCum[truthCum.length - 1] || 0)) * 1.04);
  const X = (d) => L + (d / xMax) * (W - L - R);
  const Y = (v) => H - Bm - (v / yTop) * (H - Bm - Tp);
  let s = '';
  for (let i = 0; i <= 5; i++) {
    const v = (yTop / 5) * i;
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ebeaec" stroke-width="1"/>`;
    s += `<text x="${L - 9}" y="${Y(v) + 3.5}" text-anchor="end" font-size="10" fill="#6f6e77">${int(v)}</text>`;
  }
  s += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="#6f6e77" stroke-width="1"/>`;
  for (let d = 0; d <= xMax; d += 7) {
    s += `<line x1="${X(d)}" x2="${X(d)}" y1="${Y(0)}" y2="${Y(0) + 5}" stroke="#6f6e77"/>`;
    s += `<text transform="translate(${X(d) + 4},${Y(0) + 13}) rotate(-45)" text-anchor="end" font-size="9.5" fill="#6f6e77">${mdy(d)}</text>`;
  }
  s += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="10.5" font-weight="500" fill="#1a1523">Date</text>`;
  s += `<text transform="translate(13,${(Tp + H - Bm) / 2}) rotate(-90)" text-anchor="middle" font-size="10.5" font-weight="500" fill="#1a1523">Conversation Types</text>`;
  // report date marker
  s += `<line x1="${X(T - 1)}" x2="${X(T - 1)}" y1="${Tp - 8}" y2="${Y(0)}" stroke="#bd91e3" stroke-dasharray="3 3"/>`;
  s += `<text x="${X(T - 1) - 6}" y="${Tp - 11}" text-anchor="end" font-size="10" fill="#793aaf">Report date ${md(T)}</text>`;
  // band
  const S = c.observed[T - 1];
  const up = band.map((b) => `${X(T - 1 + b.m)},${Y(S + b.hi)}`), dn = band.slice().reverse().map((b) => `${X(T - 1 + b.m)},${Y(S + b.lo)}`);
  s += `<polygon points="${up.concat(dn).join(' ')}" fill="rgba(121,58,175,0.14)" stroke="none"/>`;
  // extrapolated
  s += `<polyline points="${c.extrapolated.map((v, m) => `${X(T - 1 + m)},${Y(v)}`).join(' ')}" fill="none" stroke="#793aaf" stroke-width="2.2" stroke-dasharray="6 4"/>`;
  // observed
  s += `<polyline points="${c.observed.map((v, d) => `${X(d)},${Y(v)}`).join(' ')}" fill="none" stroke="#793aaf" stroke-width="2.2"/>`;
  c.observed.forEach((v, d) => { s += `<circle cx="${X(d)}" cy="${Y(v)}" r="2.3" fill="#793aaf"/>`; });
  // simulation truth
  truthCum.forEach((v, i) => { s += `<circle cx="${X(T + i)}" cy="${Y(S + v) + 0}" r="2.6" fill="#86848d" stroke="#fff" stroke-width="0.8"/>`; });
  // end labels like xDome data labels
  s += `<text transform="translate(${X(T - 1) - 2},${Y(S) - 8}) rotate(-45)" font-size="10" font-weight="600" fill="#1a1523">${S}</text>`;
  const end = c.extrapolated[h];
  s += `<text transform="translate(${X(xMax) - 14},${Y(end) - 8}) rotate(-45)" font-size="10" font-weight="600" fill="#1a1523">${fmt(end)}</text>`;
  $('#curve').innerHTML = s;
  $('#pairLine').innerHTML = `<div class="pl1"><b>${zone[r.src].name}</b><i class="ti ti-arrow-right"></i><b>${zone[r.dst].name}</b></div><div class="pl2">${S} types in ${T} days · ${fmt(c.extrapolated[h])} expected by ${md(T - 1 + h)} · ceiling ≈ ${fmt(c.asymptote)}</div>`;
}

function recText(r) {
  const h = state.h;
  const w = r.widen;
  const imp = zone[r.dst].impact;
  switch (r.rec.code) {
    case 'ready': return `Only ${fmt(r.est)} legitimate conversations are expected to appear for the first time in the next ${h} days (90% range ${fmt(r.lo)} - ${fmt(r.hi)}). Enforcing the recommended allow list now is unlikely to block production traffic.`;
    case 'extend': return `Keep the policy in monitor mode about ${r.daysToReady} more days (until ${md(T + r.daysToReady)}). After that, fewer than 0.5 new legitimate conversations are expected in the following ${h} days.`;
    case 'generalize': return `Write the policy per device type and service (${r.groupRules} group rules) instead of per device pair. Every group rule was seen on many days, so only ${fmt(r.groupEst, 2)} new group-level conversations are expected. Cost: it permits ${int(w.addedPairs)} device pairs that were never seen talking. Destination impact is ${imp}.`;
    case 'jit': return `Destination impact is High and the unseen traffic is interactive access from ${zone[r.src].name}. Enforce the steady conversations and route the rare sessions through Secure Access with just-in-time approval. A group rule would open ${int(w.addedPairs)} never-observed device pairs into a high-impact zone.`;
    default: return `The discovery curve is not flattening (${r.daysToReady === Infinity ? 'no convergence within a year' : `~${r.daysToReady} days to converge`}), and the destination is not a candidate for a wider rule. Review these conversations with the plant team before enforcing.`;
  }
}

function renderDetail() {
  const r = byId[state.sel];
  const p = r.pair;
  const zs = zone[p.src], zd = zone[p.dst];
  $('#detailTitle').innerHTML = `Why This Recommendation <i class="ti ti-info-circle muted"></i>`;
  const singles = p.types.filter((t) => t[3].length === 1).sort((a, b) => b[3][0] - a[3][0]);
  let h = `<p class="dsum"><b>${zs.name} → ${zd.name}</b>: ${r.observed} conversation types over ${T} days; <b>${r.Q1}</b> were seen on exactly one day and <b>${r.Q2}</b> on exactly two. That ratio implies about <b>${fmt(r.q0)}</b> legitimate types have not appeared yet, of which <b>${fmt(r.est)}</b> are expected in the next ${state.h} days.</p>`;
  h += `<div class="drec"><i class="ti ${REC[r.rec.code].icon}"></i><div><div class="t">${r.rec.label}</div><div class="s">${recText(r)}</div></div></div>`;
  if (singles.length) {
    h += `<div class="minihead">Seen Once: The Evidence <span>${Math.min(4, singles.length)} of ${singles.length}</span></div>`;
    h += '<table class="mini"><tr><th>Source</th><th>Destination</th><th>Protocol</th><th>Seen</th></tr>';
    for (const t of singles.slice(0, 4)) {
      const a = zs.devices[t[0]], b = zd.devices[t[1]], sv = svc[t[2]];
      h += `<tr><td class="ip">${a.name}<small>${a.ip}</small></td><td class="ip">${b.name}<small>${b.ip}</small></td><td>${sv.name}<small>${sv.proto}/${sv.port}</small></td><td>${md(t[3][0])}</td></tr>`;
    }
    h += '</table>';
  } else {
    h += `<div class="minihead">No conversation in this zone pair was seen only once: the allow list is saturated.</div>`;
  }
  $('#detail').innerHTML = h;
}

function renderBacktest() {
  const pts = BT.points;
  const W = 400, H = 270, L = 46, R = 14, Tp = 12, Bm = 42;
  const mx = niceMax(Math.max(...pts.map((p) => Math.max(p.hi, p.actual))) * 1.02);
  const sq = (v) => Math.sqrt(Math.max(0, v) / mx);
  const X = (v) => L + sq(v) * (W - L - R), Y = (v) => H - Bm - sq(v) * (H - Bm - Tp);
  let s = '';
  const ticks = [0, 1, 5, 10, 20, 40].filter((t) => t <= mx);
  for (const t of ticks) {
    s += `<line x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}" stroke="#ebeaec"/><text x="${L - 7}" y="${Y(t) + 3.5}" text-anchor="end" font-size="9.5" fill="#6f6e77">${t}</text>`;
    s += `<text x="${X(t)}" y="${H - Bm + 14}" text-anchor="middle" font-size="9.5" fill="#6f6e77">${t}</text>`;
  }
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(mx)}" y2="${Y(mx)}" stroke="#bd91e3" stroke-dasharray="4 4"/>`;
  for (const p of pts) {
    s += `<line x1="${X(p.lo)}" x2="${X(p.hi)}" y1="${Y(p.actual)}" y2="${Y(p.actual)}" stroke="${p.inside ? 'rgba(121,58,175,0.16)' : 'rgba(229,72,77,0.35)'}" stroke-width="1.4"/>`;
  }
  for (const p of pts) {
    s += `<circle class="btp" data-i="${pts.indexOf(p)}" cx="${X(p.est)}" cy="${Y(p.actual)}" r="3.6" fill="${p.inside ? '#793aaf' : '#e5484d'}" stroke="#fff" stroke-width="1"/>`;
  }
  s += `<text x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" font-weight="500" fill="#1a1523">Predicted new conversations (14-day forecast)</text>`;
  s += `<text transform="translate(12,${(Tp + H - Bm) / 2}) rotate(-90)" text-anchor="middle" font-size="10.5" font-weight="500" fill="#1a1523">Actually appeared</text>`;
  $('#bt').innerHTML = s;
  $('#bt').querySelectorAll('.btp').forEach((c) => {
    c.addEventListener('mousemove', (e) => {
      const p = pts[+c.dataset.i];
      const [a, b] = p.pair.split('>');
      tip(e, `<b>${zone[a].name} → ${zone[b].name}</b><br><span>Forecast on ${md(p.origin)} for the next 14 days</span><br>Predicted ${fmt(p.est)} (${fmt(p.lo)} - ${fmt(p.hi)}), actual ${p.actual}`);
    });
    c.addEventListener('mouseleave', hideTip);
  });
  $('#btNote').innerHTML = `Forecasts made on ${md(14)}, ${md(21)} and ${md(28)} from this site's own history: <b>${BT.covered} of ${BT.n}</b> 90% ranges (${fmt(BT.coverage * 100, 1)}%) contained the count that actually appeared. Mean bias ${BT.bias >= 0 ? '+' : ''}${fmt(BT.bias, 2)}.`;
}

function readyIn(r) {
  if (r.rec.code === 'ready') return 'Now';
  if (!Number.isFinite(r.daysToReady) || r.daysToReady > 60) return '> 60 days';
  return `~${r.daysToReady} days`;
}

function renderTable() {
  const q = state.q.toLowerCase();
  let rows = results.filter((r) => !state.recOff.has(r.rec.code) && (!q || `${zone[r.src].name} ${zone[r.dst].name} ${r.rec.label}`.toLowerCase().includes(q)));
  const k = state.sortK, dir = state.sortDir;
  const IMP = { High: 3, Medium: 2, Low: 1 };
  const val = (r) => (k === 'src' ? zone[r.src].name : k === 'dst' ? zone[r.dst].name : k === 'impact' ? IMP[zone[r.dst].impact] : k === 'rec' ? r.rec.label : k === 'daysToReady' ? (r.rec.code === 'ready' ? -1 : Math.min(r.daysToReady, 9999)) : r[k]);
  rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const names = { impact: 'Destination Impact', src: 'Source Zone', dst: 'Destination Zone', observed: 'Observed Conversations', Q1: 'Seen Once', est: 'Predicted Unseen', daily: 'Daily Block Risk', daysToReady: 'Ready In', rec: 'Recommendation', actual: 'Sim. Truth' };
  $('#sortChip').textContent = `${names[k]} (${dir < 0 ? 'desc' : 'asc'})`;
  $('#showCount').textContent = `${rows.length} Zone Pairs`;
  $('#tbl tbody').innerHTML = rows.map((r) => `
    <tr data-id="${r.id}" class="${r.id === state.sel ? 'sel' : ''}">
      <td>${zone[r.src].name}</td>
      <td>${zone[r.dst].name}</td>
      <td>${zone[r.dst].impact}</td>
      <td><span class="lnk">${int(r.observed)} <i class="ti ti-external-link"></i></span></td>
      <td>${r.Q1} / ${r.Q2}</td>
      <td><span class="est">${fmt(r.est)}</span> <span class="rng">(${fmt(r.lo)} - ${fmt(r.hi)})</span></td>
      <td>${fmt(r.daily * 100, 1)}%</td>
      <td>${readyIn(r)}</td>
      <td><span class="badge b-${r.rec.code}">${r.rec.label}</span></td>
      <td>${r.actual} <i class="ti ${r.inside ? 'ti-circle-check hit' : 'ti-alert-circle miss'}" title="${r.inside ? 'inside' : 'outside'} the 90% range"></i></td>
      <td></td>
    </tr>`).join('');
  $('#tbl tbody').querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => { state.sel = tr.dataset.id; render(); }));
}

// tooltip
const tipEl = document.createElement('div');
tipEl.className = 'tip';
document.body.appendChild(tipEl);
function tip(e, html) { tipEl.innerHTML = html; tipEl.style.display = 'block'; tipEl.style.left = e.clientX + 14 + 'px'; tipEl.style.top = e.clientY + 12 + 'px'; }
function hideTip() { tipEl.style.display = 'none'; }

// controls
document.querySelectorAll('#hseg button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#hseg button').forEach((x) => x.classList.toggle('on', x === b));
  state.h = +b.dataset.h;
  render();
}));
document.querySelectorAll('#tbl th[data-k]').forEach((th) => th.insertAdjacentHTML('beforeend', '<i class="ti ti-sort-descending si"></i>'));
document.querySelectorAll('#tbl th[data-k]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.k;
  if (state.sortK === k) state.sortDir *= -1; else { state.sortK = k; state.sortDir = -1; }
  renderTable();
}));
$('#search').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
$('#resetFilters').addEventListener('click', () => { state.q = ''; $('#search').value = ''; state.recOff.clear(); renderMatrix(); renderTable(); });
render();
