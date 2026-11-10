# Enforcement Readiness for Claroty xDome (concept demo)

**Live demo:** https://mohith26.github.io/claroty-enforcement-readiness/

> Unofficial concept demo by Mohith Gajjela. Not affiliated with Claroty. All data is synthetic, produced by a seeded generator (`scripts/generate.mjs`).

## What it is

A new page in xDome under **Network > Enforcement**, next to *Enforcement Overview* and *Enforcement by Model*. For each zone pair with a recommended allow-list policy, it answers the question a plant team asks before switching from monitor to enforce:

> **If we enforce this policy today, how many legitimate conversations will it block in the next 30 days because the learning window never saw them?**

For each zone pair it shows a predicted count with a 90% range, the chance that a given day contains a blocked legitimate conversation, how many more learning days would make it safe, and one of five recommendations:

| Recommendation | When |
|---|---|
| Ready to Enforce | fewer than 0.5 new legitimate conversations expected in the horizon |
| Route via Secure Access | the destination is high-impact and the rare traffic is interactive (engineering workstations, remote access, corporate), so rare sessions should go through just-in-time access instead of a permanent rule |
| Extend Learning | the expected count falls below 0.5 within 21 more days of monitoring (or 60 when nothing better applies) |
| Generalize to Group Rule | a rule per (device type, device type, service) is already saturated and the destination is not high-impact; the page shows how many never-observed device pairs the wider rule would allow |
| Manual Review | none of the above converges |

## Why it matters

Every segmentation product, xDome included, simulates a proposed policy against **traffic it has already observed**. What blocks production after enforcement is the traffic it has **not observed yet**: the monthly recipe download, the vendor's quarterly session, the engineering workstation that talks to a PLC twice a year. Today, "is the baseline long enough?" is a judgment call (often a fixed 30 days). This page turns it into a measured, backtested number per zone pair.

## How it works

1. **Data model.** A *conversation type* is a (source device, destination device, protocol/port) tuple inside a zone pair. Each learning day is a sampling unit; a type's *incidence* is the number of days it appeared.
2. **Unseen count (Chao2).** With `Q1` types seen on exactly one day, `Q2` on exactly two, and `T` days, the number of legitimate types not yet seen is estimated by `Q0 = (T-1)/T * Q1^2 / (2 Q2)`, with the bias-corrected form when `Q2 = 0`.
3. **New types in the next m days (Shen, Chao & Lin 2003; Chao et al. 2014).** `E[new] = Q0 * (1 - (1 - Q1 / (T*Q0 + Q1))^m)`. The same curve gives *days to ready*: the smallest `a` with `E[new in (a, a+30]] < 0.5`.
4. **Daily block chance.** Sample coverage `C = 1 - Q1/U * (T-1)Q1 / ((T-1)Q1 + 2Q2)` (Chao & Jost 2012) gives the expected daily incidences of unseen types, `(1 - C) U / T`, shown as `1 - exp(-rate)`.
5. **90% prediction ranges.** A parametric bootstrap builds a coverage-adjusted assemblage (observed types with shrunken detection probabilities, plus the estimated unseen types), then simulates both the learning window and the future window. The spread of (actual new) minus (re-estimated new) gives a *prediction* interval, so it covers both estimation error and day-to-day randomness. Per-pair error draws are summed to get the site-level range.
6. **Group-rule alternative.** The same estimator runs on (source device type, destination device type, service) keys. The *widening cost* is the number of device pairs the group rule permits that were never observed.
7. **Backtest.** Rolling-origin forecasts made on days 14, 21 and 28 of the site's own history, scored against what actually appeared over the next 14 days.

All of it is `core/readiness.js` (no dependencies, runs in the browser and in node). Every number on the page is computed from `data/site.json` at load time; nothing is hard-coded.

## Results on synthetic data

The simulator (`core/sim.js`) does **not** follow the iid model that the estimator assumes. It includes steady polling, long-tail maintenance traffic, weekly backups, monthly jobs, quarterly calibrations and bursty multi-day vendor sessions, across 12 zones, 674 devices and 30 zone pairs.

- Shipped site (seed 20261102): 137 unseen legitimate conversations predicted for the 30 days after the report date, 90% range 112 to 165. **138 actually appeared** in the simulation. 13 of 30 zone pairs are ready to enforce.
- Rolling backtest on the shipped site's history: **86 of 90** 14-day intervals contained the actual count (95.6%), mean absolute error 2.1.
- Across 20 freshly simulated sites (`npm run coverage`): pair-level 90% interval coverage 94.7% (600 forecasts), mean bias -0.18, and site-level coverage 18 of 20.

## Run it

```
node scripts/generate.mjs        # regenerate data (seeded)
node --test test/readiness.test.mjs
node scripts/coverage.mjs 20     # calibration report
python3 -m http.server           # then open http://localhost:8000
```

Tests (8, `node --test`): hand-computed Chao2 and extrapolation values, monotonicity and the days-to-ready definition, near-unbiasedness and interval coverage on iid assemblages, site-level coverage on the non-iid plant simulator across seeds, group-rule and widening-cost consistency, recommendation ordering, a clean learning/truth split, and calibration of the backtest on the shipped data.

## Honest limitations

- **Cycles longer than the learning window are invisible.** A quarterly calibration that did not happen during the 42 days leaves no singleton behind, so no traffic-only estimator can predict it. The fix is to feed maintenance calendars (CMMS integrations already exist in xDome) into the same model. In the simulator, the quarterly and bursty vendor pairs are where the intervals miss most often.
- **New devices break stationarity.** A device commissioned after the report date creates conversations the estimator cannot anticipate; this should pair with xDome's new-device alerts.
- Thresholds (0.5 expected conversations, 21/60 day limits, impact levels) are illustrative defaults, not tuned on real customer data.
- The bootstrap's detection-probability adjustment is a simplified version of the Chao et al. (2014) assemblage. Calibration is checked empirically (above), not proven.
- The "Sim. Truth" column and gray dots exist only because the data is synthetic.
- The UI recreates the look of xDome from public product-tour screenshots; icons are Tabler and the charts are hand-drawn SVG.

## Novelty note

I checked Claroty's network-protection pages, product descriptions (xDome Industrial, Apr 2026), integration briefs, blog and recent launches (Visibility Orchestration, Apr 2026; Device Purpose and Risk Benchmarking, Jun 2025), as well as competitors (Forescout eyeSegment, Elisity, Zero Networks, Illumio Policy Generator). All of them offer simulating policies against **observed** traffic, monitor mode, or a fixed learning period. I did not find any public product that estimates the volume of **not-yet-observed** legitimate traffic or gives a calibrated readiness forecast per zone pair. The underlying statistics (species-richness estimation) are classical; applying them to segmentation readiness is the new part.

## References

- Chao, A. (1987). Estimating the population size for capture-recapture data with unequal catchability. *Biometrics*.
- Shen, T.-J., Chao, A., & Lin, C.-F. (2003). Predicting the number of new species in further taxonomic sampling. *Ecology*.
- Chao, A., & Jost, L. (2012). Coverage-based rarefaction and extrapolation. *Ecology*.
- Chao, A., Gotelli, N. J., et al. (2014). Rarefaction and extrapolation with Hill numbers. *Ecological Monographs*.
