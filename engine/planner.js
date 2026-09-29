// JARVIS DIVE — Planificateur de plongée OC multi-gaz (Bühlmann ZHL-16C + GF).
// Conventions :
//  - bottomTime inclut la descente (temps entre le départ de la surface et le début de la remontée) ;
//  - paliers par pas de 3 m, durées entières en minutes, temps de remontée entre paliers non inclus ;
//  - GF bas ancré au premier palier (méthode Baker), interpolation linéaire jusqu'à GF haut en surface ;
//  - switch libre : chaque gaz de déco est pris dès que la profondeur ≤ sa profondeur de switch.

import { createEnvironment, Tissues, loadSegment, ceilingPressure } from './zhl16c.js';
import { makeGas, ppO2, mod, end, density } from './gases.js';
import { oxygenExposure } from './oxygen.js';
import { DiveError } from './errors.js';

export const DEFAULTS = Object.freeze({
  gfLow: 85,
  gfHigh: 85,
  descentRate: 18,        // m/min
  ascentRate: 9,          // m/min
  ascentRateShallow: null, // m/min au-dessus de shallowDepth (null = ascentRate)
  shallowDepth: 6,
  stopStep: 3,
  lastStop: 3,            // 3 ou 6 m
  switchStopMin: 1,       // minutes minimales au palier de changement de gaz
  ppO2Bottom: 1.4,
  ppO2Deco: 1.6,
  ppO2Tolerance: 0.03,    // arrondi admis (O2 à 6 m en eau de mer = 1.62 bar)
  sacBottom: 20,          // L/min en surface
  sacDeco: 15,
  surfacePressure: 1.01325,
  waterDensity: 1.03,
  o2Narcotic: true,
  maxDecoMinutes: 1000,
  // Blocs et réserves
  reservePressure: 50,     // bar restants minimum par bloc
  minGasDivers: 2,         // gaz minimum : remontée à 2 sur le gaz fond
  minGasStressFactor: 2,   // SAC fond multiplié en situation de stress
  minGasProblemMin: 1,     // minutes de résolution du problème au fond
  // Plongée successive
  initialTissues: null,    // état des tissus en début de plongée (sinon saturation air en surface)
  initialCns: 0,
  initialOtu: 0,
});

const EPS = 1e-9;

/**
 * Planifie une plongée carrée.
 * @param {object} input { depth, bottomTime, gases: [fond, déco...], ...réglages }
 */
