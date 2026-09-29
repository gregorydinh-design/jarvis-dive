// JARVIS DIVE — Pont LLM : consignes, schéma de sortie et lecture de la réponse.
// Indépendant du moteur d'inférence (WebLLM dans Safari aujourd'hui, autre chose demain) :
// on fournit des messages au format OpenAI et on relit un JSON { calls: [...] }.
// Les appels proposés passent ensuite par applyToolCalls (validation) : le LLM ne touche jamais au formulaire.

import { TOOL_NAMES } from './commands.js';
import { FACT_IDS } from './facts.js';

// Schéma imposé à la génération (sortie contrainte) : le modèle ne peut produire que ce format.
export const CALLS_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    calls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: TOOL_NAMES },
          args: {
            type: 'object',
            properties: {
              depth: { type: 'number' },
              bottom_time: { type: 'number' },
              add_depth: { type: 'number' },
              add_time: { type: 'number' },
              low: { type: 'number' },
              high: { type: 'number' },
              mix: { type: 'string' },
              switch_depth: { type: 'number' },
              gas: { type: 'string' },
              volume: { type: 'number' },
              pressure: { type: 'number' },
            },
          },
        },
        required: ['name', 'args'],
      },
    },
  },
  required: ['calls'],
});

const SYSTEM_FR = `Tu convertis la phrase d'un plongeur en actions pour le planificateur JARVIS. Tu ne calcules jamais rien.
Réponds uniquement en JSON : {"calls":[{"name":...,"args":{...}}]}.
Actions :
- set_dive {depth, bottom_time, add_depth, add_time} : mètres et minutes ; add_* = ajustement relatif (négatif pour retirer).
- set_gf {low, high} : gradient factors en %.
- set_bottom_gas {mix} : gaz respiré au fond.
- add_deco_gas {mix, switch_depth} : gaz de déco (riche en oxygène, 40 % ou plus) ; switch_depth seulement s'il est dit.
- remove_gas {mix}
- set_cylinder {gas, volume, pressure} : gas = mélange ou "bottom" ; "bi 12" = 24 litres.
- get_plan {} : le plongeur veut entendre le plan.
Mélanges : "Air", "EAN32" (nitrox 32, "du 32"), "O2" (oxygène, oxy), "TX18/45" (trimix). "une vingtaine" = 20, "une demi-heure" = 30.
N'ajoute que ce que la phrase demande.`;

const EXAMPLES = [
  ['État : 40 m, 20 min, GF 85/85, gaz : Air (fond).',
    '35 mètres 25 minutes au nitrox 32 avec de l\'oxygène à 6',
    { calls: [{ name: 'set_dive', args: { depth: 35, bottom_time: 25 } }, { name: 'set_bottom_gas', args: { mix: 'EAN32' } }, { name: 'add_deco_gas', args: { mix: 'O2', switch_depth: 6 } }] }],
  ['État : 35 m, 25 min, GF 85/85, gaz : EAN32 (fond), O2 @6 m.',
    'rajoute cinq minutes et mets un bi 12',
    { calls: [{ name: 'set_dive', args: { add_time: 5 } }, { name: 'set_cylinder', args: { gas: 'bottom', volume: 24 } }] }],
];

export function describeState(st) {
  const gases = st.gases.map((g, i) => (i === 0 ? `${g.mix} (fond)` : `${g.mix} @${g.switchDepth} m`)).join(', ');
  return `État : ${st.depth} m, ${st.bottomTime} min, GF ${st.gfLow}/${st.gfHigh}, gaz : ${gases}.`;
}

export function buildCommandMessages(text, state) {
  const messages = [{ role: 'system', content: SYSTEM_FR }];
  for (const [st, said, out] of EXAMPLES) {
    messages.push({ role: 'user', content: `${st}\nPhrase : ${said}` });
    messages.push({ role: 'assistant', content: JSON.stringify(out) });
  }
  messages.push({ role: 'user', content: `${describeState(state)}\nPhrase : ${text}` });
  return messages;
}

/** Relit la réponse du modèle ; ne garde que des appels d'outils connus. */
export function readCalls(content) {
  const txt = String(content).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  const obj = JSON.parse(txt.slice(start, end + 1));
  return (obj.calls || [])
    .filter((c) => c && TOOL_NAMES.includes(c.name))
    .map((c) => ({ name: c.name, args: Object.fromEntries(Object.entries(c.args || {}).filter(([, v]) => v !== null && v !== undefined && v !== '')) }));
}

