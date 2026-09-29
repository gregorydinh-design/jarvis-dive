// JARVIS DIVE — Tests du moteur (node tests/run.js)
import { createEnvironment, Tissues, loadSegment, ceilingPressure, PH2O, ZHL16C } from '../engine/zhl16c.js';
import { parseGas, mod, end, defaultSwitchDepth } from '../engine/gases.js';
import { cnsLimit } from '../engine/oxygen.js';
import { planDive } from '../engine/planner.js';
import { contingencyPlans, withPreviousDive, surfaceInterval, cnsAfterInterval } from '../engine/scenarios.js';

let failed = 0;
let passed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failed++; console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`); }
}
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const env = createEnvironment();

console.log('\n1. Physique tissulaire');
{
  // Schreiner exact vs intégration numérique fine (descente 0 → 60 m en 3 min sur TX18/45)
  const gas = parseGas('18/45');
  const exact = loadSegment(new Tissues(env), env, 0, 60, 3, gas);
  const num = new Tissues(env);
  const n = 30000;
  for (let s = 0; s < n; s++) {
    const d = 60 * ((s + 0.5) / n);
    loadSegment(num, env, d, d, 3 / n, gas);
  }
  let maxErr = 0;
  for (let i = 0; i < 16; i++) maxErr = Math.max(maxErr, Math.abs(exact.n2[i] - num.n2[i]), Math.abs(exact.he[i] - num.he[i]));
  check('Schreiner = intégration numérique', maxErr < 1e-4, `écart max ${maxErr.toExponential(2)} bar`);

  // Saturation complète : 7 jours à 10 m à l'air
  const sat = loadSegment(new Tissues(env), env, 10, 10, 7 * 24 * 60, parseGas('Air'));
  const expected = (env.pressure(10) - PH2O) * 0.79;
  check('Saturation à 10 m', Math.abs(sat.n2[15] - expected) < 1e-3, `${sat.n2[15].toFixed(4)} vs ${expected.toFixed(4)}`);

  // Demi-période : compartiment 1 (5 min) à mi-chemin après 5 min
  const t = new Tissues(env);
  const p0 = t.n2[0];
  loadSegment(t, env, 30, 30, 5, parseGas('Air'));
  const pInsp = (env.pressure(30) - PH2O) * 0.79;
  check('Demi-période compartiment 1', close(t.n2[0], p0 + (pInsp - p0) / 2, 1e-9));

  // Surface, tissus à l'équilibre : aucun plafond
  check('Pas de plafond en surface', ceilingPressure(new Tissues(env), 0.3).pressure < env.surfacePressure);
  check('16 compartiments N2/He', ZHL16C.n2.ht.length === 16 && ZHL16C.he.a.length === 16);
}

console.log('\n2. Gaz et oxygène');
{
  const ean32 = parseGas('EAN32');
  check('MOD EAN32 @1.4', close(mod(ean32, 1.4, env), 33.3, 0.1), `${mod(ean32, 1.4, env).toFixed(2)} m`);
  check('Switch par défaut EAN50 = 21 m', defaultSwitchDepth(parseGas('EAN50'), env) === 21);
  check('Switch par défaut O2 = 6 m', defaultSwitchDepth(parseGas('O2'), env) === 6);
  check('END air 40 m (O2 narcotique) = 40 m', close(end(parseGas('Air'), 40, env), 40, 1e-6));
  check('END TX18/45 60 m ≈ 28 m', close(end(parseGas('18/45'), 60, env), 28, 1.5), `${end(parseGas('18/45'), 60, env).toFixed(1)} m`);
  check('Parse TX18/45', parseGas('tx18/45').name === 'TX18/45');
  check('Limite NOAA 1.4 = 150 min', cnsLimit(1.4) === 150);
  check('Limite NOAA 1.6 = 45 min', cnsLimit(1.6) === 45);
}

// Rejoue un plan minute par minute et vérifie qu'on ne passe jamais au-dessus du plafond.
function verifyNoCeilingViolation(plan, gases, cfg) {
  const t = new Tissues(env);
  const gfLow = cfg.gfLow / 100;
  const gfHigh = cfg.gfHigh / 100;
  const anchor = plan.gfAnchorDepth;
  const gfAt = (d) => (anchor ? Math.max(gfLow, Math.min(gfHigh, gfHigh - ((gfHigh - gfLow) * d) / anchor)) : gfHigh);
  let worst = -Infinity;
  for (const s of plan.segments) {
    if (s.duration <= 0) continue;
    const n = Math.max(1, Math.ceil(s.duration / 0.1));
    for (let k = 0; k < n; k++) {
      const a = s.from + ((s.to - s.from) * k) / n;
      const b = s.from + ((s.to - s.from) * (k + 1)) / n;
      loadSegment(t, env, a, b, s.duration / n, plan.gases[s.gasIndex]);
      if (s.kind === 'ascent' || s.kind === 'stop') {
        const c = env.depth(ceilingPressure(t, gfAt(b)).pressure);
        // En remontée on ne vérifie qu'aux points d'arrivée (paliers), comme le planificateur.
        if (k === n - 1) worst = Math.max(worst, c - b);
      }
    }
  }
  return worst;
}

function printPlan(title, plan) {
  console.log(`\n  ▸ ${title}`);
  for (const s of plan.stops) console.log(`     palier ${String(s.depth).padStart(2)} m  ${String(s.duration).padStart(3)} min  (${s.gas}, RT ${s.runtime.toFixed(1)})`);
  console.log(`     Runtime ${plan.runtime.toFixed(1)} min · TTS ${plan.tts.toFixed(1)} · Déco ${plan.decoTime} min · 1er palier ${plan.firstStop ?? '-'} m`);
  console.log(`     CNS ${plan.cns.toFixed(1)} % · OTU ${plan.otu.toFixed(0)} · NDL fin de fond ${plan.ndl} min`);
  console.log(`     Gaz : ${plan.gases.map((g) => `${g.name} ${g.liters} L`).join(' · ')}`);
  for (const w of plan.warnings) console.log(`     ⚠ [${w.level}] ${w.message}`);
}

console.log('\n3. Référence Subsurface (tests/testplan.cpp → testMetric, runtime attendu 109 min)');
{
  // TX15/45 79 m, 30 min RT, descente 23 m/min, GF 100/100, EAN36 @33 m, O2 @6 m,
  // remontée 30 ft/min, 10 ft/min dans les 6 derniers mètres, dernier palier 6 m, switch 1 min.
  const cfg = {
    depth: 79, bottomTime: 30,
    gases: [parseGas('15/45'), parseGas('EAN36', 33), parseGas('O2', 6)],
    gfLow: 100, gfHigh: 100,
    descentRate: 23, ascentRate: 9.144, ascentRateShallow: 3.048,
    lastStop: 6, switchStopMin: 1,
  };
  const plan = planDive(cfg);
  printPlan('TX15/45 79 m 30 min', plan);
  const tol = 0.01 * 109 + 1; // tolérance du test Subsurface : 1 % + 1 min
  check('Runtime ≈ 109 min (tolérance Subsurface)', close(plan.runtime, 109, tol), `${plan.runtime.toFixed(1)} min (±${tol.toFixed(1)})`);
  const sw = plan.segments.filter((s) => s.kind === 'switch');
  check('Switch EAN36 à 33 m puis O2 à 6 m', sw.length === 2 && sw[0].from === 33 && sw[1].from === 6);
  check('Aucune violation de plafond', verifyNoCeilingViolation(plan, cfg.gases, cfg) <= 1e-6);
}

console.log('\n4. Profil par défaut : Air (EAN21)');
{
  for (const [depth, time] of [[40, 20], [30, 25], [20, 40]]) {
    const cfg = { depth, bottomTime: time, gases: [parseGas('Air')], gfLow: 30, gfHigh: 85 };
    const plan = planDive(cfg);
    printPlan(`Air ${depth} m ${time} min GF 30/85`, plan);
    check(`Air ${depth} m : aucune violation de plafond`, verifyNoCeilingViolation(plan, cfg.gases, cfg) <= 1e-6);
  }
  // NDL air GF 100/100 depuis la surface (ordre de grandeur connu ZHL-16C)
  const ndl = (d) => planDive({ depth: d, bottomTime: d / 18 + 0.001, gases: [parseGas('Air')], gfLow: 100, gfHigh: 100 }).ndl;
  const n18 = ndl(18), n30 = ndl(30), n40 = ndl(40);
  console.log(`\n  NDL air GF100 : 18 m ${n18} min · 30 m ${n30} min · 40 m ${n40} min`);
  check('NDL air plausibles et décroissants', n18 > 45 && n18 < 70 && n30 > 12 && n30 < 22 && n40 > 5 && n40 < 12 && n18 > n30 && n30 > n40);
}

console.log('\n5. Cas réel validé : EAN27 + EAN47 @12 m (switch libre) + O2 @6 m, GF 30/85');
{
  const cfg = {
    depth: 40, bottomTime: 25,
    gases: [parseGas('EAN27'), parseGas('EAN47', 12), parseGas('O2', 6)],
    gfLow: 30, gfHigh: 85,
  };
  const plan = planDive(cfg);
  printPlan('EAN27 40 m 25 min', plan);
  const sw = plan.segments.filter((s) => s.kind === 'switch');
  check('Switch EAN47 à 12 m (pas au MOD) puis O2 à 6 m', sw.length === 2 && sw[0].from === 12 && sw[1].from === 6);
  check('Aucune violation de plafond', verifyNoCeilingViolation(plan, cfg.gases, cfg) <= 1e-6);
  // Un meilleur gaz de déco doit raccourcir la déco
  const airOnly = planDive({ ...cfg, gases: [parseGas('EAN27')] });
  check('Multi-gaz raccourcit la déco', plan.decoTime < airOnly.decoTime, `${plan.decoTime} vs ${airOnly.decoTime} min`);
  // GF plus conservateurs → déco plus longue
  const conservative = planDive({ ...cfg, gfLow: 20, gfHigh: 70 });
  check('GF 20/70 plus long que 30/85', conservative.runtime > plan.runtime);
}

console.log('\n6. Garde-fous');
{
  const p = planDive({ depth: 40, bottomTime: 20, gases: [parseGas('EAN32')] });
  check('Alerte ppO2 fond EAN32 à 40 m', p.warnings.some((w) => w.code === 'PPO2_BOTTOM'));
  const q = planDive({ depth: 40, bottomTime: 20, gases: [parseGas('Air'), parseGas('O2', 9)] });
  check('Pas d\'alerte O2 à 6 m (1.62 toléré)', !planDive({ depth: 40, bottomTime: 20, gases: [parseGas('Air'), parseGas('O2', 6)] }).warnings.some((w) => w.code === 'PPO2_SWITCH'));
  check('Alerte switch O2 à 9 m', q.warnings.some((w) => w.code === 'PPO2_SWITCH'));
  let threw = false;
  try { planDive({ depth: 60, bottomTime: 2, gases: [parseGas('Air')] }); } catch { threw = true; }
  check('Erreur si temps fond < descente', threw);
}

console.log('\n7. Blocs, réserve 50 bar, gaz minimum');
{
  const withCyl = (g, volume, startPressure) => ({ ...g, volume, startPressure });
  const cfg = { depth: 30, bottomTime: 25, gases: [withCyl(parseGas('Air'), 12, 200)], gfLow: 85, gfHigh: 85 };
  const p = planDive(cfg);
  const g = p.gases[0];
  check('Pression restante = départ − litres / volume', close(g.endPressure, 200 - g.liters / 12, 0.1), `${g.endPressure.toFixed(0)} bar`);
  // Gaz minimum à la main : 2 plongeurs × 20 L/min × 2, 1 min au fond + remontée sur le gaz fond
  let exp = env.pressure(30) * 1;
  p.segments.filter((s) => s.runtime > p.bottomEndRuntime + 1e-9 && s.kind !== 'switch')
    .forEach((s) => { exp += env.pressure((s.from + s.to) / 2) * s.duration; });
  check('Gaz minimum = 2 × SAC × 2 × exposition', close(p.minGas.liters, 2 * 20 * 2 * exp, 1), `${p.minGas.liters} L = ${p.minGas.bar.toFixed(0)} bar`);
  const small = planDive({ ...cfg, gases: [withCyl(parseGas('Air'), 7, 200)] });
  check('Alerte réserve < 50 bar (7 L)', small.warnings.some((w) => w.code === 'RESERVE'), `${small.gases[0].endPressure.toFixed(0)} bar`);
  check('Alerte gaz minimum (7 L)', small.warnings.some((w) => w.code === 'MIN_GAS'));
  check('Pas d\'alerte réserve avec bi 2×12', !planDive({ ...cfg, gases: [withCyl(parseGas('Air'), 24, 200)] }).warnings.some((w) => w.code === 'RESERVE'));
  const deco = planDive({ depth: 40, bottomTime: 25, gases: [withCyl(parseGas('EAN27'), 24, 200), withCyl(parseGas('EAN47', 12), 7, 200), withCyl(parseGas('O2', 6), 7, 200)] });
  check('Chaque bloc a sa pression restante', deco.gases.every((x) => Number.isFinite(x.endPressure)), deco.gases.map((x) => `${x.name} ${x.endPressure.toFixed(0)} bar`).join(' · '));
  check('Gaz minimum s\'arrête au premier switch', deco.minGas.liters < planDive({ ...cfg, depth: 40, bottomTime: 25, gases: [withCyl(parseGas('EAN27'), 24, 200)] }).minGas.liters);
}

console.log('\n8. Plans de secours et perte de gaz');
{
  const cfg = { depth: 40, bottomTime: 25, gases: [parseGas('EAN27'), parseGas('EAN47', 12), parseGas('O2', 6)] };
  const base = planDive(cfg);
  const sc = contingencyPlans(cfg);
  const get = (k, gas) => sc.find((x) => x.key === k && (!gas || x.gas === gas)).plan;
  check('+5 min plus long', get('PLUS_TIME').tts > base.tts, `DTR ${base.tts.toFixed(0)} → ${get('PLUS_TIME').tts.toFixed(0)}`);
  check('+3 m plus long', get('PLUS_DEPTH').tts > base.tts);
  check('+3 m +5 min le plus long', get('PLUS_BOTH').tts >= Math.max(get('PLUS_TIME').tts, get('PLUS_DEPTH').tts));
  check('Perte O2 plus longue', get('LOST_GAS', 'O2').decoTime > base.decoTime, `${base.decoTime} → ${get('LOST_GAS', 'O2').decoTime} min`);
  // Sans EAN47, on économise aussi la minute d'arrêt au switch : on compare à 1 min près.
  const lost47 = get('LOST_GAS', 'EAN47');
  check('Perte EAN47 : DTR au moins égale (à l\'arrêt de switch près)', lost47.tts >= base.tts - 1, `DTR ${base.tts.toFixed(1)} → ${lost47.tts.toFixed(1)} min`);
  check('5 scénarios (3 secours + 2 pertes)', sc.length === 5);
}

console.log('\n9. Plongée successive');
{
  const d1 = { depth: 40, bottomTime: 25, gases: [parseGas('Air')] };
  const d2 = { depth: 30, bottomTime: 25, gases: [parseGas('Air')] };
  const fresh = planDive(d2);
  const rep60 = planDive(withPreviousDive(d2, d1, 60).input);
  const rep180 = planDive(withPreviousDive(d2, d1, 180).input);
  const rep7d = planDive(withPreviousDive(d2, d1, 7 * 24 * 60).input);
  check('Successive (60 min) plus pénalisante que plongée seule', rep60.decoTime > fresh.decoTime, `${fresh.decoTime} → ${rep60.decoTime} min`);
  check('Intervalle plus long = moins de déco', rep180.decoTime <= rep60.decoTime, `${rep60.decoTime} → ${rep180.decoTime} min`);
  check('Après 7 jours = plongée seule', rep7d.decoTime === fresh.decoTime);
  check('CNS divisé par 2 en 90 min', close(cnsAfterInterval(40, 90), 20, 1e-9));
  const t = surfaceInterval(planDive(d1).tissuesAtSurface, env, 60);
  check('Désaturation en surface', t.n2[0] < planDive(d1).tissuesAtSurface.n2[0]);
}

console.log(`\n${passed} réussis, ${failed} échoué(s)\n`);
process.exit(failed ? 1 : 0);
