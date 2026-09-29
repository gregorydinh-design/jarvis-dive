// JARVIS DIVE — Faits vérifiés : chaque réponse chiffrée vient d'ici, calculée par le moteur.
// Le LLM choisit QUELS faits annoncer ; il n'écrit jamais lui-même un chiffre.

import { contingencyPlans, maxBottomTime } from '../engine/scenarios.js';
import { planDive } from '../engine/planner.js';
import { parseGas } from '../engine/gases.js';

export const FACT_IDS = [
  'summary', 'stops', 'first_stop', 'longest_stop', 'tts', 'runtime',
  'gas_bottom', 'gas_all', 'min_gas', 'oxygen', 'switches', 'alerts',
  'plus_time', 'plus_depth', 'lost_gas', 'ndl', 'max_bottom',
];

const TXT = {
  fr: {
    noStop: (ndl) => `Aucun palier obligatoire, il te reste ${ndl} minutes de marge au fond.`,
    summary: (p) => `${firstStop(p, 'fr')} Durée totale de remontée ${r(p.tts)} minutes, runtime ${r(p.runtime)} minutes.`,
    stops: (p) => (p.stops.length ? `Paliers : ${p.stops.map((s) => `${s.depth} mètres ${s.duration} minute${s.duration > 1 ? 's' : ''} en ${say(s.gas, 'fr')}`).join(', ')}.` : TXT.fr.noStop(p.ndl)),
    first_stop: (p) => firstStop(p, 'fr'),
    longest_stop: (p) => {
      if (!p.stops.length) return TXT.fr.noStop(p.ndl);
      const s = p.stops.reduce((a, b) => (b.duration > a.duration ? b : a));
      return `Le palier le plus long est à ${s.depth} mètres : ${s.duration} minutes en ${say(s.gas, 'fr')}.`;
    },
    tts: (p) => `Durée totale de remontée : ${r(p.tts)} minutes.`,
    runtime: (p) => `Runtime total : ${r(p.runtime)} minutes.`,
    gas: (g, reserve) => (Number.isFinite(g.endPressure)
      ? `${cap(say(g.name, 'fr'))} : ${r(Math.max(0, g.endPressure))} bars en sortie${g.endPressure < reserve ? `, sous la réserve de ${reserve} bars` : ''}.`
      : `${cap(say(g.name, 'fr'))} : bloc non renseigné.`),
    min_gas: (p) => (p.minGas.bar == null ? 'Gaz minimum : bloc fond non renseigné.'
      : `Gaz minimum : il faut ${r(p.minGas.bar)} bars ${deFr(say(p.gases[0].name, 'fr'))} en fin de fond, tu en auras ${r(Math.max(0, p.minGas.pressureAtBottomEnd))}. ${p.minGas.ok ? `Marge de ${r(p.minGas.pressureAtBottomEnd - p.minGas.bar)} bars.` : 'Insuffisant.'}`),
    oxygen: (p) => `CNS ${r(p.cns)} pour cent, ${r(p.otu)} OTU.`,
    switches: (p) => {
      const sw = p.segments.filter((s) => s.kind === 'switch');
      return sw.length ? `Changements de gaz : ${sw.map((s) => `${say(s.gas, 'fr')} à ${s.from} mètres`).join(', ')}.` : 'Aucun changement de gaz.';
    },
    alerts: (p) => {
      const w = p.warnings.filter((x) => x.level !== 'info');
      return w.length ? `Attention : ${w.map((x) => spokenMsg(msgOf(x), 'fr')).join('. ')}.` : 'Aucune alerte.';
    },
    scenario: (label, q) => (q.error ? `${label} : plan impossible.`
      : `${label} : ${firstStop(q.plan, 'fr')} Durée totale de remontée ${r(q.plan.tts)} minutes.${lowest(q.plan, 'fr')}${dangers(q.plan, 'fr')}`),
    plusTime: (n) => `Avec ${n} minutes de plus`,
    plusDepth: (n) => `Avec ${n} mètres de plus`,
    lost: (g) => `Sans ${say(g, 'fr')}`,
    notInPlan: (g) => `${cap(say(g, 'fr'))} ne fait pas partie du plan.`,
    ndl: (p) => (p.ndl > 0 ? `Il te reste ${p.ndl} minutes sans palier en fin de fond.` : 'Tu es en décompression : pas de marge sans palier.'),
    lowest: (g, bar) => ` Bloc le plus bas : ${say(g, 'fr')} à ${bar} bars.`,
    maxBottom: (m, limit, p) => (m.max == null ? 'Aucune limite : renseigne un runtime max ou tes blocs.'
      : `${limit ? `Pour sortir avant ${limit} minutes, ` : ''}tu peux rester au plus ${m.max} minutes au fond, limité par ${m.limitedBy === 'runtime' ? 'le runtime' : 'ton gaz'}.${m.limitedBy === 'runtime' && m.byGas != null ? ` Ton gaz permettrait ${m.byGas} minutes.` : ''} Tu as prévu ${p.input.bottomTime} minutes.`),
  },
  en: {
    noStop: (ndl) => `No mandatory stop, ${ndl} minutes of margin left at the bottom.`,
    summary: (p) => `${firstStop(p, 'en')} Time to surface ${r(p.tts)} minutes, runtime ${r(p.runtime)} minutes.`,
    stops: (p) => (p.stops.length ? `Stops: ${p.stops.map((s) => `${s.depth} meters ${s.duration} minute${s.duration > 1 ? 's' : ''} on ${say(s.gas, 'en')}`).join(', ')}.` : TXT.en.noStop(p.ndl)),
    first_stop: (p) => firstStop(p, 'en'),
    longest_stop: (p) => {
      if (!p.stops.length) return TXT.en.noStop(p.ndl);
      const s = p.stops.reduce((a, b) => (b.duration > a.duration ? b : a));
      return `The longest stop is at ${s.depth} meters: ${s.duration} minutes on ${say(s.gas, 'en')}.`;
    },
    tts: (p) => `Time to surface: ${r(p.tts)} minutes.`,
    runtime: (p) => `Total runtime: ${r(p.runtime)} minutes.`,
    gas: (g, reserve) => (Number.isFinite(g.endPressure)
      ? `${cap(say(g.name, 'en'))}: ${r(Math.max(0, g.endPressure))} bar at the end${g.endPressure < reserve ? `, below the ${reserve} bar reserve` : ''}.`
      : `${cap(say(g.name, 'en'))}: cylinder not set.`),
    min_gas: (p) => (p.minGas.bar == null ? 'Minimum gas: bottom cylinder not set.'
      : `Minimum gas: you need ${r(p.minGas.bar)} bar of ${say(p.gases[0].name, 'en')} at the end of the bottom, you will have ${r(Math.max(0, p.minGas.pressureAtBottomEnd))}. ${p.minGas.ok ? `Margin ${r(p.minGas.pressureAtBottomEnd - p.minGas.bar)} bar.` : 'Not enough.'}`),
    oxygen: (p) => `CNS ${r(p.cns)} percent, ${r(p.otu)} OTU.`,
    switches: (p) => {
      const sw = p.segments.filter((s) => s.kind === 'switch');
      return sw.length ? `Gas switches: ${sw.map((s) => `${say(s.gas, 'en')} at ${s.from} meters`).join(', ')}.` : 'No gas switch.';
    },
    alerts: (p) => {
      const w = p.warnings.filter((x) => x.level !== 'info');
      return w.length ? `Warning: ${w.map((x) => spokenMsg(msgOf(x), 'en')).join('. ')}.` : 'No warning.';
    },
    scenario: (label, q) => (q.error ? `${label}: no valid plan.`
      : `${label}: ${firstStop(q.plan, 'en')} Time to surface ${r(q.plan.tts)} minutes.${lowest(q.plan, 'en')}${dangers(q.plan, 'en')}`),
    plusTime: (n) => `With ${n} more minutes`,
    plusDepth: (n) => `With ${n} more meters`,
    lost: (g) => `Without ${say(g, 'en')}`,
    notInPlan: (g) => `${cap(say(g, 'en'))} is not part of the plan.`,
    ndl: (p) => (p.ndl > 0 ? `${p.ndl} no-stop minutes left at the end of the bottom.` : 'You are in decompression: no no-stop margin.'),
    lowest: (g, bar) => ` Lowest cylinder: ${say(g, 'en')} at ${bar} bar.`,
    maxBottom: (m, limit, p) => (m.max == null ? 'No limit: set a max runtime or your cylinders.'
      : `${limit ? `To be out within ${limit} minutes, ` : ''}you can stay at most ${m.max} minutes at the bottom, limited by ${m.limitedBy === 'runtime' ? 'the runtime' : 'your gas'}.${m.limitedBy === 'runtime' && m.byGas != null ? ` Your gas would allow ${m.byGas} minutes.` : ''} You planned ${p.input.bottomTime} minutes.`),
  },
};

