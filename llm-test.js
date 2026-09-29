// JARVIS DIVE — Banc d'essai LLM dans Safari (WebLLM + WebGPU)
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.85';
let webllm = null; // chargé à la demande : la page reste utilisable si la bibliothèque est injoignable
import { buildCommandMessages, readCalls, CALLS_SCHEMA, buildQuestionMessages } from './assistant/llm.js';
import { applyToolCalls } from './assistant/commands.js';
import { parseCommand } from './assistant/parser.js';
import { planSummary } from './assistant/summary.js';
import { planDive } from './engine/planner.js';
import { parseGas } from './engine/gases.js';
import { makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const t = makeT('fr');
let engine = null;
let currentModel = null;

const BASE = {
  depth: 40, bottomTime: 18, gfLow: 85, gfHigh: 85,
  gases: [
    { mix: 'Air', switchDepth: null, volume: 12, startPressure: 200 },
    { mix: 'O2', switchDepth: 6, volume: 7, startPressure: 200 },
  ],
};

// 10 phrases : les 5 premières sont gérées par l'analyseur sans LLM, les 5 suivantes sont en langage libre.
const CASES = [
  { said: '40 mètres 25 minutes EAN27, EAN47 à 12, oxygène à 6', expect: { depth: 40, bottomTime: 25, gases: 'EAN27 EAN47@12 O2@6' } },
  { said: 'ajoute 5 minutes', expect: { bottomTime: 23 } },
  { said: '3 mètres de plus', expect: { depth: 43 } },
  { said: 'bloc fond bi 12', expect: { bottomVolume: 24 } },
  { said: 'GF 30 sur 85', expect: { gfLow: 30, gfHigh: 85 } },
  { said: "on descend sur l'épave à 42 mètres et on y reste une vingtaine de minutes", expect: { depth: 42, bottomTime: 20 } },
  { said: 'mets-moi du nitrox 50 pour la déco', expect: { gases: 'Air EAN50@* O2@6' } },
  { said: 'on part au 32 à 30 mètres pour 40 minutes', expect: { depth: 30, bottomTime: 40, gases: 'EAN32 O2@6' } },
  { said: "vire l'oxy, on n'en a pas aujourd'hui", expect: { gases: 'Air' } },
  { said: "Let's do 35 meters for half an hour", expect: { depth: 35, bottomTime: 30 } },
];

function gasesString(st) {
  return st.gases.map((g, i) => (i === 0 ? g.mix : `${g.mix}@${g.switchDepth}`)).join(' ');
}

function checkExpect(st, expect) {
  const bad = [];
  if (expect.depth !== undefined && st.depth !== expect.depth) bad.push(`profondeur ${st.depth}`);
  if (expect.bottomTime !== undefined && st.bottomTime !== expect.bottomTime) bad.push(`temps ${st.bottomTime}`);
  if (expect.gfLow !== undefined && (st.gfLow !== expect.gfLow || st.gfHigh !== expect.gfHigh)) bad.push(`GF ${st.gfLow}/${st.gfHigh}`);
  if (expect.bottomVolume !== undefined && st.gases[0].volume !== expect.bottomVolume) bad.push(`bloc ${st.gases[0].volume} L`);
  if (expect.gases !== undefined) {
    const got = gasesString(st);
    const re = new RegExp(`^${expect.gases.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '\\d+' : `\\${c}`))}$`);
    if (!re.test(got)) bad.push(`gaz ${got}`);
  }
  return bad;
}

// ---------- 1. Appareil ----------
(async () => {
  if (!('gpu' in navigator)) {
    $('gpu').innerHTML = '<span class="ko">WebGPU indisponible dans ce navigateur.</span> Il faut Safari sur iOS 26 ou plus.';
    $('load').disabled = true;
    return;
  }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('aucun adaptateur');
    const info = adapter.info || {};
    const f16 = adapter.features.has('shader-f16');
    $('gpu').innerHTML = `<span class="ok">WebGPU disponible.</span> ${esc([info.vendor, info.architecture].filter(Boolean).join(' '))}
      · shader-f16 : ${f16 ? 'oui' : '<span class="ko">non</span> (prendre un modèle q4f32)'}
      · tampon max ${Math.round(adapter.limits.maxBufferSize / 1048576)} Mo`;
    $('load').disabled = false;
  } catch (e) {
    $('gpu').innerHTML = `<span class="ko">WebGPU présent mais inutilisable : ${esc(e.message)}</span>`;
    $('load').disabled = true;
  }
})();

// ---------- 2. Chargement ----------
$('load').addEventListener('click', async () => {
  const model = $('model').value;
  $('load').disabled = true;
  const t0 = performance.now();
  try {
    if (!webllm) {
      $('loadInfo').textContent = 'Chargement de la bibliothèque WebLLM…';
      try { webllm = await import(WEBLLM_URL); } catch { throw new Error('bibliothèque WebLLM injoignable (réseau requis au premier lancement)'); }
    }
    if (engine) await engine.unload();
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => {
        $('bar').style.width = `${Math.round((p.progress || 0) * 100)}%`;
        $('loadInfo').textContent = p.text;
      },
    });
    currentModel = model;
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    $('loadInfo').innerHTML = `<span class="ok">${esc(model)} prêt en ${s} s.</span>`;
    ['runCmd', 'bench', 'ask'].forEach((id) => { $(id).disabled = false; });
  } catch (e) {
    $('loadInfo').innerHTML = `<span class="ko">Échec : ${esc(e.message)}</span>`;
  } finally {
    $('load').disabled = false;
  }
});

