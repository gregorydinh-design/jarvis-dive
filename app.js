// JARVIS DIVE — Interface (le calcul est entièrement délégué au moteur)
import { planDive } from './engine/planner.js';
import { parseGas, defaultSwitchDepth, mod } from './engine/gases.js';
import { createEnvironment } from './engine/zhl16c.js';
import { contingencyPlans, withPreviousDive, maxBottomTime } from './engine/scenarios.js';
import { detectLang, saveLang, makeT } from './i18n.js';
import { applyToolCalls } from './assistant/commands.js';
import { planSummary } from './assistant/summary.js';
import { interpret } from './assistant/conversation.js';
import { renderFacts } from './assistant/facts.js';
import * as llm from './assistant/llm-engine.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'jarvis-dive:v3';
const NUM_FIELDS = ['depth', 'bottomTime', 'gfLow', 'gfHigh', 'descentRate', 'ascentRate', 'lastStop',
  'switchStopMin', 'ppO2Bottom', 'waterDensity', 'sacBottom', 'sacDeco',
  'reservePressure', 'minGasDivers', 'minGasStressFactor', 'minGasProblemMin', 'surfaceInterval', 'runtimeLimit'];
const CYL_BOTTOM = { vol: 12, bar: 200 };
const CYL_DECO = { vol: 7, bar: 200 };
const DEFAULT_GASES = [{ mix: 'Air', depth: '', ...CYL_BOTTOM }];

let lang = detectLang();
let t = makeT(lang);
let previousDive = null; // configuration de la plongée n°1 (plongée successive)

const gasList = $('gases');
const tpl = $('gasRow');
const gfBtn = $('gfBtn');
const gfPanel = $('gfPanel');

const fmt = (x, d = 0) => Number(x).toFixed(d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rows = () => [...gasList.children];

function env() {
  return createEnvironment({ waterDensity: parseFloat($('waterDensity').value) || 1.03 });
}

// ---------- Gaz ----------
function addGasRow({ mix, depth, auto = true, vol, bar }) {
  const row = tpl.content.firstElementChild.cloneNode(true);
  const mixInput = row.querySelector('.gas-mix');
  const depthInput = row.querySelector('.gas-depth');
  const first = gasList.children.length === 0;
  const defCyl = first ? CYL_BOTTOM : CYL_DECO;
  row.cyl = { vol: vol ?? defCyl.vol, bar: bar ?? defCyl.bar };
  mixInput.value = mix;
  depthInput.value = depth;
  depthInput.dataset.auto = auto ? '1' : '0';
  mixInput.addEventListener('input', () => {
    if (depthInput.dataset.auto === '1') {
      try { depthInput.value = defaultSwitchDepth(parseGas(mixInput.value), env()); } catch { /* saisie en cours */ }
    }
    refreshCylinderLabels();
    update();
  });
  depthInput.addEventListener('input', () => { depthInput.dataset.auto = '0'; update(); });
  row.querySelector('.gas-del').addEventListener('click', () => {
    row.remove();
    refreshRoles();
    renderCylinders();
    update();
  });
  gasList.appendChild(row);
  refreshRoles();
}

function refreshRoles() {
  rows().forEach((row, i) => {
    row.classList.toggle('bottom', i === 0);
    row.querySelector('.gas-role-name').textContent = i === 0 ? t('roleBottom') : t('roleDeco');
    row.querySelector('.gas-switch-label').textContent = t('switchLabel');
    row.querySelector('.gas-mix').setAttribute('aria-label', t('mixLabel'));
    row.querySelector('.gas-depth').setAttribute('aria-label', t('switchDepthLabel'));
    row.querySelector('.gas-del').setAttribute('aria-label', t('remove'));
    if (i === 0 && !row.contains(gfBtn)) row.append(gfBtn, gfPanel);
  });
}

// ---------- Blocs (réglages avancés) ----------
function cylinderTitle(i) {
  return i === 0 ? t('cylBottom') : t('cylDeco', { n: i });
}

function renderCylinders() {
  const box = $('cylinders');
  box.innerHTML = '';
  rows().forEach((row, i) => {
    const el = document.createElement('div');
    el.className = 'cyl';
    el.innerHTML = `
      <div class="cyl-name">${esc(cylinderTitle(i))}<small>${esc(row.querySelector('.gas-mix').value)}</small></div>
      <label>${esc(t('volume'))} <span class="unit">L</span><input class="cyl-vol" type="number" inputmode="decimal" min="1" step="1" value="${row.cyl.vol}"></label>
      <label>${esc(t('startPressure'))} <span class="unit">bar</span><input class="cyl-bar" type="number" inputmode="numeric" min="1" step="10" value="${row.cyl.bar}"></label>`;
    el.querySelector('.cyl-vol').addEventListener('input', (e) => { row.cyl.vol = parseFloat(e.target.value); update(); });
    el.querySelector('.cyl-bar').addEventListener('input', (e) => { row.cyl.bar = parseFloat(e.target.value); update(); });
    box.appendChild(el);
  });
}

function refreshCylinderLabels() {
  const els = [...$('cylinders').children];
  rows().forEach((row, i) => {
    const small = els[i] && els[i].querySelector('.cyl-name small');
    if (small) small.textContent = row.querySelector('.gas-mix').value;
  });
}

// ---------- GF ----------
function refreshGfButton() {
  gfBtn.textContent = `GF ${$('gfLow').value || '?'}/${$('gfHigh').value || '?'}`;
  gfBtn.setAttribute('aria-label', `${gfBtn.textContent} — ${t('gfButton')}`);
}
gfBtn.addEventListener('click', () => {
  const open = gfPanel.hidden;
  gfPanel.hidden = !open;
  gfBtn.setAttribute('aria-expanded', String(open));
  if (open) $('gfLow').focus();
});

// ---------- Langue ----------
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)));
  refreshVoiceButton();
  if (typeof refreshTalkButton === 'function') { refreshTalkButton(); refreshLlmPanel(); }
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  refreshRoles();
  renderCylinders();
  renderPrevious();
}

