// JARVIS DIVE — Analyseur de commandes (FR / EN), sans LLM, 100 % hors ligne.
// Transforme une phrase dictée en appels d'outils (voir commands.js). Déterministe et testé :
// sert de secours au LLM et de référence pour vérifier ce que le LLM propose.

const UNITS = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };

function wordsToNumbers(s) {
  // "quarante-cinq", "quarante cinq", "vingt et un", "dix-huit", "forty five"
  s = s.replace(/\b(dix)[\s-](sept|huit|neuf)\b/g, (_, a, b) => String(10 + UNITS[b]));
  s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})(?:[\\s-]et[\\s-]|[\\s-])(${Object.keys(UNITS).join('|')})\\b`, 'g'),
    (_, t, u) => String(TENS[t] + UNITS[u]));
  s = s.replace(new RegExp(`\\b(${Object.keys(TENS).join('|')})\\b`, 'g'), (_, t) => String(TENS[t]));
  s = s.replace(new RegExp(`\\b(${Object.keys(UNITS).join('|')})\\b`, 'g'), (w) => String(UNITS[w]));
  return s;
}

export function normalize(text) {
  let s = String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[’']/g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\be\s?a\s?n\b/g, 'ean').replace(/\bian\b/g, 'ean').replace(/\bo\s?2\b/g, 'o2');
  return ` ${wordsToNumbers(s)} `;
}

const GAS = String.raw`(?:(air)|(oxygene|oxygen|oxy|o2)|(?:nitrox|eanx|ean|nx)\s?(\d{2})|(?:trimix|tx|tmx)\s?(\d{1,2})\s?(?:\/|sur|over|\s)\s?(\d{1,2}))`;
const MIN = String.raw`(?:minutes?|mins?|mn)`;
const MET = String.raw`(?:metres?|meters?|m)`;

function gasFrom(m, offset = 1) {
  if (m[offset]) return 'Air';
  if (m[offset + 1]) return 'O2';
  if (m[offset + 2]) return `EAN${m[offset + 2]}`;
  if (m[offset + 3]) return `TX${m[offset + 3]}/${m[offset + 4]}`;
  return null;
}

/**
 * @param {string} text phrase dictée
 * @param {object} state état courant (pour savoir quel gaz est au fond)
 * @returns {{ calls: Array<{name, args}>, normalized: string }}
 */
export function parseCommand(text, state = null) {
  let s = normalize(text);
  const calls = [];
  const blank = (m) => { s = s.replace(m, ' '.repeat(m.length)); };
  const each = (re, fn) => { for (const m of [...s.matchAll(re)]) { fn(m); blank(m[0]); } };

  // 1. Retrait d'un gaz
  each(new RegExp(String.raw`\b(?:enleve|retire|supprime|sans|remove|drop|without)\s(?:le\s|la\s|l\s|de\s|d\s|the\s)?${GAS}`, 'g'),
    (m) => calls.push({ name: 'remove_gas', args: { mix: gasFrom(m) } }));

  // 2. Ajustements relatifs de temps et de profondeur
  const sign = (w) => (/^(enleve|retire|moins|minus|remove|take|reduis|reduce)/.test(w) ? -1 : 1);
  each(new RegExp(String.raw`\b(ajoute|rajoute|plus|add|enleve|retire|moins|minus|remove|reduis|reduce)\s(?:de\s)?(\d{1,3})\s?${MIN}\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { add_time: sign(m[1]) * +m[2] } }));
  each(new RegExp(String.raw`\b(\d{1,3})\s?${MIN}\s(de plus|more|de moins|less)\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { add_time: (/moins|less/.test(m[2]) ? -1 : 1) * +m[1] } }));
  each(new RegExp(String.raw`\b(ajoute|rajoute|add|enleve|retire|remove)\s(\d{1,3})\s?${MET}\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { add_depth: sign(m[1]) * +m[2] } }));
  each(new RegExp(String.raw`\b(\d{1,3})\s?${MET}\s(de plus|plus profond|deeper|more|de moins|moins profond|shallower|less)\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { add_depth: (/moins|shallower|less/.test(m[2]) ? -1 : 1) * +m[1] } }));
  each(/\b(plus profond|deeper|moins profond|shallower) de (\d{1,3})\s?(?:metres?|meters?|m)?\b/g,
    (m) => calls.push({ name: 'set_dive', args: { add_depth: (/moins|shallower/.test(m[1]) ? -1 : 1) * +m[2] } }));

  // 3. Gradient factors : "gf 30 85", "gf 30/85", "gf 30 sur 85", "gf 85"
  each(/\b(?:gf|gradient factors?|g f)\s(\d{1,3})(?:\s?(?:\/|sur|over|\s)\s?(\d{1,3}))?\b/g,
    (m) => calls.push({ name: 'set_gf', args: { low: +m[1], high: +(m[2] ?? m[1]) } }));

  // 4. Blocs : "bloc fond bi 12", "bi 12", "bloc 15 litres 230 bars", "bloc ean50 7 litres"
  each(new RegExp(String.raw`\b(?:bloc|bouteille|cylinder|tank|stage)(?:\s(?:de\s|du\s|d\s)?(?:fond|bottom))?(?:\s(?:de\s|d\s|du\s)?${GAS})?(?:\s(?:en|de|of))?(?:\s(bi|twin|double|2\s?x)\s?(\d{1,2})|\s(\d{1,2})\s?(?:l|litres?|liters?)?)?(?:\s(?:a|at|gonfle a)?\s?(\d{2,3})\s?(?:b|bars?))?\b`, 'g'),
    (m) => {
      const gas = gasFrom(m) || 'bottom';
      const volume = m[7] ? 2 * +m[7] : m[8] ? +m[8] : undefined;
      const pressure = m[9] ? +m[9] : undefined;
      if (volume !== undefined || pressure !== undefined) calls.push({ name: 'set_cylinder', args: { gas, volume, pressure } });
    });
  each(/\b(?:bi|twin|2\s?x)\s?(\d{1,2})\b/g, (m) => calls.push({ name: 'set_cylinder', args: { gas: 'bottom', volume: 2 * +m[1] } }));

  // 5. Gaz, avec profondeur de switch optionnelle : "ean47 a 12", "oxygene a 6 m", "o2 @ 6"
  const bottomName = state && state.gases && state.gases[0] ? String(state.gases[0].mix).toUpperCase() : null;
  let bottomSet = false;
  each(new RegExp(String.raw`\b(au fond\s|fond\s|bottom\s|deco\s)?${GAS}(?:\s(?:a|au|at|@|switch a|switch at|des|from)\s?(\d{1,3})\s?(?:${MET})?)?\b`, 'g'),
    (m) => {
      const role = (m[1] || '').trim();
      const mix = gasFrom(m, 2);
      const sw = m[7] !== undefined ? +m[7] : undefined;
      const isO2 = mix === 'O2';
      const toBottom = role === 'au fond' || role === 'fond' || role === 'bottom'
        || (!role && sw === undefined && !isO2 && !bottomSet && mix.toUpperCase() !== bottomName && !calls.some((c) => c.name === 'add_deco_gas'));
      if (toBottom) {
        calls.push({ name: 'set_bottom_gas', args: { mix } });
        bottomSet = true;
      } else if (!(sw === undefined && mix.toUpperCase() === bottomName)) {
        calls.push({ name: 'add_deco_gas', args: sw !== undefined ? { mix, switch_depth: sw } : { mix }, explicitDeco: role === 'deco' });
      } else {
        bottomSet = true; // gaz fond déjà en place, rien à changer
      }
    });

  // 6. Profondeur et temps absolus
  each(new RegExp(String.raw`\b(?:profondeur|depth|a|at)?\s?(\d{1,3})\s?${MET}\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { depth: +m[1] } }));
  each(new RegExp(String.raw`\b(?:temps fond|temps|bottom time|time|pendant|for)?\s?(\d{1,3})\s?${MIN}\b`, 'g'),
    (m) => calls.push({ name: 'set_dive', args: { bottom_time: +m[1] } }));

  // 6b. "EAN32 à 30 m" dit pour le gaz fond : un switch à la profondeur de la plongée (ou plus bas) n'a pas de sens
  if (!bottomSet) {
    const depthCall = calls.find((c) => c.name === 'set_dive' && c.args.depth !== undefined);
    const target = depthCall ? depthCall.args.depth : state && state.depth;
    // Un nitrox < 40 % d'O2 "à N m" qui n'est pas déjà un gaz de déco est un gaz fond (dire "déco EAN36 à 33" sinon).
    const knownDeco = (mix) => !!(state && state.gases && state.gases.slice(1).some((g) => String(g.mix).toUpperCase() === mix.toUpperCase()));
    const o2Of = (mix) => (mix === 'O2' ? 100 : mix === 'Air' ? 21 : parseInt(mix.replace(/^(EAN|TX)/, ''), 10));
    const idx = calls.findIndex((c) => c.name === 'add_deco_gas' && c.args.switch_depth !== undefined && c.args.mix !== 'O2' && !c.explicitDeco
      && (target === undefined || target === null || c.args.switch_depth >= target || (o2Of(c.args.mix) < 40 && !knownDeco(c.args.mix))));
    if (idx >= 0) {
      const { mix, switch_depth: d } = calls[idx].args;
      calls.splice(idx, 1, { name: 'set_bottom_gas', args: { mix } });
      if (!depthCall) calls.push({ name: 'set_dive', args: { depth: d } });
    }
  }

  // 7. Demande de lecture du plan
  if (/\b(lis|lire|lecture|donne|resume|read|plan|paliers|stops)\b/.test(s) && calls.length === 0) {
    calls.push({ name: 'get_plan', args: {} });
  }

  return { calls: calls.map(({ name, args }) => ({ name, args })), normalized: normalize(text).trim() };
}
