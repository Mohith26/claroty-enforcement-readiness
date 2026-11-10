// Seeded synthetic plant network. Generates daily conversation incidences per zone pair
// for a learning window plus a future window (ground truth for the simulation check).
// Conversation behaviour is deliberately NOT the iid model the estimator assumes:
// steady polling, long-tail maintenance traffic, weekly backups, monthly jobs,
// quarterly calibrations and bursty vendor sessions.
import { mulberry32 } from './readiness.js';

export const ZONES = [
  { id: 'PL1', impact: 'High', name: 'Production Line 1', net: '10.20.11', groups: [['PLC', 18], ['HMI', 6], ['RIO', 22], ['DRV', 10]] },
  { id: 'PL2', impact: 'High', name: 'Production Line 2', net: '10.20.12', groups: [['PLC', 22], ['HMI', 8], ['RIO', 26], ['DRV', 12]] },
  { id: 'BC', impact: 'Medium', name: 'Building Controllers', net: '10.30.4', groups: [['BAC', 34]] },
  { id: 'PRN', impact: 'Low', name: 'Printers', net: '10.40.8', groups: [['PRN', 41]] },
  { id: 'CAM', impact: 'Low', name: 'IoT Cameras', net: '10.50.2', groups: [['CAM', 96]] },
  { id: 'SRV', impact: 'Medium', name: 'Servers', net: '10.10.5', groups: [['SRV', 28]] },
  { id: 'SCADA', impact: 'High', name: 'SCADA', net: '10.20.2', groups: [['SCS', 4], ['OPS', 6]] },
  { id: 'FIRE', impact: 'High', name: 'Fire Protection Sys.', net: '10.30.9', groups: [['FAP', 9]] },
  { id: 'EWS', impact: 'High', name: 'Engineering Workstations', net: '10.20.3', groups: [['EWS', 14]] },
  { id: 'HIST', impact: 'Medium', name: 'Historian', net: '10.20.4', groups: [['HIS', 3]] },
  { id: 'DMZ', impact: 'Medium', name: 'Remote Access DMZ', net: '10.99.1', groups: [['JMP', 5]] },
  { id: 'CORP', impact: 'Low', name: 'Corporate IT', net: '10.60.0', groups: [['WKS', 310]] },
];

export const SERVICES = [
  ['EtherNet/IP', 'TCP', 44818], ['CIP Implicit', 'UDP', 2222], ['S7comm', 'TCP', 102], ['Modbus/TCP', 'TCP', 502],
  ['OPC UA', 'TCP', 4840], ['BACnet/IP', 'UDP', 47808], ['RDP', 'TCP', 3389], ['SMB', 'TCP', 445],
  ['HTTPS', 'TCP', 443], ['HTTP', 'TCP', 80], ['RTSP', 'TCP', 554], ['SNMP', 'UDP', 161],
  ['IPP', 'TCP', 631], ['RAW Print', 'TCP', 9100], ['WSUS', 'TCP', 8530], ['SSH', 'TCP', 22],
  ['MQTT', 'TCP', 8883], ['SMTP', 'TCP', 25], ['FactoryTalk', 'TCP', 49281], ['VNC', 'TCP', 5900],
].map(([name, proto, port], id) => ({ id, name, proto, port }));
export const INTERACTIVE = new Set(['EWS', 'DMZ', 'CORP']);
const S = Object.fromEntries(SERVICES.map((s) => [s.name, s.id]));

