// Enforcement Readiness core: estimates how many legitimate conversation types a
// zone-pair allowlist would block because the learning window never observed them.
//
// Model: each day of monitoring is a sampling unit. A "conversation type" is a
// (source device, destination device, protocol/port) tuple; its incidence Y_k is the
// number of learning days on which it appeared. Unseen-but-legitimate types are the
// "undetected species" of incidence-based richness estimation:
//   Chao (1987) / Chao et al. (2009) for the undetected count Q0,
//   Shen, Chao & Lin (2003) / Chao et al. (2014) for extrapolating new types in m more days.
// Prediction intervals come from a parametric bootstrap over a coverage-adjusted
// assemblage, so they include both estimation error and day-to-day randomness.
// Works in the browser and in node (pure ES module, no dependencies).

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- incidence statistics ----------
export function incidenceStats(Ys, T) {
  let S = 0, Q1 = 0, Q2 = 0, U = 0;
  for (const y of Ys) {
    if (y <= 0) continue;
    S++; U += y;
    if (y === 1) Q1++;
    else if (y === 2) Q2++;
  }
  return { S, Q1, Q2, U, T };
}

// Bias-corrected Chao2 estimate of the number of legitimate types not yet seen.
export function q0Hat({ Q1, Q2, T }) {
  if (T <= 1 || Q1 === 0) return 0;
  const k = (T - 1) / T;
  return Q2 > 0 ? (k * Q1 * Q1) / (2 * Q2) : (k * Q1 * (Q1 - 1)) / 2;
}

// Expected number of NEW types first seen during the next m days.
export function expectedNew(st, m) {
  if (m <= 0 || st.Q1 === 0) return 0;
  const Q0 = q0Hat(st);
  if (Q0 <= 0) return 0;
  const r = st.Q1 / (st.T * Q0 + st.Q1);
  return Q0 * (1 - Math.pow(1 - r, m));
}

// Expected new types in the m-day window that starts after `a` more days of learning.
export function expectedNewAfter(st, a, m) {
  return expectedNew(st, a + m) - expectedNew(st, a);
}

// Estimated sample coverage of a new day (share of daily incidences that belong to
// already-seen types). 1 - coverage is the chance a given day's conversation is unseen.
export function sampleCoverage({ Q1, Q2, U, T }) {
  if (U === 0) return 0;
  if (Q1 === 0) return 1;
  const a = (T - 1) * Q1;
  const b = Q2 > 0 ? a + 2 * Q2 : a + 2; // Chao & Jost 2012 with the Q2 = 0 guard
  return Math.max(0, 1 - (Q1 / U) * (a / b));
}

// Smallest number of extra learning days after which the expected number of unseen
// types in the following `m` days drops below `thr`. Returns Infinity past maxDays.
export function daysToReady(st, m, thr, maxDays = 365) {
  if (expectedNew(st, m) < thr) return 0;
  for (let a = 1; a <= maxDays; a++) if (expectedNewAfter(st, a, m) < thr) return a;
  return Infinity;
}

// ---------- assemblage + bootstrap ----------
function binomial(n, p, rng) {
  if (p <= 0) return 0;
  if (p >= 1) return n;
  // inversion by sequential search, cheap because n (days) is small
  const q = 1 - p;
  let pmf = Math.pow(q, n), cdf = pmf, k = 0;
  const u = rng();
  while (u > cdf && k < n) {
    pmf *= ((n - k) / (k + 1)) * (p / q);
    k++;
    cdf += pmf;
  }
  return k;
}

