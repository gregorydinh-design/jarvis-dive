// JARVIS DIVE — Toxicité oxygène : CNS (tables NOAA) et OTU.

// Limites NOAA d'exposition unique : ppO2 (bar) → minutes.
const NOAA = [
  [0.6, 720], [0.7, 570], [0.8, 450], [0.9, 360], [1.0, 300], [1.1, 240],
  [1.2, 210], [1.3, 180], [1.4, 150], [1.5, 120], [1.6, 45],
];

/** Limite NOAA (min) pour une ppO2, interpolée linéairement. Infinity sous 0.5 bar. */
export function cnsLimit(pp) {
  if (pp <= 0.5) return Infinity;
  if (pp <= 0.6) return 720;
  for (let i = 1; i < NOAA.length; i++) {
    const [p1, t1] = NOAA[i];
    if (pp <= p1) {
      const [p0, t0] = NOAA[i - 1];
      return t0 + ((pp - p0) / (p1 - p0)) * (t1 - t0);
    }
  }
  // Au-delà de 1.6 : hors table NOAA. Extrapolation volontairement pénalisante.
  const slope = (45 - 120) / 0.1;
  return Math.max(1, 45 + (pp - 1.6) * slope);
}

/** % CNS par minute. */
export function cnsRate(pp) {
  const lim = cnsLimit(pp);
  return lim === Infinity ? 0 : 100 / lim;
}

/** OTU par minute (formule de Lambertsen). */
export function otuRate(pp) {
  return pp > 0.5 ? Math.pow((pp - 0.5) / 0.5, 0.83) : 0;
}

/**
 * Intègre CNS et OTU sur un segment à ppO2 linéaire (pas de 3 s, précision largement suffisante).
 */
export function oxygenExposure(ppStart, ppEnd, minutes) {
  if (minutes <= 0) return { cns: 0, otu: 0 };
  const n = Math.max(1, Math.ceil(minutes / 0.05));
  const dt = minutes / n;
  let cns = 0;
  let otu = 0;
  for (let i = 0; i < n; i++) {
    const pp = ppStart + ((i + 0.5) / n) * (ppEnd - ppStart);
    cns += cnsRate(pp) * dt;
    otu += otuRate(pp) * dt;
  }
  return { cns, otu };
}
