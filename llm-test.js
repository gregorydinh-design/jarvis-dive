// JARVIS DIVE — Banc d'essai LLM dans Safari (WebLLM + WebGPU)
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.85';
let webllm = null; // chargé à la demande : la page reste utilisable si la bibliothèque est injoignable
import { buildCommandMessages, readCalls, CALLS_SCHEMA, buildQuestionMessages } from './assistant/llm.js?v=053';
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

// ---------- Traces de plantage ----------
// Si iOS tue l'onglet (mémoire), on ne voit rien : on note l'étape en cours pour l'afficher au rechargement.
const TRACE_KEY = 'jarvis-llm:trace';
function trace(data) { try { localStorage.setItem(TRACE_KEY, JSON.stringify({ ...data, at: Date.now() })); } catch { /* */ } }
(() => {
  let tr = null;
  try { tr = JSON.parse(localStorage.getItem(TRACE_KEY)); } catch { tr = null; }
  if (tr && tr.stage !== 'ok') {
    $('crash').hidden = false;
    $('crash').textContent = `Le dernier essai s'est interrompu : ${tr.model}, pendant « ${tr.stage === 'infer' ? 'la génération' : tr.text || 'le chargement'} »`
      + (tr.progress != null ? ` (${Math.round(tr.progress * 100)} %)` : '') + '. Essayez un modèle plus petit.';
    const opt = [...$('model').options].find((o) => o.value === tr.model);
    if (opt && opt.previousElementSibling) opt.previousElementSibling.selected = true;
  }
})();

async function showStorage() {
  try {
    const e = await navigator.storage.estimate();
    $('storage').textContent = `Utilisé par cette page : ${(e.usage / 1073741824).toFixed(2)} Go (quota ${(e.quota / 1073741824).toFixed(1)} Go).`;
  } catch { $('storage').textContent = 'Estimation du stockage indisponible.'; }
}
showStorage();

$('clear').addEventListener('click', async () => {
  try {
    if (engine) { await engine.unload(); engine = null; }
    for (const k of await caches.keys()) if (/webllm|mlc/i.test(k)) await caches.delete(k);
    localStorage.removeItem(TRACE_KEY);
    $('crash').hidden = true;
  } catch (e) { $('storage').textContent = `Échec : ${e.message}`; return; }
  showStorage();
});

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
    trace({ model, stage: 'load', progress: 0 });
    let lastTrace = 0;
    engine = await webllm.CreateMLCEngine(model, {
      initProgressCallback: (p) => {
        $('bar').style.width = `${Math.round((p.progress || 0) * 100)}%`;
        $('loadInfo').textContent = p.text;
        if (Date.now() - lastTrace > 500) { trace({ model, stage: 'load', progress: p.progress, text: p.text }); lastTrace = Date.now(); }
      },
    }, { context_window_size: 2048 }); // contexte réduit : moins de mémoire (nos consignes font ~700 jetons)
    trace({ model, stage: 'ok' });
    $('crash').hidden = true;
    showStorage();
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
  trace({ model: currentModel, stage: 'infer' });
  const r = await engine.chat.completions.create(req);
  trace({ model: currentModel, stage: 'ok' });
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

// ---------------------------------------------------------------------------
// 5. Conversation vocale : le LLM comprend et choisit, JARVIS calcule et parle.
// ---------------------------------------------------------------------------
import { buildDialogMessages, readDialog, DIALOG_SCHEMA } from './assistant/llm.js?v=053';
import { understand } from './assistant/intents.js?v=053';
import { renderFacts } from './assistant/facts.js?v=053';

const CONV_START = {
  depth: 40, bottomTime: 25, gfLow: 85, gfHigh: 85,
  gases: [
    { mix: 'EAN27', switchDepth: null, volume: 24, startPressure: 200 },
    { mix: 'EAN47', switchDepth: 12, volume: 7, startPressure: 200 },
    { mix: 'O2', switchDepth: 6, volume: 7, startPressure: 200 },
  ],
};
let conv = structuredClone(CONV_START);
let history = [];

const toInput = (st) => ({
  depth: st.depth, bottomTime: st.bottomTime, gfLow: st.gfLow, gfHigh: st.gfHigh,
  gases: st.gases.map((g, i) => ({ ...parseGas(g.mix, i ? g.switchDepth : null), volume: g.volume, startPressure: g.startPressure })),
});

