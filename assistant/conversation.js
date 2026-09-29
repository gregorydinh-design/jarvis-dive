// JARVIS DIVE — Compréhension hybride d'une phrase.
// 1. L'analyseur sans LLM d'abord : instantané, hors ligne, testé.
// 2. Le LLM seulement si l'analyseur ne comprend rien (phrase très libre), et s'il est chargé.
// Dans les deux cas, la sortie est la même : { calls, facts, note } — JARVIS applique, calcule et parle.

import { understand } from './intents.js';
import { buildDialogMessages, readDialog } from './llm.js';

/**
 * @param {string} said phrase du plongeur
 * @param {object} state état du formulaire (voir commands.js)
 * @param {Array} history derniers échanges [{ said, out }]
 * @param {Function|null} llmDialog async (messages) => texte JSON, ou null si pas de LLM
 */
export async function interpret(said, state, history = [], llmDialog = null) {
  const parsed = understand(said, state);
  if (parsed.calls.length || parsed.facts.length) return { ...parsed, note: '', source: 'parser', ms: 0 };
  if (!llmDialog) return { ...parsed, note: '', source: 'parser', ms: 0 };
  const t0 = Date.now();
  try {
    const out = readDialog(await llmDialog(buildDialogMessages(said, state, history)));
    return { ...out, source: 'llm', ms: Date.now() - t0 };
  } catch {
    return { ...parsed, note: '', source: 'parser', ms: Date.now() - t0 };
  }
}
