// Seeded data generator: node scripts/generate.mjs
// Writes data/site.json (what xDome would have after the learning window) and
// data/truth.json (conversations that first appear in the 30 days after the report date,
// used only for the clearly labeled simulation check).
import { writeFileSync, mkdirSync } from 'node:fs';
import { simulateSite, splitSite, SERVICES } from '../core/sim.js';

const SEED = 20261102;
const T = 42; // learning window: Mon Sep 21 - Sun Nov 1, 2026
const HORIZON = 30;
const sim = simulateSite(SEED, T + HORIZON);
const { learn, truth } = splitSite(sim, T);

const site = {
  meta: {
    seed: SEED,
    site: 'Greenville Assembly',
    siteGroup: 'North America Plants',
    learnStart: '2026-09-21',
    T,
    horizon: HORIZON,
    reportDate: '2026-11-02',
    generator: 'scripts/generate.mjs (core/sim.js)',
  },
  zones: sim.zones,
  services: SERVICES,
  pairs: learn,
};
mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../data/site.json', import.meta.url), JSON.stringify(site));
writeFileSync(new URL('../data/truth.json', import.meta.url), JSON.stringify({ seed: SEED, from: T, to: T + HORIZON, pairs: truth }));
const nTypes = learn.reduce((s, p) => s + p.types.length, 0);
const nNew = truth.reduce((s, p) => s + p.newTypes.length, 0);
console.log(`zones ${sim.zones.length}, devices ${sim.zones.reduce((s, z) => s + z.devices.length, 0)}, zone pairs ${learn.length}, observed types ${nTypes}, future new types ${nNew}`);