function errorText(e) {
  if (e && e.code && e.code.startsWith('x_')) {
    const p = { ...e.params };
    if (p.field) p.field = t('f_' + p.field);
    return t(e.code, p);
  }
  return e && e.code ? t('e_' + e.code, e.params) : String(e && e.message ? e.message : e);
}

// ---------- Lecture de la configuration ----------
function readGases() {
  return rows().map((row, i) => {
    const mixInput = row.querySelector('.gas-mix');
    const depthInput = row.querySelector('.gas-depth');
    try {
      const gas = parseGas(mixInput.value, i === 0 ? null : parseFloat(depthInput.value));
      if (i > 0 && !(gas.switchDepth >= 0)) throw Object.assign(new Error('SWITCH_MISSING'), { code: 'SWITCH_MISSING', params: { gas: gas.name } });
      mixInput.classList.remove('invalid');
      return { ...gas, volume: row.cyl.vol, startPressure: row.cyl.bar };
    } catch (e) {
      mixInput.classList.add('invalid');
      throw e;
    }
  });
}

function readConfig() {
  const cfg = {};
  for (const f of NUM_FIELDS) cfg[f] = parseFloat($(f).value);
  cfg.gases = readGases();
  return cfg;
}

// ---------- Plongée successive ----------
function renderPrevious() {
  $('setPrev').hidden = !!previousDive;
  $('prevBox').hidden = !previousDive;
  if (!previousDive) return;
  $('prevDesc').textContent = t('prevDesc', {
    depth: previousDive.depth,
    time: previousDive.bottomTime,
    gases: previousDive.gases.map((g) => g.name).join(' + '),
    gf: `${previousDive.gfLow}/${previousDive.gfHigh}`,
  });
}

