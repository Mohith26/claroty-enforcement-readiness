// Calibration report: node scripts/coverage.mjs [seeds]
// 1) Realistic plant simulator (non-iid: polling, long-tail maintenance, weekly/monthly/
//    quarterly jobs, bursty vendor sessions): per-pair and site-level 90% interval coverage
//    for the 30-day forecast made at day 42.
// 2) Rolling-origin backtest on the shipped site's own history.
import { readFileSync } from 'node:fs';
import { simulateSite, splitSite } from '../core/sim.js';
import { analyzePair, aggregateInterval, backtest, DEFAULTS } from '../core/readiness.js';

const nSeeds = +(process.argv[2] || 20);
let pIn = 0, pN = 0, sIn = 0, absErr = 0, bias = 0;
const recs = {};
for (let s = 0; s < nSeeds; s++) {
  const { learn, truth } = splitSite(simulateSite(1000 + s, 72), 42);
  const res = learn.map((p, i) => analyzePair(p, 42, DEFAULTS, 5 + i));
  const agg = aggregateInterval(res);
  let tot = 0;
  res.forEach((r, i) => {
    const a = truth[i].newTypes.filter((t) => t[3] < 72).length;
    tot += a; pN++;
    if (a >= Math.floor(r.lo) && a <= Math.ceil(r.hi)) pIn++;
    absErr += Math.abs(r.est - a); bias += r.est - a;
    recs[r.rec.code] = (recs[r.rec.code] || 0) + 1;
  });
  if (tot >= agg.lo && tot <= agg.hi) sIn++;
}
console.log(`simulated sites: ${nSeeds}, zone-pair forecasts: ${pN}`);
console.log(`pair-level 90% interval coverage: ${(pIn / pN * 100).toFixed(1)}%  MAE ${(absErr / pN).toFixed(2)}  mean bias ${(bias / pN).toFixed(2)}`);
console.log(`site-level 90% interval coverage: ${sIn}/${nSeeds}`);
console.log('recommendation mix:', recs);
const site = JSON.parse(readFileSync(new URL('../data/site.json', import.meta.url)));
const bt = backtest(site.pairs, [14, 21, 28], 14);
console.log(`shipped site backtest: ${bt.covered}/${bt.n} (${(bt.coverage * 100).toFixed(1)}%), MAE ${bt.mae.toFixed(2)}, bias ${bt.bias.toFixed(2)}`);