const r = (x) => Math.round(x);
// Traduction des alertes : fournie par l'app (i18n) ; sinon message français du moteur.
let translate = null;
const msgOf = (w) => (translate && w.params ? translate('w_' + w.code, w.params) : w.message);
// Messages d'alerte lisibles à voix haute : « EAN27 » → « nitrox 27 », « O2 » → « oxygène »
const spokenMsg = (m, lang) => String(m)
  .replace(/\bTX(\d+)\/(\d+)/g, 'trimix $1 $2')
  .replace(/\bEAN(\d+)/g, 'nitrox $1')
  .replace(/\bO2\b/g, lang === 'fr' ? 'oxygène' : 'oxygen')
  .replace(/\bppO2\b/g, 'p p O 2');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const deFr = (w) => (/^[aeiouyéèh]/i.test(w) ? `d'${w}` : `de ${w}`); // « d'air », « d'oxygène », « de nitrox 27 »

function say(name, lang) {
  if (name === 'O2') return lang === 'fr' ? 'oxygène' : 'oxygen';
  if (name === 'Air') return 'air';
  let m = name.match(/^EAN(\d+)$/);
  if (m) return `nitrox ${m[1]}`;
  m = name.match(/^TX(\d+)\/(\d+)$/);
  if (m) return `trimix ${m[1]} ${m[2]}`;
  return name;
}

