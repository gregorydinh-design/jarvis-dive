// JARVIS DIVE — Compréhension sans LLM des QUESTIONS (les commandes sont dans parser.js).
// Sert de référence au LLM, et de repli quand le LLM est absent ou se trompe de format.

import { normalize, parseCommand } from './parser.js';

const GAS_RE = /\b(?:(air)|(oxygene|oxygen|oxy|o2)|(?:nitrox|eanx|ean|nx)\s?(\d{2})|(?:trimix|tx)\s?(\d{1,2})\s?(?:\/|sur|\s)\s?(\d{1,2}))\b/;

function gasIn(s) {
  const m = s.match(GAS_RE);
  if (!m) return null;
  if (m[1]) return 'Air';
  if (m[2]) return 'O2';
  if (m[3]) return `EAN${m[3]}`;
  return `TX${m[4]}/${m[5]}`;
}

/** Faits demandés par une question ; tableau vide si ce n'est pas une question connue. */
export function parseQuestion(text) {
  const s = normalize(text);
  const f = [];
  const add = (id, extra = {}) => f.push({ id, ...extra });
  const isWhatIf = /\b(et si|et avec|si je|si on|what if|and with|if i|if we)\b/.test(s);

  const losing = /\b(perd|perds|perte|perdu|perdre|lose|lost|loses|panne)\b/.test(s) || (isWhatIf && /\b(sans|without|plus d|no)\b/.test(s));
  if (losing) {
    const g = gasIn(s);
    if (g || /\b(deco|gaz|gas|bloc|stage)\b/.test(s)) add('lost_gas', g ? { gas: g } : {});
  }
  const mt = isWhatIf && s.match(/\b(\d{1,3})\s?(?:minutes?|min|mn)\b/);
  if (mt) add('plus_time', { minutes: +mt[1] });
  const mm = isWhatIf && s.match(/\b(\d{1,3})\s?(?:metres?|meters?|m)\b/);
  if (mm) add('plus_depth', { meters: +mm[1] });
  if (/\b(suffi|suffisant|tient|tiens|assez|enough|reste|restera|left|bars?)\b/.test(s)) {
    if (/\b(fond|bottom|principal|dos)\b/.test(s)) { add('gas_bottom'); add('min_gas'); } else add('gas_all');
  }
  if (/\b(gaz mini|gas mini|minimum gas|rock bottom|demi tour|turn pressure)\b/.test(s)) add('min_gas');
  if (/\b(plus long|longest)\b/.test(s)) add('longest_stop');
  if (/\b(premier palier|first stop)\b/.test(s)) add('first_stop');
  else if (/\b(paliers|stops|deco)\b/.test(s) && !f.some((x) => x.id === 'lost_gas')) add('stops');
  if (/\b(dtr|tts|remontee|time to surface|ascent time)\b/.test(s)) add('tts');
  if (/\b(runtime|duree totale|total time|combien de temps)\b/.test(s)) add('runtime');
  if (/\b(cns|otu|toxicite|toxicity)\b/.test(s)) add('oxygen');
  if (/\b(change|changer|switch|switches|bascule)\b/.test(s)) add('switches');
  if (/\b(alerte|alertes|danger|probleme|risque|c est bon|ca passe|ok|safe|warning|warnings)\b/.test(s)) { add('alerts'); add('summary'); }
  if (/\b(ndl|sans palier|no stop|no deco|marge)\b/.test(s)) add('ndl');
  if (/\b(resume|lis|lire|recap|briefing|read|summary|donne moi le plan|le plan)\b/.test(s)) { add('summary'); add('stops'); }
  return f;
}

/**
 * Compréhension complète sans LLM : commandes + questions.
 * « et si j'ajoute 5 minutes ? » est une question (scénario), pas une commande.
 */
export function understand(text, state) {
  const facts = parseQuestion(text);
  const scenario = facts.some((x) => ['plus_time', 'plus_depth', 'lost_gas'].includes(x.id));
  const calls = scenario ? [] : parseCommand(text, state).calls.filter((c) => c.name !== 'get_plan');
  if (!facts.length && parseCommand(text, state).calls.some((c) => c.name === 'get_plan')) facts.push({ id: 'summary' }, { id: 'stops' });
  return { calls, facts };
}
