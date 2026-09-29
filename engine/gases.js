// JARVIS DIVE — Gaz respiratoires : parsing, MOD, END, ppO2.

/**
 * Crée un gaz. o2 et he en fractions (0.21) ou en pourcentages (21).
 * switchDepth : profondeur (m) à partir de laquelle ce gaz de déco est utilisé à la remontée.
 */
export function makeGas({ name, o2, he = 0, switchDepth = null } = {}) {
  const fo2 = o2 > 1 ? o2 / 100 : o2;
  const fhe = he > 1 ? he / 100 : he;
  if (!(fo2 > 0 && fo2 <= 1)) throw new Error(`Fraction O2 invalide : ${o2}`);
  if (fhe < 0 || fo2 + fhe > 1 + 1e-9) throw new Error(`Mélange invalide : O2 ${o2} / He ${he}`);
  const gas = { o2: round4(fo2), he: round4(fhe), n2: round4(1 - fo2 - fhe), switchDepth };
  gas.name = name || gasName(gas);
  return gas;
}

/** Nom normalisé : Air, EAN32, O2, TX18/45. */
export function gasName({ o2, he = 0 }) {
  const po2 = Math.round(o2 * 100);
  const phe = Math.round(he * 100);
  if (phe > 0) return `TX${po2}/${phe}`;
  if (po2 === 100) return 'O2';
  if (po2 === 21) return 'Air';
  return `EAN${po2}`;
}

/** Parse "Air", "EAN32", "Nx32", "32", "O2", "TX18/45", "18/45". */
export function parseGas(text, switchDepth = null) {
  const s = String(text).trim().toUpperCase().replace(/\s+/g, '');
  if (s === 'AIR' || s === 'EAN21') return makeGas({ o2: 0.21, switchDepth });
  if (s === 'O2' || s === 'OXY' || s === 'OXYGEN' || s === 'EAN100') return makeGas({ o2: 1, switchDepth });
  let m = s.match(/^(?:TX|TMX|TRIMIX)?(\d{1,3})\/(\d{1,3})$/);
  if (m) return makeGas({ o2: +m[1] / 100, he: +m[2] / 100, switchDepth });
  m = s.match(/^(?:EAN|NX|NITROX)?(\d{1,3})$/);
  if (m) return makeGas({ o2: +m[1] / 100, switchDepth });
  throw new Error(`Gaz non reconnu : "${text}"`);
}

export function ppO2(gas, depth, env) {
  return gas.o2 * env.pressure(depth);
}

/** Profondeur maximale d'utilisation (m) pour une ppO2 max donnée. */
export function mod(gas, ppO2Max, env) {
  return env.depth(ppO2Max / gas.o2);
}

/** Profondeur de switch par défaut : MOD à ppO2 1.6 (+ tolérance d'arrondi) arrondie aux 3 m inférieurs. */
export function defaultSwitchDepth(gas, env, ppO2Max = 1.6, step = 3, tolerance = 0.03) {
  return Math.max(0, Math.floor(mod(gas, ppO2Max + tolerance, env) / step + 1e-9) * step);
}

/**
 * Profondeur équivalente narcotique (m).
 * o2Narcotic = true : O2 considéré narcotique (convention TDI/GUE actuelle) → seul l'hélium réduit l'END.
 */
export function end(gas, depth, env, { o2Narcotic = true } = {}) {
  const p = env.pressure(depth);
  const narcotic = o2Narcotic ? gas.n2 + gas.o2 : gas.n2 / 0.79;
  return Math.max(0, env.depth(p * narcotic));
}

/** Densité du gaz (g/L) à la profondeur — repère 5.2 g/L recommandé, 6.2 max. */
export function density(gas, depth, env) {
  const rho = { o2: 1.429, n2: 1.2506, he: 0.1786 }; // g/L à 1 atm, 0 °C
  const perBar = (gas.o2 * rho.o2 + gas.n2 * rho.n2 + gas.he * rho.he) / 1.01325;
  return perBar * env.pressure(depth);
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}