function showConvState() {
  $('convState').textContent = `Plan en cours : ${conv.depth} m, ${conv.bottomTime} min, GF ${conv.gfLow}/${conv.gfHigh}, `
    + conv.gases.map((g, i) => (i ? `${g.mix}@${g.switchDepth} m` : `${g.mix} (${g.volume} L)`)).join(', ');
}
showConvState();

function bubble(cls, text, meta = '') {
  $('convLog').insertAdjacentHTML('afterbegin', `<div class="bubble ${cls}">${esc(text)}${meta ? `<small>${esc(meta)}</small>` : ''}</div>`);
}

function speakFr(text) {
  if (!$('useVoice').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'fr-FR';
  speechSynthesis.speak(u);
}

/** Comprend une phrase : LLM si disponible et coché, sinon (ou en cas d'échec) l'analyseur. */
async function interpret(said, state, hist) {
  const fallback = understand(said, state);
  if (!engine || !$('useLlm').checked) return { ...fallback, note: '', source: 'analyseur', ms: 0 };
  try {
    const t0 = performance.now();
    trace({ model: currentModel, stage: 'infer' });
    const r = await engine.chat.completions.create({
      messages: buildDialogMessages(said, state, hist),
      temperature: 0,
      max_tokens: 200,
      extra_body: { enable_thinking: false },
      response_format: { type: 'json_object', schema: DIALOG_SCHEMA },
    });
    trace({ model: currentModel, stage: 'ok' });
    const out = readDialog(r.choices[0].message.content || '');
    const ms = performance.now() - t0;
    if (!out.calls.length && !out.facts.length && !out.note) return { ...fallback, note: '', source: 'analyseur (LLM vide)', ms };
    return { ...out, source: 'LLM', ms };
  } catch (e) {
    return { ...fallback, note: '', source: `analyseur (LLM : ${e.message})`, ms: 0 };
  }
}

/** Un tour de conversation complet : comprendre → appliquer → calculer → répondre. */
async function turn(said, state, hist) {
  const u = await interpret(said, state, hist);
  let next = state;
  const parts = [];
  if (u.calls.length) {
    try {
      const r = applyToolCalls(state, u.calls);
      next = r.state;
      if (r.changes.length) parts.push(`Compris : ${r.changes.map((c) => t(c.code, c.params)).join(', ')}.`);
    } catch (e) {
      const p = { ...e.params };
      if (p.field) p.field = t('f_' + p.field);
      parts.push(`Je ne peux pas : ${e.code && e.code.startsWith('x_') ? t(e.code, p) : e.code ? t('e_' + e.code, e.params) : e.message}.`);
    }
  }
  const facts = u.facts.length ? u.facts : (u.calls.length ? [{ id: 'summary' }] : []);
  if (u.note) parts.push(u.note);
  if (facts.length) {
    try {
      const input = toInput(next);
      parts.push(renderFacts(facts, { plan: planDive(input), input }, 'fr'));
    } catch (e) {
      parts.push(`Plan impossible : ${e.code ? t('e_' + e.code, e.params) : e.message}.`);
    }
  }
  if (!parts.length) parts.push("Je n'ai pas compris. Essaie par exemple : « mon gaz fond tient ? » ou « rajoute 5 minutes ».");
  return { state: next, reply: parts.join(' '), u };
}

async function onSaid(said) {
  said = String(said || '').trim();
  if (!said) return;
  bubble('me', said);
  $('convStatus').textContent = engine && $('useLlm').checked ? 'Réflexion du LLM…' : '';
  let r;
  try { r = await turn(said, conv, history); } catch (e) { $('convStatus').innerHTML = `<span class="ko">Erreur : ${esc(e.message || e)}</span>`; return; }
  $('convStatus').textContent = '';
  conv = r.state;
  history.push({ said, out: { calls: r.u.calls, facts: r.u.facts, note: r.u.note || '' } });
  history = history.slice(-3);
  showConvState();
  bubble('jarvis', r.reply, `${r.u.source}${r.u.ms ? ` · ${(r.u.ms / 1000).toFixed(1)} s` : ''}`);
  speakFr(r.reply);
}

$('convForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('convInput').value;
  $('convInput').value = '';
  $('convInput').blur();
  onSaid(v);
});
$('convReset').addEventListener('click', () => {
  conv = structuredClone(CONV_START);
  history = [];
  $('convLog').innerHTML = '';
  showConvState();
});