export function buildQuestionMessages(question, planText) {
  // Les petits modèles ignorent souvent la consigne système : le plan est placé dans le message lui-même.
  return [
    {
      role: 'system',
      content: 'Tu es JARVIS, assistant de plongée technique. Tu réponds en français, en 3 phrases maximum, uniquement avec les chiffres du plan fourni. Tu ne recalcules jamais rien.',
    },
    {
      role: 'user',
      content: `Voici mon plan de plongée, calculé par JARVIS :
${planText}

En t'appuyant uniquement sur ce plan, réponds à ma question : ${question}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Mode conversation : le LLM comprend et CHOISIT (commandes + faits), JARVIS calcule et parle.
// ---------------------------------------------------------------------------
const CALL_ITEM = JSON.parse(CALLS_SCHEMA).properties.calls.items;

export const DIALOG_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    calls: { type: 'array', items: CALL_ITEM },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: FACT_IDS },
          gas: { type: 'string' },
          minutes: { type: 'number' },
          meters: { type: 'number' },
        },
        required: ['id'],
      },
    },
    note: { type: 'string' },
  },
  required: ['calls', 'facts', 'note'],
});

const DIALOG_SYSTEM = `Tu es l'oreille de JARVIS, planificateur de plongée. Le plongeur te parle librement.
Tu ne réponds JAMAIS avec des chiffres : tu choisis ce que JARVIS doit faire et dire. JARVIS calcule et parle.
Réponds uniquement en JSON : {"calls":[...],"facts":[...],"note":"..."}.

calls = modifications du plan :
- set_dive {depth, bottom_time, add_depth, add_time}
- set_gf {low, high}
- set_bottom_gas {mix} ; add_deco_gas {mix, switch_depth} ; remove_gas {mix}
- set_cylinder {gas, volume, pressure} ("bottom" = bloc fond ; bi 12 = 24)

facts = informations à annoncer :
- summary : résumé du plan ; stops : tous les paliers ; first_stop ; longest_stop
- tts : durée de remontée ; runtime : durée totale
- gas_bottom : gaz fond restant ; gas_all : tous les blocs ; min_gas : gaz minimum (sécurité)
- oxygen : CNS et OTU ; switches : changements de gaz ; alerts : alertes ; ndl : marge sans palier
- plus_time {minutes} : « et si je reste N minutes de plus ? » (question, sans modifier le plan)
- plus_depth {meters} : « et si je descends N mètres plus bas ? »
- lost_gas {gas} : « et si je perds tel gaz ? »

note = phrase courte SANS AUCUN CHIFFRE (salutation, ou "je n'ai pas compris"), sinon "".
Après une modification du plan, ajoute toujours le fait "summary".
Mélanges : "Air", "EAN32", "O2" (oxygène, oxy), "TX18/45".`;

const DIALOG_EXAMPLES = [
  ['est-ce que mon gaz fond tient ?', { calls: [], facts: [{ id: 'gas_bottom' }, { id: 'min_gas' }], note: '' }],
  ["et si je perds l'oxy ?", { calls: [], facts: [{ id: 'lost_gas', gas: 'O2' }], note: '' }],
  ['ok rajoute cinq minutes', { calls: [{ name: 'set_dive', args: { add_time: 5 } }], facts: [{ id: 'summary' }], note: '' }],
  ['et avec dix minutes de plus ça donne quoi ?', { calls: [], facts: [{ id: 'plus_time', minutes: 10 }], note: '' }],
  ['salut Jarvis', { calls: [], facts: [], note: "Salut, je t'écoute." }],
];

/**
 * @param {string} text phrase du plongeur
 * @param {object} state état du formulaire
 * @param {Array<{said, out}>} history derniers échanges (out = JSON produit)
 */
export function buildDialogMessages(text, state, history = []) {
  const messages = [{ role: 'system', content: DIALOG_SYSTEM }];
  for (const [said, out] of DIALOG_EXAMPLES) {
    messages.push({ role: 'user', content: said });
    messages.push({ role: 'assistant', content: JSON.stringify(out) });
  }
  for (const h of history.slice(-3)) {
    messages.push({ role: 'user', content: h.said });
    messages.push({ role: 'assistant', content: JSON.stringify(h.out) });
  }
  messages.push({ role: 'user', content: `${describeState(state)}\n${text}` });
  return messages;
}

/** Relit la réponse : appels connus, faits connus, note sans chiffre. */
export function readDialog(content) {
  const txt = String(content).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const obj = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  const calls = readCalls(JSON.stringify({ calls: obj.calls || [] }));
  const facts = (obj.facts || [])
    .filter((f) => f && FACT_IDS.includes(f.id))
    .map((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== null && v !== undefined && v !== '')));
  let note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (/\d/.test(note)) note = ''; // garde-fou : aucun chiffre ne vient du modèle
  return { calls, facts, note };
}
