// JARVIS DIVE — Interface (le calcul est entièrement délégué au moteur)
import { planDive } from './engine/planner.js';
import { parseGas, defaultSwitchDepth, mod } from './engine/gases.js';
import { createEnvironment } from './engine/zhl16c.js';
import { detectLang, saveLang, makeT } from './i18n.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'jarvis-dive:v2';
const NUM_FIELDS = ['depth', 'bottomTime', 'gfLow', 'gfHigh', 'descentRate', 'ascentRate', 'lastStop',
  'switchStopMin', 'ppO2Bottom', 'waterDensity', 'sacBottom', 'sacDeco'];
const DEFAULT_GASES = [{ mix: 'Air', depth: '' }];

let lang = detectLang();
let t = makeT(lang);

const gasList = $('gases');
const tpl = $('gasRow');

function env() {
  return createEnvironment({ waterDensity: parseFloat($('waterDensity').value) || 1.03 });
}

function addGasRow({ mix, depth, auto = true }) {
  const row = tpl.content.firstElementChild.cloneNode(true);
  const mixInput = row.querySelector('.gas-mix');
  const depthInput = row.querySelector('.gas-depth');
  mixInput.value = mix;
  depthInput.value = depth;
  depthInput.dataset.auto = auto ? '1' : '0';
  mixInput.addEventListener('input', () => {
    if (depthInput.dataset.auto === '1') {
      try { depthInput.value = defaultSwitchDepth(parseGas(mixInput.value), env()); } catch { /* saisie en cours */ }
    }
    update();
  });
  depthInput.addEventListener('input', () => { depthInput.dataset.auto = '0'; update(); });
  row.querySelector('.gas-del').addEventListener('click', () => { row.remove(); refreshRoles(); update(); });
  gasList.appendChild(row);
  refreshRoles();
}

function refreshRoles() {
  [...gasList.children].forEach((row, i) => {
    row.classList.toggle('bottom', i === 0);
    row.querySelector('.gas-role').textContent = i === 0 ? t('roleBottom') : t('roleDeco');
    row.querySelector('.gas-switch-label').textContent = t('switchLabel');
    row.querySelector('.gas-mix').setAttribute('aria-label', t('mixLabel'));
    row.querySelector('.gas-depth').setAttribute('aria-label', t('switchDepthLabel'));
    row.querySelector('.gas-del').setAttribute('aria-label', t('remove'));
    if (i === 0 && !row.contains(gfBtn)) row.append(gfBtn, gfPanel);
  });
}

// Bouton GF à droite du gaz fond, ouvrant un petit tableau éditable
const gfBtn = $('gfBtn');
const gfPanel = $('gfPanel');
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

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  refreshRoles();
}

// Traduit une erreur du moteur (code + paramètres) ou retombe sur son message.
function errorText(e) {
  return e && e.code ? t('e_' + e.code, e.params) : String(e && e.message ? e.message : e);
}

function readGases() {
  return [...gasList.children].map((row, i) => {
    const mixInput = row.querySelector('.gas-mix');
    const depthInput = row.querySelector('.gas-depth');
    try {
      const gas = parseGas(mixInput.value, i === 0 ? null : parseFloat(depthInput.value));
      if (i > 0 && !(gas.switchDepth >= 0)) throw Object.assign(new Error('SWITCH_MISSING'), { code: 'SWITCH_MISSING', params: { gas: gas.name } });
      mixInput.classList.remove('invalid');
      return gas;
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

function save() {
  try {
    const data = { fields: {}, gases: [] };
    for (const f of NUM_FIELDS) data.fields[f] = $(f).value;
    data.gases = [...gasList.children].map((row) => ({
      mix: row.querySelector('.gas-mix').value,
      depth: row.querySelector('.gas-depth').value,
      auto: row.querySelector('.gas-depth').dataset.auto === '1',
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* stockage indisponible : sans conséquence */ }
}

function restore() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(STORE_KEY)); } catch { data = null; }
  if (data && data.fields) for (const f of NUM_FIELDS) if (data.fields[f] != null && $(f)) $(f).value = data.fields[f];
  (data && data.gases && data.gases.length ? data.gases : DEFAULT_GASES).forEach(addGasRow);
}

const fmt = (x, d = 0) => Number(x).toFixed(d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function profileSvg(plan) {
  const W = 640, H = 220, L = 34, R = 10, T = 10, B = 24;
  const maxT = plan.runtime, maxD = plan.input.depth;
  const x = (t) => L + (t / maxT) * (W - L - R);
  const y = (d) => T + (d / maxD) * (H - T - B);
  const pts = [[0, 0]];
  plan.segments.forEach((s) => { if (s.duration > 0) pts.push([s.runtime, s.to]); });
  const path = pts.map(([t, d], i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${y(d).toFixed(1)}`).join(' ');
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

function render(plan, cfg) {
  const e = env();
  const rows = [];
  for (const s of plan.segments) {
    if (s.kind === 'switch') rows.push(`<tr class="switch"><td colspan="4">${esc(t('switchRow', { gas: s.gas, depth: s.from }))}</td></tr>`);
    if (s.kind === 'stop') rows.push(`<tr><td>${s.from} m</td><td class="num">${s.duration} min</td><td class="num">${fmt(s.runtime)}</td><td>${esc(s.gas)}</td></tr>`);
  }
  const stopsTable = rows.length
    ? `<table><thead><tr><th>${t('stop')}</th><th class="num">${t('duration')}</th><th class="num">Runtime</th><th>${t('gas')}</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : `<p class="meta">${t('noStop', { ndl: plan.ndl, gf: cfg.gfHigh })}</p>`;

  const gasTable = `<table><thead><tr><th>${t('gas')}</th><th class="num">MOD 1.4 / 1.6</th><th class="num">${t('consumption')}</th></tr></thead><tbody>${
    plan.gases.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${fmt(mod(g, 1.4, e))} / ${fmt(mod(g, 1.6, e))} m</td><td class="num">${g.liters} L</td></tr>`).join('')
  }</tbody></table>`;

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
    ${warnings}
    ${profileSvg(plan)}
    <h3>${t('stops')}</h3>
    ${stopsTable}
    <h3>${t('gases')}</h3>
    ${gasTable}
    <p class="meta">${t('meta', { end: fmt(plan.endBottom), rho: fmt(plan.densityBottom, 1), pp: fmt(plan.maxPpO2, 2) })}</p>`;
}

function update() {
  refreshGfButton();
  save();
  let cfg;
  try {
    cfg = readConfig();
    render(planDive(cfg), cfg);
  } catch (e) {
    $('result').innerHTML = `<h2>${t('plan')}</h2><p class="error">${esc(errorText(e))}</p>`;
  }
}

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
  update();
});
for (const f of NUM_FIELDS) $(f).addEventListener('input', update);
update();

// Hors ligne
const setOffline = () => { $('offline').hidden = navigator.onLine; };
window.addEventListener('online', setOffline);
window.addEventListener('offline', setOffline);
setOffline();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
