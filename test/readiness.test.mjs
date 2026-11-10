import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mulberry32, incidenceStats, q0Hat, expectedNew, expectedNewAfter, sampleCoverage, daysToReady,
  predictNew, hostLevelIncidence, groupLevelIncidence, wideningCost, actualNewInWindow,
  recommend, analyzePair, aggregateInterval, backtest, discoveryCurve, DEFAULTS,
} from '../core/readiness.js';
import { simulateSite, splitSite } from '../core/sim.js';

const site = JSON.parse(readFileSync(new URL('../data/site.json', import.meta.url)));
const truth = JSON.parse(readFileSync(new URL('../data/truth.json', import.meta.url)));

test('Chao2 undetected count and extrapolation match hand calculation', () => {
  // Y = [1,1,1,2,2,5] over T=10 days -> Q1=3, Q2=2
  const st = incidenceStats([1, 1, 1, 2, 2, 5], 10);
  assert.deepEqual([st.S, st.Q1, st.Q2, st.U], [6, 3, 2, 12]);
  const q0 = (9 / 10) * (9 / 4);
  assert.ok(Math.abs(q0Hat(st) - q0) < 1e-12);
  const r = 3 / (10 * q0 + 3);
  assert.ok(Math.abs(expectedNew(st, 7) - q0 * (1 - (1 - r) ** 7)) < 1e-12);
  // Q2 = 0 bias-corrected form
  assert.ok(Math.abs(q0Hat(incidenceStats([1, 1, 1, 4], 8)) - (7 / 8) * 3) < 1e-12);
  // coverage with Q2 > 0: 1 - Q1/U * (T-1)Q1 / ((T-1)Q1 + 2Q2)
  assert.ok(Math.abs(sampleCoverage(st) - (1 - (3 / 12) * (27 / 31))) < 1e-12);
  assert.equal(sampleCoverage(incidenceStats([3, 4, 9], 10)), 1);
});

test('extrapolation is monotone, bounded by Q0, and the extend-learning window shrinks', () => {
  const st = incidenceStats([1, 1, 1, 1, 2, 2, 3, 7, 9, 20], 21);
  let prev = 0;
  for (let m = 0; m <= 120; m++) {
    const v = expectedNew(st, m);
    assert.ok(v >= prev - 1e-12 && v <= q0Hat(st) + 1e-9);
    prev = v;
  }
  for (let a = 0; a < 60; a++) assert.ok(expectedNewAfter(st, a + 1, 30) <= expectedNewAfter(st, a, 30) + 1e-12);
  const d = daysToReady(st, 30, 0.5);
  assert.ok(Number.isFinite(d) && d > 0);
  assert.ok(expectedNewAfter(st, d, 30) < 0.5 && expectedNewAfter(st, d - 1, 30) >= 0.5);
  assert.equal(daysToReady(incidenceStats([5, 9, 12], 21), 30, 0.5), 0);
});

test('iid assemblages: estimator is close to unbiased and 90% intervals cover about 90%', () => {
  const rng = mulberry32(99);
  const T = 35, m = 30, R = 150;
  let sumEst = 0, sumAct = 0, inside = 0;
  for (let r = 0; r < R; r++) {
    // 220 latent conversation types with lognormal daily rates (long tail of rare ones)
    const ps = Array.from({ length: 220 }, () => {
      const u = Math.max(1e-12, rng()), v = rng();
      return Math.min(0.95, Math.exp(-3.4 + 1.1 * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)));
    });
    const Ys = [];
    let actual = 0;
    for (const p of ps) {
      let y = 0;
      for (let d = 0; d < T; d++) if (rng() < p) y++;
      if (y > 0) Ys.push(y);
      else if (rng() < 1 - (1 - p) ** m) actual++;
    }
    const pr = predictNew(Ys, T, m, { B: 200, seed: r + 1 });
    sumEst += pr.est; sumAct += actual;
    if (actual >= Math.floor(pr.lo) && actual <= Math.ceil(pr.hi)) inside++;
  }
  const relBias = (sumEst - sumAct) / sumAct;
  assert.ok(Math.abs(relBias) < 0.12, `relative bias ${relBias.toFixed(3)}`);
  const cov = inside / R;
  assert.ok(cov >= 0.82 && cov <= 0.99, `coverage ${cov}`);
});