// Each zone-pair recipe: list of components {svc, srcGroups, dstGroups, kind, n, rate}
//  kind: steady (daily p ~ high), tail (lognormal rare rates), weekly, monthly, quarterly, burst
export const PAIR_RECIPES = [
  ['SCADA', 'PL1', [{ svc: 'EtherNet/IP', src: ['SCS'], dst: ['PLC'], kind: 'steady', n: 64 }, { svc: 'CIP Implicit', src: ['SCS'], dst: ['RIO'], kind: 'steady', n: 40 }, { svc: 'HTTP', src: ['OPS'], dst: ['HMI'], kind: 'steady', n: 18 }]],
  ['SCADA', 'PL2', [{ svc: 'EtherNet/IP', src: ['SCS'], dst: ['PLC'], kind: 'steady', n: 80 }, { svc: 'CIP Implicit', src: ['SCS'], dst: ['RIO'], kind: 'steady', n: 46 }, { svc: 'HTTP', src: ['OPS'], dst: ['HMI'], kind: 'tail', n: 26, mu: -2.4, sd: 0.8 }]],
  ['EWS', 'PL1', [{ svc: 'EtherNet/IP', src: ['EWS'], dst: ['PLC'], kind: 'tail', n: 120, mu: -3.6, sd: 0.9 }, { svc: 'FactoryTalk', src: ['EWS'], dst: ['HMI'], kind: 'tail', n: 40, mu: -3.3, sd: 0.8 }, { svc: 'VNC', src: ['EWS'], dst: ['HMI'], kind: 'steady', n: 6, p: 0.45 }]],
  ['EWS', 'PL2', [{ svc: 'S7comm', src: ['EWS'], dst: ['PLC'], kind: 'tail', n: 150, mu: -3.7, sd: 0.9 }, { svc: 'Modbus/TCP', src: ['EWS'], dst: ['DRV'], kind: 'tail', n: 60, mu: -3.8, sd: 0.8 }, { svc: 'VNC', src: ['EWS'], dst: ['HMI'], kind: 'steady', n: 8, p: 0.5 }]],
  ['EWS', 'SCADA', [{ svc: 'RDP', src: ['EWS'], dst: ['SCS'], kind: 'tail', n: 30, mu: -2.1, sd: 0.9 }, { svc: 'SMB', src: ['EWS'], dst: ['SCS'], kind: 'monthly', n: 4 }]],
  ['EWS', 'BC', [{ svc: 'BACnet/IP', src: ['EWS'], dst: ['BAC'], kind: 'tail', n: 34, mu: -3.0, sd: 1.0 }]],
  ['EWS', 'FIRE', [{ svc: 'HTTPS', src: ['EWS'], dst: ['FAP'], kind: 'quarterly', n: 9 }, { svc: 'SSH', src: ['EWS'], dst: ['FAP'], kind: 'tail', n: 6, mu: -3.4, sd: 0.6 }]],
  ['SCADA', 'HIST', [{ svc: 'OPC UA', src: ['SCS'], dst: ['HIS'], kind: 'steady', n: 12 }]],
  ['HIST', 'SCADA', [{ svc: 'OPC UA', src: ['HIS'], dst: ['SCS'], kind: 'steady', n: 12 }]],
  ['PL1', 'HIST', [{ svc: 'MQTT', src: ['PLC'], dst: ['HIS'], kind: 'steady', n: 18 }]],
  ['PL2', 'HIST', [{ svc: 'MQTT', src: ['PLC'], dst: ['HIS'], kind: 'steady', n: 22 }, { svc: 'OPC UA', src: ['HMI'], dst: ['HIS'], kind: 'weekly', n: 8 }]],
  ['SRV', 'HIST', [{ svc: 'SMB', src: ['SRV'], dst: ['HIS'], kind: 'weekly', n: 6 }, { svc: 'HTTPS', src: ['SRV'], dst: ['HIS'], kind: 'steady', n: 10, p: 0.7 }]],
  ['SRV', 'EWS', [{ svc: 'WSUS', src: ['SRV'], dst: ['EWS'], kind: 'weekly', n: 14 }, { svc: 'SMB', src: ['SRV'], dst: ['EWS'], kind: 'tail', n: 20, mu: -2.6, sd: 0.8 }]],
  ['SRV', 'PL2', [{ svc: 'OPC UA', src: ['SRV'], dst: ['PLC'], kind: 'steady', n: 22, p: 0.92 }, { svc: 'EtherNet/IP', src: ['SRV'], dst: ['PLC'], kind: 'monthly', n: 8 }]],
  ['SRV', 'CAM', [{ svc: 'RTSP', src: ['SRV'], dst: ['CAM'], kind: 'steady', n: 96 }]],
  ['CAM', 'SRV', [{ svc: 'HTTPS', src: ['CAM'], dst: ['SRV'], kind: 'steady', n: 96, p: 0.9 }]],
  ['BC', 'SRV', [{ svc: 'BACnet/IP', src: ['BAC'], dst: ['SRV'], kind: 'steady', n: 34 }]],
  ['PRN', 'SRV', [{ svc: 'SNMP', src: ['PRN'], dst: ['SRV'], kind: 'steady', n: 41, p: 0.85 }, { svc: 'SMTP', src: ['PRN'], dst: ['SRV'], kind: 'tail', n: 12, mu: -2.2, sd: 0.7 }]],
  ['CORP', 'PRN', [{ svc: 'IPP', src: ['WKS'], dst: ['PRN'], kind: 'tail', n: 260, mu: -3.4, sd: 1.1 }, { svc: 'RAW Print', src: ['WKS'], dst: ['PRN'], kind: 'tail', n: 120, mu: -3.6, sd: 1.0 }]],
  ['CORP', 'SRV', [{ svc: 'HTTPS', src: ['WKS'], dst: ['SRV'], kind: 'tail', n: 220, mu: -1.1, sd: 0.9 }, { svc: 'SMB', src: ['WKS'], dst: ['SRV'], kind: 'tail', n: 140, mu: -1.6, sd: 1.0 }, { svc: 'RDP', src: ['WKS'], dst: ['SRV'], kind: 'tail', n: 40, mu: -3.2, sd: 1.0 }]],
  ['CORP', 'DMZ', [{ svc: 'RDP', src: ['WKS'], dst: ['JMP'], kind: 'tail', n: 70, mu: -2.6, sd: 1.0 }]],
  ['DMZ', 'EWS', [{ svc: 'RDP', src: ['JMP'], dst: ['EWS'], kind: 'burst', n: 50, mu: -4.0, sd: 0.8 }, { svc: 'SSH', src: ['JMP'], dst: ['EWS'], kind: 'burst', n: 12, mu: -4.2, sd: 0.6 }]],
  ['DMZ', 'SCADA', [{ svc: 'RDP', src: ['JMP'], dst: ['OPS'], kind: 'burst', n: 22, mu: -3.6, sd: 0.7 }]],
  ['FIRE', 'BC', [{ svc: 'BACnet/IP', src: ['FAP'], dst: ['BAC'], kind: 'steady', n: 18 }, { svc: 'BACnet/IP', src: ['FAP'], dst: ['BAC'], kind: 'tail', n: 14, mu: -3.0, sd: 0.7, offset: 18 }]],
  ['FIRE', 'SRV', [{ svc: 'SMTP', src: ['FAP'], dst: ['SRV'], kind: 'tail', n: 9, mu: -2.0, sd: 0.6 }, { svc: 'SNMP', src: ['FAP'], dst: ['SRV'], kind: 'steady', n: 9 }]],
  ['SRV', 'BC', [{ svc: 'BACnet/IP', src: ['SRV'], dst: ['BAC'], kind: 'steady', n: 34 }, { svc: 'HTTPS', src: ['SRV'], dst: ['BAC'], kind: 'tail', n: 34, mu: -2.9, sd: 0.8 }]],
  ['SCADA', 'BC', [{ svc: 'BACnet/IP', src: ['OPS'], dst: ['BAC'], kind: 'tail', n: 18, mu: -1.4, sd: 0.6 }]],
  ['PL1', 'PL2', [{ svc: 'CIP Implicit', src: ['PLC'], dst: ['PLC'], kind: 'steady', n: 6 }, { svc: 'EtherNet/IP', src: ['PLC'], dst: ['PLC'], kind: 'tail', n: 8, mu: -2.6, sd: 0.5 }]],
  ['SRV', 'SCADA', [{ svc: 'HTTPS', src: ['SRV'], dst: ['SCS'], kind: 'steady', n: 8 }, { svc: 'SMB', src: ['SRV'], dst: ['SCS'], kind: 'weekly', n: 4 }]],
  ['CORP', 'HIST', [{ svc: 'HTTPS', src: ['WKS'], dst: ['HIS'], kind: 'tail', n: 90, mu: -2.3, sd: 1.0 }]],
];

