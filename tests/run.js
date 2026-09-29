// JARVIS DIVE — Tests du moteur (node tests/run.js)
import { createEnvironment, Tissues, loadSegment, ceilingPressure, PH2O, ZHL16C } from '../engine/zhl16c.js';
import { parseGas, mod, end, defaultSwitchDepth } from '../engine/gases.js';
import { cnsLimit } from '../engine/oxygen.js';
import { planDive } from '../engine/planner.js';
import { contingencyPlans, withPreviousDive, surfaceInterval, cnsAfterInterval } from '../engine/scenarios.js';
import { applyToolCalls, applyToolCall, TOOLS } from '../assistant/commands.js';
import { parseCommand } from '../assistant/parser.js';
import { interpret } from '../assistant/conversation.js';
import { understand } from '../assistant/intents.js';
import { renderFacts } from '../assistant/facts.js';
import { readDialog } from '../assistant/llm.js';
import { makeT } from '../i18n.js';

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


console.log('\n10. Commandes vocales : analyseur + outils');
{
  const base = { depth: 40, bottomTime: 20, gfLow: 85, gfHigh: 85, gases: [{ mix: 'Air', switchDepth: null, volume: 12, startPressure: 200 }] };
  const run = (text, st = base) => applyToolCalls(st, parseCommand(text, st).calls).state;
  const full = run('40 mètres 25 minutes EAN27, EAN47 à 12, oxygène à 6, GF 85 85');
  check('Phrase complète → formulaire', full.depth === 40 && full.bottomTime === 25 && full.gases.map((g) => `${g.mix}@${g.switchDepth ?? '-'}`).join(' ') === 'EAN27@- EAN47@12 O2@6',
    full.gases.map((g) => `${g.mix}@${g.switchDepth ?? '-'}`).join(' '));
  check('« ajoute 5 minutes »', run('ajoute 5 minutes', full).bottomTime === 30);
  check('« 3 mètres de plus »', run('3 mètres de plus', full).depth === 43);
  check('« enlève l\'EAN47 »', run('enlève l\'EAN47', full).gases.length === 2);
  check('« bloc fond bi 12 »', run('bloc fond bi 12', full).gases[0].volume === 24);
  check('« bloc de 15 litres à 230 bars »', (() => { const g = run('bloc de 15 litres à 230 bars').gases[0]; return g.volume === 15 && g.startPressure === 230; })());
  check('« GF 30 sur 85 »', (() => { const x = run('GF 30 sur 85'); return x.gfLow === 30 && x.gfHigh === 85; })());
  check('Nombres en lettres', (() => { const x = run('quarante-cinq mètres vingt-cinq minutes'); return x.depth === 45 && x.bottomTime === 25; })());
  check('« nitrox 32 à 30 mètres » = gaz fond', (() => { const x = run('nitrox 32 à 30 mètres 40 minutes'); return x.gases[0].mix === 'EAN32' && x.depth === 30 && x.bottomTime === 40; })());
  check('« EAN50 à 21 » = gaz de déco', run('EAN50 à 21').gases[1].switchDepth === 21);
  check('Anglais', (() => { const x = run('40 meters 25 minutes on EAN27, EAN50 at 21, oxygen at 6'); return x.gases.length === 3 && x.gases[0].mix === 'EAN27'; })());
  check('Trimix', run('trimix 18/45 à 60 m 20 min, EAN50 à 21, O2 à 6').gases[0].mix === 'TX18/45');
  const withO2 = { ...base, bottomTime: 18, gases: [...base.gases, { mix: 'O2', switchDepth: 6, volume: 7, startPressure: 200 }] };
  check('« une vingtaine de minutes »', run('on reste une vingtaine de minutes', withO2).bottomTime === 20);
  check('« une demi-heure »', run('35 mètres pendant une demi-heure', withO2).bottomTime === 30);
  check('« nitrox 50 pour la déco » = déco, pas fond', (() => { const x = run('mets-moi du nitrox 50 pour la déco', withO2); return x.gases[0].mix === 'Air' && x.gases[1].mix === 'EAN50' && x.gases[1].switchDepth === 21; })());
  check('« vire l\'oxy »', run('vire l\'oxy', withO2).gases.length === 1);
  check('« on part au 32 à 30 mètres » = EAN32 au fond', (() => { const x = run('on part au 32 à 30 mètres pour 40 minutes', withO2); return x.gases[0].mix === 'EAN32' && x.depth === 30 && x.bottomTime === 40; })());
  check('« 30 mètres » reste une profondeur', run('descends à 30 mètres', withO2).depth === 30);
  check('Gaz de déco triés par profondeur', run('EAN50 à 21', withO2).gases.map((g) => g.mix).join(' ') === 'Air EAN50 O2');
  // Validation : un outil hors limites est refusé et l'état n'est pas modifié
  let refused = false;
  try { applyToolCall(base, { name: 'set_dive', args: { depth: 400 } }); } catch (e) { refused = e.code === 'x_RANGE'; }
  check('Profondeur 400 m refusée', refused);
  refused = false;
  try { applyToolCall(base, { name: 'remove_gas', args: { mix: 'Air' } }); } catch (e) { refused = e.code === 'x_REMOVE_BOTTOM'; }
  check('Impossible de retirer le gaz fond', refused);
  check('7 outils exposés au LLM', TOOLS.length === 7);
  // Le plan issu d'une commande est identique au plan saisi à la main
  const fromVoice = planDive({ ...full, gases: full.gases.map((g) => ({ ...parseGas(g.mix, g.switchDepth), volume: g.volume, startPressure: g.startPressure })) });
  const byHand = planDive({ depth: 40, bottomTime: 25, gfLow: 85, gfHigh: 85, gases: [parseGas('EAN27'), parseGas('EAN47', 12), parseGas('O2', 6)] });
  check('Plan vocal = plan manuel', fromVoice.runtime === byHand.runtime && fromVoice.decoTime === byHand.decoTime);
}


