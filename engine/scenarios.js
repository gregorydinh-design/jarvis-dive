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