function gauss(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function buildDevices(rng) {
  return ZONES.map((z) => {
    const devices = [];
    let host = 10;
    for (const [g, n] of z.groups) {
      for (let i = 1; i <= n; i++) {
        devices.push({ name: `${z.id}-${g}-${String(i).padStart(2, '0')}`, ip: `${z.net}.${host++}`, group: g });
      }
    }
    return { id: z.id, name: z.name, impact: z.impact, devices };
  });
}

// Simulate days [0, totalDays). Returns per-pair types with all occurrence days.
export function simulateSite(seed = 20261102, totalDays = 72) {
  const rng = mulberry32(seed);
  const zones = buildDevices(rng);
  const zIdx = Object.fromEntries(zones.map((z, i) => [z.id, i]));
  const pairs = PAIR_RECIPES.map(([src, dst, comps]) => {
    const zs = zones[zIdx[src]], zd = zones[zIdx[dst]];
    const types = [];
    const used = new Set();
    const groups = [], groupSizes = [], gIndex = new Map();
    for (const c of comps) {
      const sIdx = zs.devices.map((d, i) => (c.src.includes(d.group) ? i : -1)).filter((i) => i >= 0);
      const dIdx = zd.devices.map((d, i) => (c.dst.includes(d.group) ? i : -1)).filter((i) => i >= 0);
      let made = 0, guard = 0;
      while (made < c.n && guard++ < c.n * 50) {
        const a = sIdx[Math.floor(rng() * sIdx.length)], b = dIdx[Math.floor(rng() * dIdx.length)];
        if (src === dst && a === b) continue;
        const key = `${a}|${b}|${S[c.svc]}`;
        if (used.has(key)) continue;
        used.add(key);
        made++;
        const days = [];
        const kind = c.kind;
        if (kind === 'steady') {
          const p = c.p ?? 0.97 + 0.03 * rng();
          for (let d = 0; d < totalDays; d++) if (rng() < p) days.push(d);
        } else if (kind === 'tail') {
          const p = Math.min(0.9, Math.exp(c.mu + c.sd * gauss(rng)));
          for (let d = 0; d < totalDays; d++) if (rng() < p) days.push(d);
        } else if (kind === 'weekly') {
          const dow = Math.floor(rng() * 7);
          for (let d = 0; d < totalDays; d++) if (d % 7 === dow && rng() < 0.95) days.push(d);
        } else if (kind === 'monthly') {
          const dom = Math.floor(rng() * 30);
          for (let d = 0; d < totalDays; d++) if (d % 30 === dom && rng() < 0.9) days.push(d);
        } else if (kind === 'quarterly') {
          const phase = Math.floor(rng() * 91);
          for (let d = 0; d < totalDays; d++) if (d % 91 === phase) days.push(d);
        } else if (kind === 'burst') {
          // vendor sessions: rare days, but a session day repeats 1-3 following days
          const p = Math.min(0.5, Math.exp(c.mu + c.sd * gauss(rng)));
          for (let d = 0; d < totalDays; d++) {
            if (rng() < p) {
              const len = 1 + Math.floor(rng() * 3);
              for (let k = 0; k < len && d + k < totalDays; k++) days.push(d + k);
              d += len;
            }
          }
        }
        const gk = `${zs.devices[a].group}>${zd.devices[b].group}|${S[c.svc]}`;
        if (!gIndex.has(gk)) {
          gIndex.set(gk, groups.length);
          groups.push({ src: zs.devices[a].group, dst: zd.devices[b].group, svc: S[c.svc] });
          groupSizes.push(sIdx.filter((i) => zs.devices[i].group === zs.devices[a].group).length * dIdx.filter((i) => zd.devices[i].group === zd.devices[b].group).length);
        }
        if (days.length) types.push([a, b, S[c.svc], days, gIndex.get(gk)]);
      }
    }
    return { id: `${src}>${dst}`, src, dst, types, groups, groupSizes, dstImpact: zd.impact, interactiveSrc: INTERACTIVE.has(src) };
  });
  return { zones, pairs };
}

// Split a simulated site into the learning view (days < T) and the future truth.
export function splitSite(sim, T) {
  const learn = [], truth = [];
  for (const p of sim.pairs) {
    const lt = [], ft = [];
    for (const ty of p.types) {
      const past = ty[3].filter((d) => d < T);
      if (past.length) lt.push([ty[0], ty[1], ty[2], past, ty[4]]);
      else {
        const first = ty[3].find((d) => d >= T);
        if (first !== undefined) ft.push([ty[0], ty[1], ty[2], first, ty[4]]);
      }
    }
    learn.push({ id: p.id, src: p.src, dst: p.dst, types: lt, groups: p.groups, groupSizes: p.groupSizes, dstImpact: p.dstImpact, interactiveSrc: p.interactiveSrc });
    truth.push({ id: p.id, newTypes: ft });
  }
  return { learn, truth };
}