// Coverage-adjusted detection probabilities for observed types plus an estimated set of
// undetected types. Observed: pi_k = Y_k/T * (1 - lambda * exp(-theta*Y_k)) shrinks rare
// types (Chao et al. 2014 style); theta is chosen so the assemblage reproduces the
// observed number of singletons. Undetected types share the coverage deficit equally.
export function estimateAssemblage(Ys, T) {
  const st = incidenceStats(Ys, T);
  const obs = Ys.filter((y) => y > 0);
  const C = sampleCoverage(st);
  const Q0 = q0Hat(st);
  const f0 = Math.ceil(Q0 - 1e-9);
  const deficit = (1 - C) * (st.U / T); // expected daily incidences of unseen types
  const pi0 = f0 > 0 ? Math.min(1, deficit / f0) : 0;
  const build = (theta) => {
    let denom = 0;
    for (const y of obs) denom += (y / T) * Math.exp(-theta * y);
    const lambda = denom > 0 ? (1 - C) / denom : 0;
    return obs.map((y) => Math.min(1, Math.max(1e-6, (y / T) * (1 - Math.min(0.999, lambda * Math.exp(-theta * y))))));
  };
  const singles = (pis) => {
    let s = 0;
    for (const p of pis) s += T * p * Math.pow(1 - p, T - 1);
    return s + f0 * T * pi0 * Math.pow(1 - pi0, T - 1);
  };
  let pis = build(1);
  if (st.Q1 > 0 && obs.length) {
    let lo = 0.01, hi = 20;
    for (let it = 0; it < 40; it++) {
      const mid = Math.sqrt(lo * hi);
      // larger theta -> less shrinkage of frequent types, more of the rare ones
      const s = singles(build(mid));
      if (s > st.Q1) lo = mid; else hi = mid;
    }
    pis = build(Math.sqrt(lo * hi));
  }
  const all = pis.slice();
  for (let i = 0; i < f0; i++) all.push(pi0);
  return { pis: all, nObserved: pis.length, f0, pi0, coverage: C, Q0 };
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Parametric bootstrap prediction interval for the number of new types in m days.
// Returns the point estimate, the interval and the raw error draws (so callers can
// aggregate several zone pairs into a site-level interval).
export function predictNew(Ys, T, m, { B = 200, alpha = 0.1, seed = 1 } = {}) {
  const st = incidenceStats(Ys, T);
  const est = expectedNew(st, m);
  const asm = estimateAssemblage(Ys, T);
  const rng = mulberry32(seed);
  const errs = new Float64Array(B);
  const ySim = new Int32Array(asm.pis.length);
  for (let b = 0; b < B; b++) {
    let actual = 0;
    for (let i = 0; i < asm.pis.length; i++) {
      const p = asm.pis[i];
      const y = binomial(T, p, rng);
      ySim[i] = y;
      if (y === 0 && rng() < 1 - Math.pow(1 - p, m)) actual++;
    }
    const simEst = expectedNew(incidenceStats(ySim, T), m);
    errs[b] = actual - simEst;
  }
  const sorted = Array.from(errs).sort((x, y) => x - y);
  const lo = Math.max(0, est + quantile(sorted, alpha / 2));
  const hi = Math.max(lo, est + quantile(sorted, 1 - alpha / 2));
  return { est, lo, hi, errs, stats: st, assemblage: asm };
}

// ---------- zone-pair views ----------
// types: [srcIdx, dstIdx, svcIdx, days[]] ; t = only use days < t
export function hostLevelIncidence(types, t) {
  const Ys = [];
  for (const ty of types) {
    let y = 0;
    for (const d of ty[3]) if (d < t) y++;
    if (y > 0) Ys.push(y);
  }
  return Ys;
}

// Same data with rules written per service (zone pair x protocol/port) instead of per host pair.
export function serviceLevelIncidence(types, t) {
  const bySvc = new Map();
  for (const ty of types) {
    let set = bySvc.get(ty[2]);
    if (!set) bySvc.set(ty[2], (set = new Set()));
    for (const d of ty[3]) if (d < t) set.add(d);
  }
  const Ys = [];
  for (const s of bySvc.values()) if (s.size > 0) Ys.push(s.size);
  return Ys;
}

// Actual new types first seen in [t, t+m) at host level (for backtests on history).
export function actualNewInWindow(types, t, m) {
  let n = 0;
  for (const ty of types) {
    let first = Infinity;
    for (const d of ty[3]) if (d < first) first = d;
    if (first >= t && first < t + m) n++;
  }
  return n;
}

// Discovery curve: cumulative distinct types by day, plus the extrapolated expectation.
export function discoveryCurve(types, T, horizon) {
  const firsts = types.map((ty) => Math.min(...ty[3])).filter((d) => d < T);
  const obs = new Array(T).fill(0);
  for (const f of firsts) obs[f]++;
  for (let i = 1; i < T; i++) obs[i] += obs[i - 1];
  const st = incidenceStats(hostLevelIncidence(types, T), T);
  const ext = [];
  for (let m = 0; m <= horizon; m++) ext.push(st.S + expectedNew(st, m));
  return { observed: obs, extrapolated: ext, asymptote: st.S + q0Hat(st) };
}

export const DEFAULTS = { horizon: 30, threshold: 0.5, quickExtend: 21, maxExtend: 60, B: 200, alpha: 0.1 };

// Group-level view: one rule per (source device type, destination device type, service),
// which is how a zone policy condition is usually written. types[k][4] is the group key.
export function groupLevelIncidence(types, t) {
  const byKey = new Map();
  for (const ty of types) {
    let set = byKey.get(ty[4]);
    if (!set) byKey.set(ty[4], (set = new Set()));
    for (const d of ty[3]) if (d < t) set.add(d);
  }
  const Ys = [];
  for (const s of byKey.values()) if (s.size > 0) Ys.push(s.size);
  return Ys;
}

// How much a group-level rule widens the allowlist: device pairs it would permit that
// were never observed talking (groupSizes[g] = |source group| x |destination group|).
export function wideningCost(types, groupSizes, t) {
  const seen = new Map();
  for (const ty of types) {
    if (!ty[3].some((d) => d < t)) continue;
    let set = seen.get(ty[4]);
    if (!set) seen.set(ty[4], (set = new Set()));
    set.add(ty[0] + '|' + ty[1]);
  }
  let allowed = 0, observed = 0;
  for (const [g, set] of seen) { allowed += groupSizes[g]; observed += set.size; }
  return { allowedPairs: allowed, observedPairs: observed, addedPairs: allowed - observed };
}

// Decision rule. High-impact destinations are never widened: rare, host-specific
// interactive access into them is routed through Secure Access (just-in-time sessions)
// instead of a permanent allow rule.
export function recommend({ est, days, groupEst, dstImpact, interactiveSrc }, o = DEFAULTS) {
  if (est < o.threshold) return { code: 'ready', label: 'Ready to Enforce' };
  if (dstImpact === 'High' && interactiveSrc) return { code: 'jit', label: 'Route via Secure Access' };
  if (days <= o.quickExtend) return { code: 'extend', label: 'Extend Learning' };
  if (groupEst < o.threshold && dstImpact !== 'High') return { code: 'generalize', label: 'Generalize to Group Rule' };
  if (days <= o.maxExtend) return { code: 'extend', label: 'Extend Learning' };
  return { code: 'review', label: 'Manual Review' };
}

// Full analysis of one zone pair at report time T.
// pair: { id, types:[src,dst,svc,days[],groupKey], groupSizes:[], dstImpact, interactiveSrc }
export function analyzePair(pair, T, o = DEFAULTS, seed = 7) {
  const Ys = hostLevelIncidence(pair.types, T);
  const pred = predictNew(Ys, T, o.horizon, { B: o.B, alpha: o.alpha, seed });
  const st = pred.stats;
  const gSt = incidenceStats(groupLevelIncidence(pair.types, T), T);
  const groupEst = expectedNew(gSt, o.horizon);
  const days = daysToReady(st, o.horizon, o.threshold, 365);
  const widen = pair.groupSizes ? wideningCost(pair.types, pair.groupSizes, T) : null;
  const rec = recommend({ est: pred.est, days, groupEst, dstImpact: pair.dstImpact, interactiveSrc: pair.interactiveSrc }, o);
  const cov = sampleCoverage(st);
  return {
    id: pair.id,
    observed: st.S,
    Q1: st.Q1,
    Q2: st.Q2,
    U: st.U,
    q0: q0Hat(st),
    est: pred.est,
    lo: pred.lo,
    hi: pred.hi,
    errs: pred.errs,
    coverage: cov,
    unseenDailyRate: (1 - cov) * (st.U / T),
    groupRules: gSt.S,
    groupEst,
    widen,
    daysToReady: days,
    rec,
  };
}

// Site-level interval: sum the per-pair bootstrap error draws index by index.
export function aggregateInterval(results, alpha = 0.1) {
  const B = results[0]?.errs.length || 0;
  const tot = new Float64Array(B);
  let est = 0;
  for (const r of results) {
    est += r.est;
    for (let b = 0; b < B; b++) tot[b] += r.errs[b];
  }
  const sorted = Array.from(tot).sort((x, y) => x - y);
  return { est, lo: Math.max(0, est + quantile(sorted, alpha / 2)), hi: est + quantile(sorted, 1 - alpha / 2) };
}

// Rolling-origin backtest on the site's own history.
export function backtest(pairs, origins, m, o = DEFAULTS) {
  const pts = [];
  origins.forEach((t, oi) => {
    pairs.forEach((p, pi) => {
      const Ys = hostLevelIncidence(p.types, t);
      if (!Ys.length) return;
      const pr = predictNew(Ys, t, m, { B: o.B, alpha: o.alpha, seed: 1000 + oi * 97 + pi });
      const actual = actualNewInWindow(p.types, t, m);
      pts.push({ pair: p.id, origin: t, est: pr.est, lo: pr.lo, hi: pr.hi, actual, inside: actual >= Math.floor(pr.lo) && actual <= Math.ceil(pr.hi) });
    });
  });
  const n = pts.length;
  const covered = pts.filter((p) => p.inside).length;
  const mae = pts.reduce((s, p) => s + Math.abs(p.est - p.actual), 0) / Math.max(1, n);
  const bias = pts.reduce((s, p) => s + (p.est - p.actual), 0) / Math.max(1, n);
  return { points: pts, n, covered, coverage: covered / Math.max(1, n), mae, bias };
}