async function complete(messages, { json = false, maxTokens = 256 } = {}) {
  const t0 = performance.now();
  const req = {
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    extra_body: { enable_thinking: false },
  };
  if (json) req.response_format = { type: 'json_object', schema: CALLS_SCHEMA };
  const r = await engine.chat.completions.create(req);
  const ms = performance.now() - t0;
  const u = r.usage || {};
  return {
    content: r.choices[0].message.content || '',
    ms,
    stats: `${(ms / 1000).toFixed(1)} s · ${u.prompt_tokens ?? '?'} jetons lus · ${u.completion_tokens ?? '?'} écrits`
      + (u.extra && u.extra.decode_tokens_per_s ? ` · ${u.extra.decode_tokens_per_s.toFixed(1)} jetons/s` : ''),
  };
}

async function translate(said, state) {
  const r = await complete(buildCommandMessages(said, state), { json: true });
  let calls = [];
  let error = null;
  let result = null;
  try {
    calls = readCalls(r.content);
    result = applyToolCalls(state, calls);
  } catch (e) {
    error = e.code ? `${e.code} ${JSON.stringify(e.params || {})}` : e.message;
  }
  return { ...r, calls, error, result };
}

// ---------- 3. Commande ----------
$('runCmd').addEventListener('click', async () => {
  const said = $('cmd').value.trim();
  $('cmdOut').innerHTML = '<p class="stats">Réflexion…</p>';
  $('runCmd').disabled = true;
  try {
    const r = await translate(said, BASE);
    const ref = parseCommand(said, BASE).calls;
    $('cmdOut').innerHTML = `
      <p class="stats">${esc(r.stats)}</p>
      <b>LLM</b><pre>${esc(JSON.stringify(r.calls, null, 1))}</pre>
      ${r.error ? `<p class="ko">Refusé par JARVIS : ${esc(r.error)}</p>`
        : `<p class="ok">Résultat : ${esc(r.result.state.depth)} m, ${esc(r.result.state.bottomTime)} min, ${esc(gasesString(r.result.state))}</p>`}
      <b>Analyseur sans LLM (référence)</b><pre>${esc(JSON.stringify(ref, null, 1))}</pre>`;
  } catch (e) {
    $('cmdOut').innerHTML = `<p class="ko">${esc(e.message)}</p>`;
  } finally {
    $('runCmd').disabled = false;
  }
});

// ---------- Banc de 10 phrases ----------
$('bench').addEventListener('click', async () => {
  $('bench').disabled = true;
  const out = $('cmdOut');
  out.innerHTML = `<p class="stats">Modèle ${esc(currentModel)} — 10 phrases…</p>`;
  let llmOk = 0;
  let parserOk = 0;
  let totalMs = 0;
  for (const [i, c] of CASES.entries()) {
    const r = await translate(c.said, BASE);
    totalMs += r.ms;
    const llmBad = r.error ? [r.error] : checkExpect(r.result.state, c.expect);
    let parserBad;
    try { parserBad = checkExpect(applyToolCalls(BASE, parseCommand(c.said, BASE).calls).state, c.expect); } catch (e) { parserBad = [e.code || e.message]; }
    if (!llmBad.length) llmOk++;
    if (!parserBad.length) parserOk++;
    out.insertAdjacentHTML('beforeend', `<div class="case">${i + 1}. « ${esc(c.said)} »<br>
      <b>LLM</b> <span class="${llmBad.length ? 'ko' : 'ok'}">${llmBad.length ? '✘ ' + esc(llmBad.join(', ')) : '✔'}</span> (${(r.ms / 1000).toFixed(1)} s)
      · <b>sans LLM</b> <span class="${parserBad.length ? 'ko' : 'ok'}">${parserBad.length ? '✘' : '✔'}</span></div>`);
  }
  out.insertAdjacentHTML('afterbegin', `<p><b>LLM : ${llmOk}/10</b> · analyseur sans LLM : ${parserOk}/10 · ${(totalMs / 10000).toFixed(1)} s par phrase en moyenne</p>`);
  $('bench').disabled = false;
});

// ---------- 4. Question ----------
$('ask').addEventListener('click', async () => {
  $('askOut').innerHTML = '<p class="stats">Réflexion…</p>';
  $('ask').disabled = true;
  try {
    const st = { ...BASE, bottomTime: 25, gases: [{ mix: 'EAN27', volume: 24, startPressure: 200 }, { mix: 'EAN47', switchDepth: 12, volume: 7, startPressure: 200 }, { mix: 'O2', switchDepth: 6, volume: 7, startPressure: 200 }] };
    const plan = planDive({
      depth: st.depth, bottomTime: st.bottomTime, gfLow: st.gfLow, gfHigh: st.gfHigh,
      gases: st.gases.map((g, i) => ({ ...parseGas(g.mix, i ? g.switchDepth : null), volume: g.volume, startPressure: g.startPressure })),
    });
    const planText = planSummary(plan, t) + ` Gaz minimum ${Math.round(plan.minGas.bar)} bar en fin de fond, prévu ${Math.round(plan.minGas.pressureAtBottomEnd)} bar.`;
    const r = await complete(buildQuestionMessages($('question').value, planText), { maxTokens: 200 });
    $('askOut').innerHTML = `<p class="stats">${esc(r.stats)}</p><pre>${esc(r.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim())}</pre>
      <details><summary class="stats">Plan fourni au modèle</summary><pre>${esc(planText)}</pre></details>`;
  } catch (e) {
    $('askOut').innerHTML = `<p class="ko">${esc(e.message)}</p>`;
  } finally {
    $('ask').disabled = false;
  }
});
