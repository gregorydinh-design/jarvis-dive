// JARVIS DIVE — Moteur LLM optionnel (WebLLM dans Safari, via WebGPU).
// Chargé uniquement à la demande. La bibliothèque est mise en cache par le service worker,
// les poids du modèle par WebLLM lui-même : après un premier chargement en ligne, tout fonctionne hors ligne.

import { DIALOG_SCHEMA } from './llm.js';

export const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.85';

export const MODELS = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', size: '1,6 Go' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B', size: '0,9 Go' },
];

let lib = null;
let engine = null;
let loadedModel = null;

export const isAvailable = () => typeof navigator !== 'undefined' && 'gpu' in navigator;
export const isLoaded = () => !!engine;
export const currentModel = () => loadedModel;

// Trace pour diagnostiquer un onglet tué par iOS (mémoire) pendant le chargement.
const TRACE_KEY = 'jarvis-dive:llm-trace';
function trace(data) { try { localStorage.setItem(TRACE_KEY, JSON.stringify({ ...data, at: Date.now() })); } catch { /* */ } }
export function lastCrash() {
  try {
    const tr = JSON.parse(localStorage.getItem(TRACE_KEY));
    return tr && tr.stage !== 'ok' ? tr : null;
  } catch { return null; }
}

export async function loadModel(id, onProgress = () => {}) {
  if (!isAvailable()) throw new Error('WebGPU');
  if (!lib) {
    try { lib = await import(WEBLLM_URL); } catch { throw new Error('LIB'); }
  }
  if (engine) await unloadModel();
  trace({ model: id, stage: 'load' });
  engine = await lib.CreateMLCEngine(id, { initProgressCallback: (p) => onProgress(p.progress || 0, p.text || '') }, { context_window_size: 2048 });
  loadedModel = id;
  trace({ model: id, stage: 'ok' });
  return id;
}

export async function unloadModel() {
  if (engine) await engine.unload();
  engine = null;
  loadedModel = null;
}

/** Envoie la conversation au modèle et renvoie le texte JSON produit (format imposé). */
export async function dialog(messages) {
  if (!engine) throw new Error('NOT_LOADED');
  trace({ model: loadedModel, stage: 'infer' });
  const r = await engine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: 200,
    extra_body: { enable_thinking: false },
    response_format: { type: 'json_object', schema: DIALOG_SCHEMA },
  });
  trace({ model: loadedModel, stage: 'ok' });
  return r.choices[0].message.content || '';
}