// Reconnaissance vocale de Safari (si disponible). Sinon : micro du clavier dans le champ texte.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
if (!SR) {
  $('talk').textContent = '🎙 Reconnaissance vocale indisponible : utilisez le micro du clavier';
  $('talk').disabled = true;
} else {
  $('talk').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    speechSynthesis.cancel(); // débloque aussi la synthèse vocale sur iOS (geste utilisateur)
    rec = new SR();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    $('talk').classList.add('on');
    $('talk').textContent = '● J\'écoute… (touchez pour arrêter)';
    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
        else interim += ev.results[i][0].transcript;
      }
      $('convInput').value = finalText || interim;
    };
    rec.onerror = (ev) => {
      bubble('jarvis', `Reconnaissance vocale : erreur « ${ev.error} »${ev.error === 'network' ? ' (réseau requis ?)' : ''}.`, 'système');
    };
    rec.onend = () => {
      $('talk').classList.remove('on');
      $('talk').textContent = '🎙 Parler';
      const said = finalText || $('convInput').value;
      $('convInput').value = '';
      rec = null;
      onSaid(said);
    };
    rec.start();
  });
}

// Banc : une conversation de 12 répliques enchaînées, notée réplique par réplique.
const DIALOG_BENCH = [
  { said: 'salut Jarvis', ok: (u) => !u.calls.length },
  { said: 'est-ce que mon gaz fond tient la route ?', ok: (u) => u.facts.some((f) => f.id === 'gas_bottom' || f.id === 'min_gas') },
  { said: "c'est quoi mon palier le plus long ?", ok: (u) => u.facts.some((f) => f.id === 'longest_stop' || f.id === 'stops') },
  { said: "et si je perds l'oxy ?", ok: (u) => u.facts.some((f) => f.id === 'lost_gas' && /o2|oxy/i.test(f.gas || '')) && !u.calls.length },
  { said: 'et avec dix minutes de plus ?', ok: (u) => u.facts.some((f) => f.id === 'plus_time' && f.minutes === 10) && !u.calls.length },
  { said: 'bon ok, rajoute cinq minutes', ok: (u, s) => s.bottomTime === 30 },
  { said: 'ça me fait sortir à combien de temps ?', ok: (u) => u.facts.some((f) => ['runtime', 'summary', 'tts'].includes(f.id)) },
  { said: "finalement l'épave est à 45 mètres", ok: (u, s) => s.depth === 45 },
  { said: 'il y a des alertes ?', ok: (u) => u.facts.some((f) => f.id === 'alerts') },
  { said: 'mets le fond en bi 15', ok: (u, s) => s.gases[0].volume === 30 },
  { said: 'où est-ce que je change de gaz ?', ok: (u) => u.facts.some((f) => f.id === 'switches') },
  { said: 'et mon CNS ?', ok: (u) => u.facts.some((f) => f.id === 'oxygen') },
];

$('convBench').addEventListener('click', async () => {
  $('convBench').disabled = true;
  conv = structuredClone(CONV_START);
  history = [];
  $('convLog').innerHTML = '';
  const mode = engine && $('useLlm').checked ? `LLM ${currentModel}` : 'analyseur sans LLM (aucun modèle chargé)';
  $('convStatus').textContent = `Test en cours avec ${mode}…`;
  let ok = 0;
  let total = 0;
  try {
  for (const [i, c] of DIALOG_BENCH.entries()) {
    $('convStatus').textContent = `Réplique ${i + 1}/12 : « ${c.said} »… (${mode})`;
    const t0 = performance.now();
    const r = await turn(c.said, conv, history);
    total += performance.now() - t0;
    const good = !!c.ok(r.u, r.state);
    if (good) ok++;
    conv = r.state;
    history.push({ said: c.said, out: { calls: r.u.calls, facts: r.u.facts, note: r.u.note || '' } });
    history = history.slice(-3);
    bubble('me', c.said);
    bubble('jarvis', r.reply, `${good ? '✔' : '✘'} ${r.u.source}${r.u.ms ? ` · ${(r.u.ms / 1000).toFixed(1)} s` : ''}`);
  }
  $('convStatus').textContent = '';
  $('convLog').insertAdjacentHTML('afterbegin', `<p><b>${ok}/12 répliques correctes</b> · ${(total / 12000).toFixed(1)} s par réplique · ${esc(mode)}</p>`);
  } catch (e) {
    $('convStatus').innerHTML = `<span class="ko">Test interrompu : ${esc(e.message || e)}</span>`;
  } finally {
    showConvState();
    $('convBench').disabled = false;
  }
});
