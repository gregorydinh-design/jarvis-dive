// JARVIS DIVE — Scénarios : plans de secours, perte de gaz, plongées successives.
import { createEnvironment, Tissues, loadSegment } from './zhl16c.js';
import { planDive, DEFAULTS } from './planner.js';

const AIR = { o2: 0.21, he: 0 };
export const CNS_HALF_TIME = 90; // min, élimination du CNS en surface

/** État des tissus après un intervalle de surface à l'air. */
export function surfaceInterval(tissues, env, minutes) {
  const t = new Tissues(env, tissues);
  if (minutes > 0) loadSegment(t, env, 0, 0, minutes, AIR);
  return t;
}

export function cnsAfterInterval(cns, minutes) {
  return cns * Math.pow(0.5, Math.max(0, minutes) / CNS_HALF_TIME);
}

/**
 * Prépare l'entrée d'une plongée successive : rejoue la plongée précédente,
 * applique l'intervalle de surface, et renvoie l'entrée enrichie des tissus / CNS / OTU.
 */
export function withPreviousDive(input, previousInput, intervalMin) {
  const prev = planDive(previousInput);
  const env = createEnvironment({ ...DEFAULTS, ...input });
  return {
    input: {
      ...input,
      initialTissues: surfaceInterval(prev.tissuesAtSurface, env, intervalMin),
      initialCns: cnsAfterInterval(prev.cns, intervalMin),
      initialOtu: prev.otu,
    },
    previous: prev,
  };
}

function tryPlan(key, extra, input) {
  try {
    return { key, ...extra, plan: planDive(input) };
  } catch (error) {
    return { key, ...extra, error };
  }
}

/**
 * Plans de secours : +5 min, +3 m, les deux, puis la perte de chaque gaz de déco.
 */
export function contingencyPlans(input, { extraTime = 5, extraDepth = 3 } = {}) {
  const out = [
    tryPlan('PLUS_TIME', { extraTime }, { ...input, bottomTime: input.bottomTime + extraTime }),
    tryPlan('PLUS_DEPTH', { extraDepth }, { ...input, depth: input.depth + extraDepth }),
    tryPlan('PLUS_BOTH', { extraTime, extraDepth }, { ...input, depth: input.depth + extraDepth, bottomTime: input.bottomTime + extraTime }),
  ];
  input.gases.forEach((g, i) => {
    if (i === 0) return;
    out.push(tryPlan('LOST_GAS', { gas: g.name }, { ...input, gases: input.gases.filter((_, j) => j !== i) }));
  });
  return out;
}

/**
 * Temps fond maximum (minutes entières) :
 *  - byRuntime : pour respecter la limite de runtime du DP (si définie) ;
 *  - byGas : sans passer sous le gaz minimum ni sous la réserve d'un bloc (si les blocs sont renseignés).
 * max = le plus petit des deux ; limitedBy = 'runtime' | 'gas' | null.
 */
export function maxBottomTime(input, { upTo = 180 } = {}) {
  const minT = Math.ceil(input.depth / (input.descentRate || DEFAULTS.descentRate));
  let byRuntime = null;
  let byGas = null;
  const hasLimit = input.runtimeLimit > 0;
  const hasCyl = input.gases.every((g) => g.volume > 0 && g.startPressure > 0);
  if (!hasLimit && !hasCyl) return { byRuntime, byGas, max: null, limitedBy: null };
  let runtimeOpen = hasLimit;
  let gasOpen = hasCyl;
  for (let t = minT; t <= upTo && (runtimeOpen || gasOpen); t++) {
    let p;
    try { p = planDive({ ...input, bottomTime: t }); } catch { break; }
    if (runtimeOpen) { if (p.runtime <= input.runtimeLimit + 1e-9) byRuntime = t; else runtimeOpen = false; }
    if (gasOpen) {
      const gasBad = p.warnings.some((w) => w.code === 'RESERVE' || w.code === 'MIN_GAS');
      if (!gasBad) byGas = t; else gasOpen = false;
    }
  }
  const cands = [hasLimit ? byRuntime ?? 0 : null, hasCyl ? byGas ?? 0 : null].filter((x) => x !== null);
  const max = Math.min(...cands);
  const limitedBy = hasLimit && (byRuntime ?? 0) === max ? 'runtime' : 'gas';
  return { byRuntime, byGas, max, limitedBy };
}