console.log('\n11. Conversation : questions → faits calculés');
{
  const st = { depth: 40, bottomTime: 25, gfLow: 85, gfHigh: 85, gases: [{ mix: 'EAN27' }, { mix: 'EAN47', switchDepth: 12 }, { mix: 'O2', switchDepth: 6 }] };
  const input = { depth: 40, bottomTime: 25, gfLow: 85, gfHigh: 85, gases: [{ ...parseGas('EAN27'), volume: 24, startPressure: 200 }, { ...parseGas('EAN47', 12), volume: 7, startPressure: 200 }, { ...parseGas('O2', 6), volume: 7, startPressure: 200 }] };
  const plan = planDive(input);
  const ids = (q) => understand(q, st).facts.map((f) => f.id).join(',');
  check('« mon gaz fond tient ? »', ids('est-ce que mon gaz fond tient ?') === 'gas_bottom,min_gas');
  check('« palier le plus long ? »', ids('quel est le palier le plus long ?') === 'longest_stop');
  check('« et si je perds l\'oxy ? » = scénario, pas une commande', (() => { const u = understand("et si je perds l'oxy ?", st); return u.facts[0].id === 'lost_gas' && u.facts[0].gas === 'O2' && !u.calls.length; })());
  check('« et avec 10 minutes de plus ? » = scénario sans modifier', (() => { const u = understand('et avec 10 minutes de plus ?', st); return u.facts[0].minutes === 10 && !u.calls.length; })());
  check('« rajoute 5 minutes » = commande', (() => { const u = understand('rajoute 5 minutes', st); return u.calls.length === 1 && !u.facts.length; })());
  const txt = renderFacts([{ id: 'gas_bottom' }, { id: 'min_gas' }], { plan, input });
  check('Réponse gaz fond : bons chiffres, bon gaz', txt.includes('nitrox 27') && txt.includes(`${Math.round(plan.gases[0].endPressure)} bars`) && !txt.includes('nitrox 47'), txt);
  const lost = renderFacts([{ id: 'lost_gas', gas: 'O2' }], { plan, input });
  const ref = contingencyPlans(input).find((x) => x.gas === 'O2').plan;
  check('Réponse perte O2 = plan de secours du moteur', lost.includes(`${Math.round(ref.tts)} minutes`), lost);
  check('Alerte annoncée si réserve franchie', renderFacts([{ id: 'plus_time', minutes: 10 }], { plan, input }).includes('Attention'));
  check('Élision : « bars d\'air »', renderFacts([{ id: 'min_gas' }], { plan: planDive({ depth: 30, bottomTime: 20, gases: [{ ...parseGas('Air'), volume: 12, startPressure: 200 }] }), input: {} }).includes("d'air"));
  check('Alertes traduites en anglais', renderFacts([{ id: 'plus_time', minutes: 10 }], { plan, input, t: makeT('en') }, 'en').includes('bar left'));
  check('Note du LLM contenant un chiffre supprimée', readDialog('{"calls":[],"facts":[],"note":"il te reste 91 bars"}').note === '');
  check('Fait inconnu ignoré', readDialog('{"calls":[],"facts":[{"id":"hack"},{"id":"tts"}],"note":""}').facts.length === 1);
}

