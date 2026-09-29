// JARVIS DIVE — Pont LLM : consignes, schéma de sortie et lecture de la réponse.
// Indépendant du moteur d'inférence (WebLLM dans Safari aujourd'hui, autre chose demain) :
// on fournit des messages au format OpenAI et on relit un JSON { calls: [...] }.
// Les appels proposés passent ensuite par applyToolCalls (validation) : le LLM ne touche jamais au formulaire.

import { TOOL_NAMES } from './commands.js';

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