test('realistic (non-iid) plant simulations: site-level interval covers the truth across seeds', () => {
  let siteInside = 0, pairInside = 0, pairN = 0;
  const seeds = [11, 22, 33, 44, 55, 66];
  for (const seed of seeds) {
    const { learn, truth: tr } = splitSite(simulateSite(seed, 72), 42);
    const res = learn.map((p, i) => analyzePair(p, 42, { ...DEFAULTS, B: 150 }, 5 + i));
    const agg = aggregateInterval(res);
    const actualTotal = tr.reduce((s, p) => s + p.newTypes.filter((t) => t[3] < 72).length, 0);
    if (actualTotal >= agg.lo && actualTotal <= agg.hi) siteInside++;
    res.forEach((r, i) => {
      const a = tr[i].newTypes.filter((t) => t[3] < 72).length;
      pairN++;
      if (a >= Math.floor(r.lo) && a <= Math.ceil(r.hi)) pairInside++;
    });
  }
  assert.ok(siteInside >= 5, `site-level coverage ${siteInside}/${seeds.length}`);
  assert.ok(pairInside / pairN >= 0.8, `pair-level coverage ${(pairInside / pairN).toFixed(3)}`);
});

test('group-level rules and widening cost are consistent', () => {
  for (const p of site.pairs) {
    const host = hostLevelIncidence(p.types, site.meta.T);
    const grp = groupLevelIncidence(p.types, site.meta.T);
    assert.ok(grp.length <= host.length);
    assert.ok(Math.max(...grp) >= Math.max(...host)); // unions of days can only grow
    const w = wideningCost(p.types, p.groupSizes, site.meta.T);
    assert.equal(w.observedPairs <= w.allowedPairs, true);
    assert.equal(w.addedPairs, w.allowedPairs - w.observedPairs);
  }
});

test('recommendation rule ordering', () => {
  const base = { days: 5, groupEst: 0, dstImpact: 'Low', interactiveSrc: false };
  assert.equal(recommend({ ...base, est: 0.2 }).code, 'ready');
  assert.equal(recommend({ ...base, est: 3, dstImpact: 'High', interactiveSrc: true }).code, 'jit');
  assert.equal(recommend({ ...base, est: 3 }).code, 'extend');
  assert.equal(recommend({ ...base, est: 3, days: 90 }).code, 'generalize');
  assert.equal(recommend({ ...base, est: 3, days: 40, dstImpact: 'High' }).code, 'extend');
  assert.equal(recommend({ ...base, est: 3, days: 200, dstImpact: 'High', groupEst: 2 }).code, 'review');
});

test('shipped data: learning/truth split is clean and the discovery curve ends at the observed count', () => {
  const T = site.meta.T;
  site.pairs.forEach((p, i) => {
    for (const ty of p.types) assert.ok(ty[3].every((d) => d < T));
    for (const ty of truth.pairs[i].newTypes) assert.ok(ty[3] >= T);
    const c = discoveryCurve(p.types, T, 30);
    assert.equal(c.observed[T - 1], p.types.length);
    assert.equal(c.extrapolated[0], p.types.length);
    assert.equal(actualNewInWindow(p.types, 0, T), p.types.length);
  });
});

test('shipped data: rolling-origin backtest is calibrated', () => {
  const bt = backtest(site.pairs, [14, 21, 28], 14);
  assert.ok(bt.n >= 80);
  assert.ok(bt.coverage >= 0.85, `coverage ${bt.coverage}`);
  assert.ok(Math.abs(bt.bias) < 1.5, `bias ${bt.bias}`);
});