console.log('\n13. Plan complet dicté en une phrase');
{
  const st0 = { depth: 40, bottomTime: 20, gfLow: 85, gfHigh: 85, gases: [{ mix: 'Air', switchDepth: null, volume: 12, startPressure: 200 }] };
  const run = (q) => applyToolCalls(st0, parseCommand(q, st0).calls).state;
  const desc = (x) => `${x.depth}m ${x.bottomTime}min | ` + x.gases.map((g) => `${g.mix}@${g.switchDepth ?? '-'} ${g.volume}L ${g.startPressure}b`).join(' ; ');
  const a = run('plongée à 30 mètres max et 45 minutes, au nitrox 32 en bi 12 à 230 bars, EAN50 à 21 en 11 litres, oxygène à 6 en 7 litres');
  check('Tout en une phrase (gaz, switchs, blocs, pressions)', desc(a) === '30m 45min | EAN32@- 24L 230b ; EAN50@21 11L 200b ; O2@6 7L 200b', desc(a));
  const b = run('30 mètres 45 minutes EAN32, bloc fond bi 12 à 230 bars, bloc EAN50 11 litres, EAN50 à 21, oxygène à 6');
  check('Bloc d\'un gaz de déco dicté avant le gaz', b.gases.find((g) => g.mix === 'EAN50').volume === 11 && b.gases[0].startPressure === 230, desc(b));
  check('« à l\'air en 15 litres »', run("30 mètres 45 minutes à l'air en 15 litres").gases[0].volume === 15);
}

console.log('\n12. Compréhension hybride');
{
  const st = { depth: 40, bottomTime: 25, gfLow: 85, gfHigh: 85, gases: [{ mix: 'EAN27' }, { mix: 'O2', switchDepth: 6 }] };
  let llmCalled = 0;
  const fakeLlm = async () => { llmCalled++; return '{"calls":[],"facts":[{"id":"tts"}],"note":""}'; };
  const a1 = await interpret('rajoute 5 minutes', st, [], fakeLlm);
  check('Analyseur d\'abord : pas d\'appel au LLM si la phrase est comprise', a1.source === 'parser' && llmCalled === 0);
  const a2 = await interpret('bon alors, ça sort quand cette histoire ?', st, [], fakeLlm);
  check('LLM seulement pour une phrase non comprise', a2.source === 'llm' && llmCalled === 1 && a2.facts[0].id === 'tts');
  const a3 = await interpret('blabla', st, [], async () => { throw new Error('boom'); });
  check('LLM en panne : pas de plantage', a3.source === 'parser');
}

console.log(`\n${passed} réussis, ${failed} échoué(s)\n`);
process.exit(failed ? 1 : 0);
