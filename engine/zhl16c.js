// JARVIS DIVE — Modèle Bühlmann ZHL-16C avec Gradient Factors
// Moteur pur : aucune dépendance au DOM, aucun appel réseau.
// Toutes les pressions sont en bar absolus, les profondeurs en mètres, les temps en minutes.

// Coefficients ZHL-16C (compartiment 1 = 1b, 5 min), valeurs a en bar.
export const ZHL16C = Object.freeze({
  n2: {
    ht: [5.0, 8.0, 12.5, 18.5, 27.0, 38.3, 54.3, 77.0, 109.0, 146.0, 187.0, 239.0, 305.0, 390.0, 498.0, 635.0],
    a: [1.1696, 1.0, 0.8618, 0.7562, 0.62, 0.5043, 0.441, 0.4, 0.375, 0.35, 0.3295, 0.3065, 0.2835, 0.261, 0.248, 0.2327],
    b: [0.5578, 0.6514, 0.7222, 0.7825, 0.8126, 0.8434, 0.8693, 0.891, 0.9092, 0.9222, 0.9319, 0.9403, 0.9477, 0.9544, 0.9602, 0.9653],
  },
  he: {
    ht: [1.88, 3.02, 4.72, 6.99, 10.21, 14.48, 20.53, 29.11, 41.2, 55.19, 70.69, 90.34, 115.29, 147.42, 188.24, 240.03],
    a: [1.6189, 1.383, 1.1919, 1.0458, 0.922, 0.8205, 0.7305, 0.6502, 0.595, 0.5545, 0.5333, 0.5189, 0.5181, 0.5176, 0.5172, 0.5119],
    b: [0.477, 0.5747, 0.6527, 0.7223, 0.7582, 0.7957, 0.8279, 0.8553, 0.8757, 0.8903, 0.8997, 0.9073, 0.9122, 0.9171, 0.9217, 0.9267],
  },
});

export const N_COMPARTMENTS = 16;
export const PH2O = 0.0627;       // pression de vapeur d'eau alvéolaire (valeur Bühlmann, QR = 1)
export const FN2_AIR = 0.79;      // fraction N2 de l'air utilisée pour la saturation initiale
const LN2 = Math.LN2;

const K_N2 = ZHL16C.n2.ht.map((t) => LN2 / t);
const K_HE = ZHL16C.he.ht.map((t) => LN2 / t);

/**
 * Environnement : conversion profondeur <-> pression.
 * waterDensity en kg/L (1.03 mer, 1.00 douce), surfacePressure en bar.
 */
export function createEnvironment({ surfacePressure = 1.01325, waterDensity = 1.03 } = {}) {
  const barPerMeter = (waterDensity * 1000 * 9.80665) / 1e5;
  return Object.freeze({
    surfacePressure,
    waterDensity,
    barPerMeter,
    pressure: (depth) => surfacePressure + depth * barPerMeter,
    depth: (pressure) => (pressure - surfacePressure) / barPerMeter,
  });
}

/** État des 16 compartiments (pressions partielles inertes en bar). */
export class Tissues {
  constructor(env, init = null) {
    if (init) {
      this.n2 = Float64Array.from(init.n2);
      this.he = Float64Array.from(init.he);
    } else {
      const pn2 = (env.surfacePressure - PH2O) * FN2_AIR;
      this.n2 = new Float64Array(N_COMPARTMENTS).fill(pn2);
      this.he = new Float64Array(N_COMPARTMENTS).fill(0);
    }
  }

  clone() {
    return new Tissues(null, this);
  }
}

// Équation de Schreiner : pression inspirée variant linéairement dans le temps.
// Avec rate = 0 elle se réduit exactement à l'équation de Haldane.
function schreiner(p0, pInsp0, rate, k, t) {
  return pInsp0 + rate * (t - 1 / k) - (pInsp0 - p0 - rate / k) * Math.exp(-k * t);
}

/**
 * Charge les tissus pendant un segment linéaire de depthStart à depthEnd sur `minutes`,
 * en respirant `gas` ({o2, he} en fractions).
 */
export function loadSegment(tissues, env, depthStart, depthEnd, minutes, gas) {
  if (minutes <= 0) return tissues;
  const fHe = gas.he || 0;
  const fN2 = 1 - gas.o2 - fHe;
  const p0 = env.pressure(depthStart) - PH2O;
  const p1 = env.pressure(depthEnd) - PH2O;
  const rate = (p1 - p0) / minutes; // bar/min de pression ambiante (hors vapeur)
  for (let i = 0; i < N_COMPARTMENTS; i++) {
    tissues.n2[i] = schreiner(tissues.n2[i], p0 * fN2, rate * fN2, K_N2[i], minutes);
    tissues.he[i] = schreiner(tissues.he[i], p0 * fHe, rate * fHe, K_HE[i], minutes);
  }
  return tissues;
}

/** Coefficients a et b combinés N2/He, pondérés par les pressions partielles du tissu. */
function combinedAB(tissues, i) {
  const pn2 = tissues.n2[i];
  const phe = tissues.he[i];
  const p = pn2 + phe;
  if (p <= 0) return { p, a: ZHL16C.n2.a[i], b: ZHL16C.n2.b[i] };
  const a = (ZHL16C.n2.a[i] * pn2 + ZHL16C.he.a[i] * phe) / p;
  const b = (ZHL16C.n2.b[i] * pn2 + ZHL16C.he.b[i] * phe) / p;
  return { p, a, b };
}

/**
 * Pression ambiante minimale tolérée (bar abs) pour un gradient factor gf (0..1).
 * Retourne aussi l'indice du compartiment directeur.
 */
export function ceilingPressure(tissues, gf) {
  let max = -Infinity;
  let leading = 0;
  for (let i = 0; i < N_COMPARTMENTS; i++) {
    const { p, a, b } = combinedAB(tissues, i);
    const tol = (p - a * gf) / (gf / b + 1 - gf);
    if (tol > max) {
      max = tol;
      leading = i;
    }
  }
  return { pressure: max, leading };
}

/** Plafond en mètres (peut être négatif = aucune obligation). */
export function ceilingDepth(tissues, env, gf) {
  return env.depth(ceilingPressure(tissues, gf).pressure);
}

/**
 * Sursaturation de chaque compartiment en % de la M-value à la pression ambiante donnée
 * (utile pour l'affichage et le dialogue, jamais pour décider d'un palier).
 */
export function supersaturation(tissues, env, depth) {
  const pAmb = env.pressure(depth);
  const out = [];
  for (let i = 0; i < N_COMPARTMENTS; i++) {
    const { p, a, b } = combinedAB(tissues, i);
    const mValue = a + pAmb / b;
    out.push(((p - pAmb) / (mValue - pAmb)) * 100);
  }
  return out;
}