function firstStop(p, lang) {
  if (!p.stops.length) return TXT[lang].noStop(p.ndl);
  const s = p.stops[0];
  return lang === 'fr' ? `Premier palier à ${s.depth} mètres.` : `First stop at ${s.depth} meters.`;
}

function dangers(p, lang) {
  const d = p.warnings.filter((w) => w.level === 'danger');
  if (!d.length) return '';
  return (lang === 'fr' ? ' Attention : ' : ' Warning: ') + d.map((w) => spokenMsg(msgOf(w), lang)).join('. ') + '.';
}

function lowest(p, lang) {
  const withCyl = p.gases.filter((g) => Number.isFinite(g.endPressure));
  if (!withCyl.length) return '';
  const g = withCyl.reduce((a, b) => (b.endPressure < a.endPressure ? b : a));
  return TXT[lang].lowest(g.name, r(Math.max(0, g.endPressure)));
}

function tryPlan(input) {
  try { return { plan: planDive(input) }; } catch (error) { return { error }; }
}

/**
 * Construit la réponse à partir des faits demandés.
 * @param {Array<{id, gas?}>} requests faits choisis par le LLM (ou l'analyseur)
 * @param {{ plan, input, reserve }} ctx plan calculé + entrée du planificateur (pour les scénarios)
 */
export function renderFacts(requests, ctx, lang = 'fr') {
  const T = TXT[lang] || TXT.fr;
  const { plan, input } = ctx;
  translate = ctx.t || null;
  const reserve = ctx.reserve ?? 50;
  let scenarios = null;
  const sc = () => (scenarios ||= contingencyPlans(input));
  const out = [];
  const seen = new Set();
  for (const req of requests) {
    const key = `${req.id}:${req.gas || ''}:${req.minutes || ''}:${req.meters || ''}`;
    if (seen.has(key) || !FACT_IDS.includes(req.id)) continue;
    seen.add(key);
    switch (req.id) {
      case 'gas_bottom': out.push(T.gas(plan.gases[0], reserve)); break;
      case 'gas_all': out.push(plan.gases.map((g) => T.gas(g, reserve)).join(' ')); break;
      case 'plus_time': {
        const n = Number(req.minutes) > 0 ? Math.min(60, Number(req.minutes)) : 5;
        out.push(T.scenario(T.plusTime(n), tryPlan({ ...input, bottomTime: input.bottomTime + n })));
        break;
      }
      case 'plus_depth': {
        const n = Number(req.meters) > 0 ? Math.min(30, Number(req.meters)) : 3;
        out.push(T.scenario(T.plusDepth(n), tryPlan({ ...input, depth: input.depth + n })));
        break;
      }
      case 'lost_gas': {
        let name = null;
        try { name = parseGas(req.gas || '').name; } catch { name = null; }
        const q = name && sc().find((x) => x.key === 'LOST_GAS' && x.gas === name);
        if (q) out.push(T.scenario(T.lost(name), q));
        else if (name) out.push(T.notInPlan(name));
        else sc().filter((x) => x.key === 'LOST_GAS').forEach((x) => out.push(T.scenario(T.lost(x.gas), x)));
        break;
      }
      case 'max_bottom': out.push(T.maxBottom(maxBottomTime(input), input.runtimeLimit > 0 ? input.runtimeLimit : null, plan)); break;
      default: out.push(T[req.id](plan));
    }
  }
  return out.join(' ');
}