export function planDive(input) {
  const cfg = { ...DEFAULTS, ...input };
  const env = createEnvironment(cfg);
  const gfLow = cfg.gfLow / 100;
  const gfHigh = cfg.gfHigh / 100;
  const rateShallow = cfg.ascentRateShallow || cfg.ascentRate;

  if (!(cfg.depth > 0)) throw new DiveError('INVALID_DEPTH', {}, 'Profondeur invalide');
  if (!(cfg.bottomTime > 0)) throw new DiveError('INVALID_TIME', {}, 'Temps fond invalide');
  if (!cfg.gases || cfg.gases.length === 0) throw new DiveError('NO_GAS', {}, 'Au moins un gaz est requis');
  if (gfLow <= 0 || gfHigh <= 0 || gfLow > gfHigh || gfHigh > 1) throw new DiveError('INVALID_GF', {}, 'Gradient factors invalides');

  const gases = cfg.gases.map((g, i) => {
    const gas = g.o2 !== undefined && g.n2 !== undefined ? { ...g } : { ...makeGas(g), volume: g.volume, startPressure: g.startPressure };
    if (i === 0) gas.switchDepth = null;
    return gas;
  });

  const warnings = [];
  const segments = [];
  const tissues = cfg.initialTissues ? new Tissues(env, cfg.initialTissues) : new Tissues(env);
  const gasUse = gases.map(() => 0);
  let runtime = 0;
  let cns = cfg.initialCns || 0;
  let otu = cfg.initialOtu || 0;
  let maxPpO2 = 0;

  function addSegment(kind, from, to, minutes, gi) {
    if (minutes <= EPS) return;
    const gas = gases[gi];
    loadSegment(tissues, env, from, to, minutes, gas);
    const ox = oxygenExposure(ppO2(gas, from, env), ppO2(gas, to, env), minutes);
    cns += ox.cns;
    otu += ox.otu;
    maxPpO2 = Math.max(maxPpO2, ppO2(gas, from, env), ppO2(gas, to, env));
    const sac = kind === 'descent' || kind === 'bottom' ? cfg.sacBottom : cfg.sacDeco;
    gasUse[gi] += sac * env.pressure((from + to) / 2) * minutes;
    runtime += minutes;
    const last = segments[segments.length - 1];
    if (last && last.kind === kind && kind === 'stop' && last.from === from && last.gasIndex === gi) {
      last.duration += minutes;
      last.runtime = runtime;
    } else {
      segments.push({ kind, from, to, duration: minutes, runtime, gasIndex: gi, gas: gas.name });
    }
  }

  // Temps de remontée entre deux profondeurs (vitesse réduite près de la surface).
  function travelParts(from, to) {
    const parts = [];
    if (from > cfg.shallowDepth && to < cfg.shallowDepth) {
      parts.push([from, cfg.shallowDepth, (from - cfg.shallowDepth) / cfg.ascentRate]);
      parts.push([cfg.shallowDepth, to, (cfg.shallowDepth - to) / rateShallow]);
    } else {
      const rate = from <= cfg.shallowDepth + EPS ? rateShallow : cfg.ascentRate;
      parts.push([from, to, (from - to) / rate]);
    }
    return parts;
  }

  // ---------- Descente + fond ----------
  const bottomGas = gases[0];
  const descentTime = cfg.depth / cfg.descentRate;
  if (descentTime > cfg.bottomTime + EPS) {
    throw new DiveError('DESCENT_TOO_LONG', { bottomTime: cfg.bottomTime, descent: descentTime },
      `Temps fond (${cfg.bottomTime} min) inférieur au temps de descente (${descentTime.toFixed(1)} min)`);
  }
  addSegment('descent', 0, cfg.depth, descentTime, 0);
  addSegment('bottom', cfg.depth, cfg.depth, cfg.bottomTime - descentTime, 0);
  const bottomEndRuntime = runtime;
  const bottomEndSegmentIndex = segments.length;
  const bottomGasUsedAtBottomEnd = gasUse[0];

  // NDL restant à la fin du fond (remontée directe tolérée à GF haut).
  const ndl = computeNdl(tissues, env, cfg.depth, bottomGas, gfHigh);

  // Contrôles gaz
  const ppBottom = ppO2(bottomGas, cfg.depth, env);
  if (ppBottom > cfg.ppO2Bottom + EPS) {
    warnings.push({ level: ppBottom > 1.6 ? 'danger' : 'warn', code: 'PPO2_BOTTOM',
      params: { pp: ppBottom, max: cfg.ppO2Bottom, gas: bottomGas.name, mod: mod(bottomGas, cfg.ppO2Bottom, env) },
      message: `ppO2 fond ${ppBottom.toFixed(2)} bar > ${cfg.ppO2Bottom} (MOD ${bottomGas.name} : ${mod(bottomGas, cfg.ppO2Bottom, env).toFixed(1)} m)` });
  }
  const endBottom = end(bottomGas, cfg.depth, env, { o2Narcotic: cfg.o2Narcotic });
  if (endBottom > 30 + EPS) {
    warnings.push({ level: endBottom > 40 ? 'warn' : 'info', code: 'END',
      params: { end: endBottom, gas: bottomGas.name },
      message: `END ${endBottom.toFixed(0)} m (narcose) avec ${bottomGas.name}` });
  }
  const rho = density(bottomGas, cfg.depth, env);
  if (rho > 5.2) {
    warnings.push({ level: 'warn', code: 'DENSITY',
      params: { rho },
      message: `Densité du gaz ${rho.toFixed(1)} g/L au fond (recommandé ≤ 5.2, max 6.2)` });
  }
  gases.slice(1).forEach((g) => {
    if (g.switchDepth == null) return;
    const pp = ppO2(g, g.switchDepth, env);
    if (pp > cfg.ppO2Deco + cfg.ppO2Tolerance) {
      warnings.push({ level: 'danger', code: 'PPO2_SWITCH',
        params: { gas: g.name, depth: g.switchDepth, pp, max: cfg.ppO2Deco, mod: mod(g, cfg.ppO2Deco, env) },
        message: `${g.name} au switch ${g.switchDepth} m : ppO2 ${pp.toFixed(2)} bar > ${cfg.ppO2Deco} (MOD ${mod(g, cfg.ppO2Deco, env).toFixed(1)} m)` });
    }
  });

  // ---------- Remontée ----------
  let depth = cfg.depth;
  let gi = 0;
  let firstStop = null;

  const gfAt = (d) => {
    if (firstStop === null) return gfLow;
    if (firstStop <= 0) return gfHigh;
    const gf = gfHigh - ((gfHigh - gfLow) * d) / firstStop;
    return Math.max(gfLow, Math.min(gfHigh, gf));
  };

  const bestGasAt = (d) => {
    let best = gi;
    gases.forEach((g, i) => {
      if (i === 0 || g.switchDepth == null) return;
      if (d <= g.switchDepth + EPS && g.o2 > gases[best].o2 + EPS) best = i;
    });
    return best;
  };

  const nextTarget = (d) => {
    let t = Math.ceil(d / cfg.stopStep - EPS) * cfg.stopStep - cfg.stopStep;
    if (t < cfg.lastStop - EPS) t = 0;
    // Point de switch intermédiaire (switch libre non multiple du pas)
    gases.forEach((g, i) => {
      if (i === 0 || g.switchDepth == null) return;
      if (g.switchDepth < d - EPS && g.switchDepth > t + EPS && g.o2 > gases[gi].o2 + EPS) t = g.switchDepth;
    });
    return Math.max(0, t);
  };

  let decoMinutes = 0;
  let guard = 0;
  while (depth > EPS) {
    if (++guard > 100000) throw new DiveError('NO_CONVERGENCE', {}, 'Boucle de remontée non convergente');
    const target = nextTarget(depth);
    const trial = tissues.clone();
    for (const [a, b, t] of travelParts(depth, target)) loadSegment(trial, env, a, b, t, gases[gi]);
    const ceil = env.depth(ceilingPressure(trial, gfAt(target)).pressure);

    if (ceil <= target + EPS) {
      for (const [a, b, t] of travelParts(depth, target)) addSegment('ascent', a, b, t, gi);
      depth = target;
      if (depth > EPS) {
        const best = bestGasAt(depth);
        if (best !== gi) {
          gi = best;
          segments.push({ kind: 'switch', from: depth, to: depth, duration: 0, runtime, gasIndex: gi, gas: gases[gi].name });
          if (cfg.switchStopMin > 0) {
            addSegment('stop', depth, depth, cfg.switchStopMin, gi);
            decoMinutes += cfg.switchStopMin;
          }
        }
      }
      continue;
    }

    if (firstStop === null) {
      // Premier palier trouvé : on fixe la pente GF et on réévalue sans ajouter de temps.
      firstStop = depth;
      continue;
    }
    addSegment('stop', depth, depth, 1, gi);
    decoMinutes += 1;
    if (decoMinutes > cfg.maxDecoMinutes) throw new DiveError('EXCESSIVE_DECO', {}, 'Décompression excessive : plan abandonné');
  }

  // ---------- Synthèse ----------
  const stops = segments
    .filter((s) => s.kind === 'stop')
    .map((s) => ({ depth: s.from, duration: s.duration, runtime: s.runtime, gas: s.gas }));

  if (cns > 100) warnings.push({ level: 'danger', code: 'CNS', params: { cns, limit: 100 }, message: `CNS ${cns.toFixed(0)} % > 100 %` });
  else if (cns > 80) warnings.push({ level: 'warn', code: 'CNS', params: { cns, limit: 80 }, message: `CNS ${cns.toFixed(0)} % > 80 %` });
  if (maxPpO2 > 1.6 + cfg.ppO2Tolerance) warnings.push({ level: 'danger', code: 'PPO2_MAX', params: { pp: maxPpO2 }, message: `ppO2 max ${maxPpO2.toFixed(2)} bar` });

  // ---------- Gaz minimum (rock bottom) sur le gaz fond ----------
  // Remontée à plusieurs plongeurs, SAC de stress, depuis la fin du fond jusqu'au premier switch (ou la surface).
  let exposure = env.pressure(cfg.depth) * cfg.minGasProblemMin; // bar·min
  for (let k = bottomEndSegmentIndex; k < segments.length; k++) {
    const s = segments[k];
    if (s.kind === 'switch') break;
    exposure += env.pressure((s.from + s.to) / 2) * s.duration;
  }
  const minGasLiters = cfg.minGasDivers * cfg.sacBottom * cfg.minGasStressFactor * exposure;

  // ---------- Pressions des blocs ----------
  const gasesOut = gases.map((g, i) => {
    const out = { ...g, liters: Math.round(gasUse[i]) };
    if (g.volume > 0 && g.startPressure > 0) {
      out.endPressure = g.startPressure - gasUse[i] / g.volume;
      if (out.endPressure < cfg.reservePressure) {
        warnings.push({ level: 'danger', code: 'RESERVE',
          params: { gas: g.name, pressure: Math.max(0, out.endPressure), reserve: cfg.reservePressure },
          message: `${g.name} : ${Math.max(0, out.endPressure).toFixed(0)} bar restants < ${cfg.reservePressure} bar` });
      }
    }
    return out;
  });
  const minGas = { liters: Math.round(minGasLiters), bar: null, pressureAtBottomEnd: null, ok: null };
  const bg = gases[0];
  if (bg.volume > 0 && bg.startPressure > 0) {
    minGas.bar = minGasLiters / bg.volume;
    minGas.pressureAtBottomEnd = bg.startPressure - bottomGasUsedAtBottomEnd / bg.volume;
    minGas.ok = minGas.pressureAtBottomEnd >= minGas.bar - EPS;
    if (!minGas.ok) {
      warnings.push({ level: 'danger', code: 'MIN_GAS',
        params: { gas: bg.name, pressure: Math.max(0, minGas.pressureAtBottomEnd), minGas: minGas.bar },
        message: `${bg.name} en fin de fond : ${minGas.pressureAtBottomEnd.toFixed(0)} bar < gaz minimum ${minGas.bar.toFixed(0)} bar` });
    }
  }

  return {
    input: { depth: cfg.depth, bottomTime: cfg.bottomTime, gfLow: cfg.gfLow, gfHigh: cfg.gfHigh, lastStop: cfg.lastStop },
    gases: gasesOut,
    minGas,
    segments,
    stops,
    firstStop: stops.length ? stops[0].depth : null,
    gfAnchorDepth: firstStop,
    bottomEndRuntime,
    tts: runtime - bottomEndRuntime,
    decoTime: stops.reduce((s, x) => s + x.duration, 0),
    runtime,
    ndl,
    cns,
    otu,
    cnsDive: cns - (cfg.initialCns || 0),
    otuDive: otu - (cfg.initialOtu || 0),
    repetitive: !!cfg.initialTissues,
    maxPpO2,
    endBottom,
    densityBottom: rho,
    warnings,
    tissuesAtSurface: tissues,
  };
}

/** NDL restant (min, max 999) à une profondeur donnée avec l'état de tissus fourni. */
export function computeNdl(tissues, env, depth, gas, gfHigh) {
  const t = tissues.clone();
  const canSurface = () => ceilingPressure(t, gfHigh).pressure <= env.surfacePressure + EPS;
  if (!canSurface()) return 0;
  for (let m = 0; m < 999; m++) {
    loadSegment(t, env, depth, depth, 1, gas);
    if (!canSurface()) return m;
  }
  return 999;
}