$('setPrev').addEventListener('click', () => {
  try {
    previousDive = readConfig();
    renderPrevious();
    update();
  } catch { /* configuration invalide : rien à enregistrer */ }
});
$('clearPrev').addEventListener('click', () => {
  previousDive = null;
  renderPrevious();
  update();
});

// ---------- Sauvegarde ----------
function save() {
  try {
    const data = { fields: {}, gases: [], previousDive };
    for (const f of NUM_FIELDS) data.fields[f] = $(f).value;
    data.gases = rows().map((row) => ({
      mix: row.querySelector('.gas-mix').value,
      depth: row.querySelector('.gas-depth').value,
      auto: row.querySelector('.gas-depth').dataset.auto === '1',
      vol: row.cyl.vol,
      bar: row.cyl.bar,
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* stockage indisponible : sans conséquence */ }
}

function restore() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { data = null; }
  if (data && data.fields) for (const f of NUM_FIELDS) if (data.fields[f] != null && $(f)) $(f).value = data.fields[f];
  (data && data.gases && data.gases.length ? data.gases : DEFAULT_GASES).forEach(addGasRow);
  previousDive = (data && data.previousDive) || null;
}

// ---------- Rendu ----------
function profileSvg(plan) {
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 24;
  const maxT = plan.runtime, maxD = plan.input.depth;
  const x = (v) => L + (v / maxT) * (W - L - R);
  const y = (d) => T + (d / maxD) * (H - T - B);
  const pts = [[0, 0]];
  plan.segments.forEach((s) => { if (s.duration > 0) pts.push([s.runtime, s.to]); });
  const path = pts.map(([a, d], i) => `${i ? 'L' : 'M'}${x(a).toFixed(1)},${y(d).toFixed(1)}`).join(' ');
  const gridD = [0, Math.round(maxD / 2), maxD];
  const labels = plan.stops.map((s) => `<text x="${x(s.runtime - s.duration / 2).toFixed(1)}" y="${(y(s.depth) - 6).toFixed(1)}" text-anchor="middle" font-size="11" fill="#8fb0c4">${s.duration}'</text>`).join('');
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('profileAria')}">
    ${gridD.map((d) => `<line x1="${L}" x2="${W - R}" y1="${y(d)}" y2="${y(d)}" stroke="#1f4663" stroke-width="1"/><text x="${L - 6}" y="${y(d) + 4}" text-anchor="end" font-size="11" fill="#6d8ea3">${d}</text>`).join('')}
    <path d="${path} L${x(maxT)},${y(0)} L${x(0)},${y(0)} Z" fill="rgba(56,217,200,0.10)"/>
    <path d="${path}" fill="none" stroke="#38d9c8" stroke-width="2.5" stroke-linejoin="round"/>
    ${labels}
    <text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="11" fill="#6d8ea3">${fmt(maxT)} min</text>
  </svg>`;
}

const isLow = (g, reserve) => Number.isFinite(g.endPressure) && g.endPressure < reserve;
const barText = (p) => `${fmt(Math.max(0, p))} bar`;

function updateBadges(plan, reserve) {
  rows().forEach((row, i) => {
    const badge = row.querySelector('.gas-left');
    const g = plan && plan.gases[i];
    if (!g || !Number.isFinite(g.endPressure)) { badge.textContent = ''; badge.classList.remove('low'); return; }
    badge.textContent = barText(g.endPressure);
    badge.classList.toggle('low', isLow(g, reserve));
  });
}

function stopsCompact(plan) {
  return plan.stops.map((s) => `${s.depth}m ${s.duration}'`).join(' · ') || '—';
}

function contingencyTable(cfg) {
  const scenarios = contingencyPlans(cfg);
  const body = scenarios.map((sc) => {
    const label = esc(t('sc_' + sc.key, sc));
    if (sc.error) return `<tr class="sc-danger"><td>${label}</td><td colspan="3" class="low">${esc(errorText(sc.error))}</td></tr>`;
    const p = sc.plan;
    const withCyl = p.gases.filter((g) => Number.isFinite(g.endPressure));
    const lowest = withCyl.reduce((m, g) => (!m || g.endPressure < m.endPressure ? g : m), null);
    const danger = p.warnings.some((w) => w.level === 'danger');
    const lowCell = lowest
      ? `<td class="num ${isLow(lowest, cfg.reservePressure) ? 'low' : ''}">${barText(lowest.endPressure)}<span class="sc-stops">${esc(lowest.name)}</span></td>`
      : '<td class="num">—</td>';
    return `<tr class="${danger ? 'sc-danger' : ''}"><td>${label}<span class="sc-stops">${esc(stopsCompact(p))}</span></td>
      <td class="num">${fmt(p.tts)}</td><td class="num">${fmt(p.runtime)}</td>${lowCell}</tr>`;
  }).join('');
  return `<table><thead><tr><th>${t('scenario')}</th><th class="num">${t('tts').replace(' min', '')}</th><th class="num">Runtime</th><th class="num">${t('minLeft')}</th></tr></thead><tbody>${body}</tbody></table>`;
}

function maxBottomLine(cfg) {
  const m = maxBottomTime(cfg);
  if (m.max == null) return '';
  const over = cfg.bottomTime > m.max;
  let html = cfg.runtimeLimit > 0 ? t('maxBottomRuntime', { limit: cfg.runtimeLimit, mb: m.max }) : t('maxBottomGas', { mb: m.max });
  if (cfg.runtimeLimit > 0 && m.limitedBy === 'runtime' && m.byGas != null) html += esc(t('maxBottomBoth', { gas: m.byGas }));
  if (cfg.runtimeLimit > 0 && m.limitedBy === 'gas') html += esc(t('maxBottomGasFirst'));
  return `<p class="mingas ${over ? 'low' : ''}">${html}</p>`;
}

function render(plan, cfg) {
  const e = env();
  const stopRows = [];
  for (const s of plan.segments) {
    if (s.kind === 'switch') stopRows.push(`<tr class="switch"><td colspan="4">${esc(t('switchRow', { gas: s.gas, depth: s.from }))}</td></tr>`);
    if (s.kind === 'stop') stopRows.push(`<tr><td>${s.from} m</td><td class="num">${s.duration} min</td><td class="num">${fmt(s.runtime)}</td><td>${esc(s.gas)}</td></tr>`);
  }
  const stopsTable = stopRows.length
    ? `<table><thead><tr><th>${t('stop')}</th><th class="num">${t('duration')}</th><th class="num">Runtime</th><th>${t('gas')}</th></tr></thead><tbody>${stopRows.join('')}</tbody></table>`
    : `<p class="meta">${t('noStop', { ndl: plan.ndl, gf: cfg.gfHigh })}</p>`;

  const gasTable = `<table><thead><tr><th>${t('gas')}</th><th class="num">MOD 1.4/1.6</th><th class="num">${t('consumption')}</th><th class="num">${t('left')}</th></tr></thead><tbody>${
    plan.gases.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(mod(g, 1.4, e))}/${fmt(mod(g, 1.6, e))} m</td><td class="num">${g.liters} L</td>
      <td class="num ${isLow(g, cfg.reservePressure) ? 'low' : 'ok'}">${Number.isFinite(g.endPressure) ? barText(g.endPressure) : '—'}</td></tr>`).join('')
  }</tbody></table>`;

  const mg = plan.minGas;
  const minGasLine = mg.bar != null
    ? `<p class="mingas ${mg.ok ? '' : 'low'}">${t('minGasLine', {
      gas: esc(plan.gases[0].name), divers: cfg.minGasDivers, stress: cfg.minGasStressFactor,
      liters: mg.liters, bar: fmt(mg.bar), pressure: fmt(Math.max(0, mg.pressureAtBottomEnd)),
    })}</p>`
    : '';

  const warnings = plan.warnings.length
    ? `<ul class="warnings">${plan.warnings.map((w) => `<li class="${w.level}">${esc(w.params ? t('w_' + w.code, w.params) : w.message)}</li>`).join('')}</ul>`
    : '';

  $('result').innerHTML = `
    <h2>${t('plan')} · ${cfg.depth} m / ${cfg.bottomTime} min · GF ${cfg.gfLow}/${cfg.gfHigh}</h2>
    <div class="tiles">
      <div class="tile hero"><b>${fmt(plan.runtime)}</b><span>${t('runtime')}</span></div>
      <div class="tile"><b>${fmt(plan.tts)}</b><span>${t('tts')}</span></div>
      <div class="tile"><b>${plan.decoTime}</b><span>${t('stopsMin')}</span></div>
      <div class="tile"><b>${plan.firstStop ?? '—'}</b><span>${t('firstStop')}</span></div>
      <div class="tile"><b>${fmt(plan.cns)}%</b><span>CNS</span></div>
      <div class="tile"><b>${fmt(plan.otu)}</b><span>OTU</span></div>
    </div>
    ${maxBottomLine(cfg)}
    ${plan.repetitive ? `<p class="meta">${esc(t('repetNote'))}</p>` : ''}
    ${warnings}
    ${profileSvg(plan)}
    <h3>${t('stops')}</h3>
    ${stopsTable}
    <h3>${t('gases')}</h3>
    ${gasTable}
    ${minGasLine}
    <h3>${t('contingency')}</h3>
    ${contingencyTable(cfg)}
    <p class="meta">${t('meta', { end: fmt(plan.endBottom), rho: fmt(plan.densityBottom, 1), pp: fmt(plan.maxPpO2, 2) })}</p>`;
}

let lastPlan = null;
let lastInput = null; // entrée exacte du planificateur (plongée successive incluse), pour les scénarios

function update() {
  refreshGfButton();
  save();
  try {
    let cfg = readConfig();
    if (previousDive) cfg = withPreviousDive(cfg, previousDive, cfg.surfaceInterval).input;
    const plan = planDive(cfg);
    lastPlan = plan;
    lastInput = cfg;
    updateBadges(plan, cfg.reservePressure);
    render(plan, cfg);
  } catch (e) {
    lastPlan = null;
    lastInput = null;
    updateBadges(null, 0);
    $('result').innerHTML = `<h2>${t('plan')}</h2><p class="error">${esc(errorText(e))}</p>`;
  }
}

// ---------- Commandes (dictée iOS ou texte) ----------
// État « métier » du formulaire, lu et écrit par les outils (assistant/commands.js).
function getState() {
  return {
    depth: parseFloat($('depth').value),
    bottomTime: parseFloat($('bottomTime').value),
    gfLow: parseFloat($('gfLow').value),
    gfHigh: parseFloat($('gfHigh').value),
    runtimeLimit: parseFloat($('runtimeLimit').value) || null,
    gases: rows().map((row, i) => ({
      mix: row.querySelector('.gas-mix').value,
      switchDepth: i === 0 ? null : parseFloat(row.querySelector('.gas-depth').value),
      volume: row.cyl.vol,
      startPressure: row.cyl.bar,
    })),
  };
}

function setState(st) {
  $('depth').value = st.depth;
  $('bottomTime').value = st.bottomTime;
  $('gfLow').value = st.gfLow;
  $('gfHigh').value = st.gfHigh;
  $('runtimeLimit').value = st.runtimeLimit || '';
  $('gfHolder').append(gfBtn, gfPanel); // mis à l'abri avant de reconstruire les lignes
  gasList.innerHTML = '';
  st.gases.forEach((g, i) => addGasRow({
    mix: g.mix, depth: i === 0 ? '' : g.switchDepth, auto: false, vol: g.volume, bar: g.startPressure,
  }));
  renderCylinders();
}

let voiceOn = (() => { try { return localStorage.getItem('jarvis-dive:voice') !== '0'; } catch { return true; } })();
function refreshVoiceButton() {
  const b = $('cmdVoice');
  b.setAttribute('aria-pressed', String(voiceOn));
  b.setAttribute('aria-label', voiceOn ? t('cmdVoiceOn') : t('cmdVoiceOff'));
  b.textContent = voiceOn ? '🔊' : '🔇';
}

function speak(text) {
  if (!voiceOn || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
  window.speechSynthesis.speak(u);
}

// ---------- Parler à JARVIS ----------
// Compréhension hybride (analyseur, puis LLM optionnel) → outils validés → moteur → réponse lue à voix haute.
let convHistory = [];

function bubble(cls, text, meta = '') {
  const log = $('convLog');
  log.insertAdjacentHTML('afterbegin', `<div class="bubble ${cls}">${esc(text)}${meta ? `<small>${esc(meta)}</small>` : ''}</div>`);
  while (log.children.length > 8) log.lastElementChild.remove();
}

async function converse(text, { voice = true } = {}) {
  const said = String(text || '').trim();
  if (!said) return;
  bubble('me', said);
  const llmFn = llm.isLoaded() ? (messages) => llm.dialog(messages) : null;
  if (llmFn) $('cmdInput').placeholder = t('thinking');
  const u = await interpret(said, getState(), convHistory, llmFn);
  $('cmdInput').placeholder = t('cmdPlaceholder');
  const parts = [];
  let isError = false;
  if (u.calls.length) {
    try {
      const { state, changes } = applyToolCalls(getState(), u.calls);
      setState(state);
      update();
      if (changes.length) parts.push(t('understood', { list: changes.map((c) => t(c.code, c.params)).join(', ') }));
    } catch (e) {
      parts.push(t('cannot', { error: errorText(e) }));
      isError = true;
    }
  }
  if (u.note) parts.push(u.note);
  const facts = u.facts.length ? u.facts : (u.calls.length && !isError ? [{ id: 'summary' }] : []);
  if (facts.length) {
    if (lastPlan && lastInput) parts.push(renderFacts(facts, { plan: lastPlan, input: lastInput, reserve: lastInput.reservePressure, t }, lang));
    else { parts.push($('result').innerText.split('\n').slice(1).join(' ')); isError = true; }
  }
  if (!parts.length) { parts.push(t('notUnderstood')); isError = true; }
  const reply = parts.join(' ');
  convHistory = [...convHistory, { said, out: { calls: u.calls, facts: u.facts, note: u.note || '' } }].slice(-3);
  bubble(`jarvis${isError ? ' err' : ''}`, reply, `${t('src_' + u.source)}${u.ms ? ` · ${(u.ms / 1000).toFixed(1)} s` : ''}`);
  if (voice) speak(reply);
}

$('cmdForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('cmdInput').value;
  $('cmdInput').value = '';
  $('cmdInput').blur();
  converse(v);
});
$('cmdRead').addEventListener('click', () => { if (lastPlan) speak(planSummary(lastPlan, t, { spoken: true })); });
$('cmdVoice').addEventListener('click', () => {
  voiceOn = !voiceOn;
  try { localStorage.setItem('jarvis-dive:voice', voiceOn ? '1' : '0'); } catch { /* sans conséquence */ }
  if (!voiceOn && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  refreshVoiceButton();
});

// Bouton « Parler » : reconnaissance vocale de Safari si disponible, sinon micro du clavier.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;
function refreshTalkButton() {
  const label = $('talkLabel');
  if (!SR) { $('talk').disabled = true; label.textContent = t('talkUnavailable'); return; }
  label.textContent = rec ? t('talkListening') : t('talkBtn');
  $('talk').classList.toggle('on', !!rec);
}
$('talk').addEventListener('click', () => {
  if (!SR) return;
  if (rec) { rec.stop(); return; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel(); // coupe JARVIS et débloque la voix (geste)
  rec = new SR();
  rec.lang = lang === 'fr' ? 'fr-FR' : 'en-US';
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    $('cmdInput').value = finalText || interim;
  };
  rec.onerror = (ev) => {
    if (ev.error !== 'no-speech' && ev.error !== 'aborted') bubble('jarvis err', t('srError', { error: ev.error }));
  };
  rec.onend = () => {
    const said = finalText || $('cmdInput').value;
    $('cmdInput').value = '';
    rec = null;
    refreshTalkButton();
    converse(said);
  };
  rec.start();
  refreshTalkButton();
});

// LLM optionnel
function refreshLlmPanel(info = null) {
  const loaded = llm.isLoaded();
  $('llmBtn').classList.toggle('on', loaded);
  $('llmBtn').textContent = loaded ? `🧠 ${llm.MODELS.find((m) => m.id === llm.currentModel()).label}` : '🧠 LLM';
  $('llmLoad').textContent = loaded ? t('llmUnload') : t('llmLoad');
  const sel = $('llmModel');
  if (!sel.options.length) llm.MODELS.forEach((m) => sel.add(new Option(`${m.label} · ${m.size}`, m.id)));
  if (info !== null) $('llmInfo').textContent = info;
  else if (!llm.isAvailable()) { $('llmInfo').textContent = t('llmNoGpu'); $('llmLoad').disabled = true; }
  else {
    const crash = llm.lastCrash();
    const m = llm.MODELS.find((x) => x.id === sel.value);
    $('llmInfo').textContent = loaded ? t('llmReady', { model: m.label })
      : crash ? t('llmCrashed', { model: crash.model }) : t('llmFirstTime', { size: m.size });
  }
}
$('llmBtn').addEventListener('click', () => {
  const open = $('llmPanel').hidden;
  $('llmPanel').hidden = !open;
  $('llmBtn').setAttribute('aria-expanded', String(open));
  refreshLlmPanel();
});
$('llmModel').addEventListener('change', () => refreshLlmPanel());
$('llmLoad').addEventListener('click', async () => {
  const btn = $('llmLoad');
  btn.disabled = true;
  try {
    if (llm.isLoaded()) { await llm.unloadModel(); refreshLlmPanel(); return; }
    refreshLlmPanel(t('llmLoading'));
    await llm.loadModel($('llmModel').value, (p, text) => {
      $('llmBar').style.width = `${Math.round(p * 100)}%`;
      $('llmInfo').textContent = text;
    });
    refreshLlmPanel();
  } catch (e) {
    refreshLlmPanel(e.message === 'LIB' ? t('llmNoLib') : e.message === 'WebGPU' ? t('llmNoGpu') : t('llmFailed', { error: e.message }));
  } finally {
    btn.disabled = !llm.isAvailable();
  }
});

// ---------- Démarrage ----------
restore();
applyLang();
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  t = makeT(lang);
  saveLang(lang);
  applyLang();
  update();
}));
$('addGas').addEventListener('click', () => {
  const mix = gasList.children.length === 1 ? 'EAN50' : 'O2';
  addGasRow({ mix, depth: defaultSwitchDepth(parseGas(mix), env()) });
  renderCylinders();
  update();
});
for (const f of NUM_FIELDS) $(f).addEventListener('input', update);
update();

// Lien de commande : …/jarvis-dive/?cmd=40 mètres 25 minutes (Raccourcis / Siri)
(() => {
  const params = new URLSearchParams(location.search);
  const cmd = params.get('cmd');
  if (!cmd) return;
  converse(cmd, { voice: false }); // Safari bloque la voix sans appui : bouton « Lire » disponible
  history.replaceState(null, '', location.pathname);
})();

// Hors ligne
const setOffline = () => { $('offline').hidden = navigator.onLine; };
window.addEventListener('online', setOffline);
window.addEventListener('offline', setOffline);
setOffline();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
