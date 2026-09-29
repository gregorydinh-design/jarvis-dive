// JARVIS DIVE — Résumé texte d'un plan : lu à voix haute, et renvoyé au LLM par l'outil get_plan.
// Le texte ne contient que des valeurs calculées par le moteur.

const round = (x) => Math.round(x);

export function planSummary(plan, t, { spoken = false } = {}) {
  const parts = [];
  const i = plan.input;
  parts.push(t('s_head', { depth: i.depth, time: i.bottomTime, gfLow: i.gfLow, gfHigh: i.gfHigh }));
  if (plan.stops.length) {
    const stops = plan.stops.map((s) => t('s_stop', { depth: s.depth, duration: s.duration, duration_s: s.duration > 1 ? 's' : '', gas: spoken ? spokenGas(s.gas, t) : s.gas }));
    parts.push(t('s_stops', { list: stops.join(', ') }));
  } else {
    parts.push(t('s_noStop', { ndl: plan.ndl }));
  }
  parts.push(t('s_times', { tts: round(plan.tts), runtime: round(plan.runtime) }));
  const gas = plan.gases
    .filter((g) => Number.isFinite(g.endPressure))
    .map((g) => t('s_gasLeft', { gas: spoken ? spokenGas(g.name, t) : g.name, bar: Math.max(0, round(g.endPressure)) }));
  if (gas.length) parts.push(t('s_gas', { list: gas.join(', ') }));
  const alerts = plan.warnings.filter((w) => w.level === 'danger');
  if (alerts.length) parts.push(t('s_alerts', { list: alerts.map((w) => (w.params ? t('w_' + w.code, w.params) : w.message)).join('. ') }));
  return parts.join(' ');
}

// "EAN27" se lit mal par la synthèse vocale : "nitrox 27", "oxygène", "trimix 18 45".
function spokenGas(name, t) {
  if (name === 'O2') return t('s_o2');
  if (name === 'Air') return t('s_air');
  let m = name.match(/^EAN(\d+)$/);
  if (m) return `nitrox ${m[1]}`;
  m = name.match(/^TX(\d+)\/(\d+)$/);
  if (m) return `trimix ${m[1]} ${m[2]}`;
  return name;
}
