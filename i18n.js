// JARVIS DIVE — Traductions FR / EN
const fr = {
  subtitle: 'Bühlmann ZHL-16C · GF · OC multi-gaz',
  offline: 'Hors ligne',
  dive: 'Plongée',
  depth: 'Profondeur',
  bottomTime: 'Temps fond',
  bottomTimeUnit: 'min, descente incluse',
  gfLow: 'GF bas',
  gfHigh: 'GF haut',
  gases: 'Gaz',
  addGas: '+ Gaz de déco',
  advanced: 'Réglages avancés',
  descentRate: 'Descente',
  ascentRate: 'Remontée',
  lastStop: 'Dernier palier',
  switchStop: 'Arrêt au switch',
  ppO2Bottom: 'ppO2 max fond',
  water: 'Eau',
  sea: 'Mer',
  fresh: 'Douce',
  sacBottom: 'SAC fond',
  sacDeco: 'SAC déco',
  roleBottom: 'Fond',
  roleDeco: 'Déco',
  switchLabel: 'switch',
  mixLabel: 'Mélange',
  switchDepthLabel: 'Profondeur de switch',
  remove: 'Supprimer',
  footer: "Outil d'aide à la planification en cours de validation. Il ne remplace ni la formation, ni l'ordinateur de plongée, ni le jugement du plongeur. Vérifiez chaque plan avec un second outil.",
  plan: 'Plan',
  runtime: 'Runtime min',
  tts: 'TTS min',
  stopsMin: 'Paliers min',
  firstStop: '1er palier m',
  stops: 'Paliers',
  stop: 'Palier',
  duration: 'Durée',
  gas: 'Gaz',
  consumption: 'Conso.',
  profileAria: 'Profil de plongée',
  switchRow: '↳ Switch {gas} à {depth} m',
  noStop: 'Aucun palier obligatoire. NDL restant en fin de fond : <b>{ndl} min</b> (GF {gf}).',
  meta: 'END fond {end} m · densité {rho} g/L · ppO2 max {pp} bar',
  // Alertes
  w_PPO2_BOTTOM: 'ppO2 fond {pp} bar > {max} (MOD {gas} : {mod} m)',
  w_END: 'END {end} m (narcose) avec {gas}',
  w_DENSITY: 'Densité du gaz {rho} g/L au fond (recommandé ≤ 5.2, max 6.2)',
  w_PPO2_SWITCH: '{gas} au switch {depth} m : ppO2 {pp} bar > {max} (MOD {mod} m)',
  w_CNS: 'CNS {cns} % > {limit} %',
  w_PPO2_MAX: 'ppO2 max {pp} bar',
  // Erreurs
  e_INVALID_O2: 'Fraction O2 invalide : {o2}',
  e_INVALID_MIX: 'Mélange invalide : O2 {o2} / He {he}',
  e_UNKNOWN_GAS: 'Gaz non reconnu : « {text} »',
  e_INVALID_DEPTH: 'Profondeur invalide',
  e_INVALID_TIME: 'Temps fond invalide',
  e_NO_GAS: 'Au moins un gaz est requis',
  e_INVALID_GF: 'Gradient factors invalides (GF bas ≤ GF haut ≤ 100)',
  e_DESCENT_TOO_LONG: 'Temps fond ({bottomTime} min) inférieur au temps de descente ({descent} min)',
  e_NO_CONVERGENCE: 'Calcul de remontée non convergent',
  e_EXCESSIVE_DECO: 'Décompression excessive : plan abandonné',
  e_SWITCH_MISSING: 'Profondeur de switch manquante pour {gas}',
};

const en = {
  subtitle: 'Bühlmann ZHL-16C · GF · OC multi-gas',
  offline: 'Offline',
  dive: 'Dive',
  depth: 'Depth',
  bottomTime: 'Bottom time',
  bottomTimeUnit: 'min, descent included',
  gfLow: 'GF low',
  gfHigh: 'GF high',
  gases: 'Gases',
  addGas: '+ Deco gas',
  advanced: 'Advanced settings',
  descentRate: 'Descent',
  ascentRate: 'Ascent',
  lastStop: 'Last stop',
  switchStop: 'Gas switch stop',
  ppO2Bottom: 'Max bottom ppO2',
  water: 'Water',
  sea: 'Salt',
  fresh: 'Fresh',
  sacBottom: 'Bottom SAC',
  sacDeco: 'Deco SAC',
  roleBottom: 'Bottom',
  roleDeco: 'Deco',
  switchLabel: 'switch',
  mixLabel: 'Mix',
  switchDepthLabel: 'Switch depth',
  remove: 'Remove',
  footer: 'Planning aid still under validation. It does not replace training, your dive computer or your own judgement. Cross-check every plan with a second tool.',
  plan: 'Plan',
  runtime: 'Runtime min',
  tts: 'TTS min',
  stopsMin: 'Stops min',
  firstStop: 'First stop m',
  stops: 'Stops',
  stop: 'Stop',
  duration: 'Time',
  gas: 'Gas',
  consumption: 'Usage',
  profileAria: 'Dive profile',
  switchRow: '↳ Switch to {gas} at {depth} m',
  noStop: 'No mandatory stop. NDL left at end of bottom: <b>{ndl} min</b> (GF {gf}).',
  meta: 'Bottom END {end} m · gas density {rho} g/L · max ppO2 {pp} bar',
  w_PPO2_BOTTOM: 'Bottom ppO2 {pp} bar > {max} ({gas} MOD: {mod} m)',
  w_END: 'END {end} m (narcosis) on {gas}',
  w_DENSITY: 'Gas density {rho} g/L at bottom (recommended ≤ 5.2, max 6.2)',
  w_PPO2_SWITCH: '{gas} switched at {depth} m: ppO2 {pp} bar > {max} (MOD {mod} m)',
  w_CNS: 'CNS {cns} % > {limit} %',
  w_PPO2_MAX: 'Max ppO2 {pp} bar',
  e_INVALID_O2: 'Invalid O2 fraction: {o2}',
  e_INVALID_MIX: 'Invalid mix: O2 {o2} / He {he}',
  e_UNKNOWN_GAS: 'Unknown gas: "{text}"',
  e_INVALID_DEPTH: 'Invalid depth',
  e_INVALID_TIME: 'Invalid bottom time',
  e_NO_GAS: 'At least one gas is required',
  e_INVALID_GF: 'Invalid gradient factors (GF low ≤ GF high ≤ 100)',
  e_DESCENT_TOO_LONG: 'Bottom time ({bottomTime} min) is shorter than the descent ({descent} min)',
  e_NO_CONVERGENCE: 'Ascent calculation did not converge',
  e_EXCESSIVE_DECO: 'Excessive decompression: plan aborted',
  e_SWITCH_MISSING: 'Missing switch depth for {gas}',
};

export const DICTS = { fr, en };
const LANG_KEY = 'jarvis-dive:lang';

// Arrondi d'affichage des paramètres numériques d'alertes et d'erreurs
const DECIMALS = { pp: 2, max: 2, mod: 1, end: 0, rho: 1, cns: 0, descent: 1 };

export function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch { /* stockage indisponible */ }
  const nav = (navigator.language || 'fr').toLowerCase();
  return nav.startsWith('fr') ? 'fr' : 'en';
}

export function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* sans conséquence */ }
}

export function makeT(lang) {
  const dict = DICTS[lang] || fr;
  return (key, params = {}) => {
    const tpl = dict[key] ?? fr[key] ?? key;
    return tpl.replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      if (typeof v === 'number' && k in DECIMALS) return v.toFixed(DECIMALS[k]);
      return v ?? '';
    });
  };
}
