// JARVIS DIVE — Outils de pilotage du plan (utilisés par l'analyseur hors ligne ET par un LLM).
// Un LLM n'écrit jamais dans le formulaire directement : il propose des appels d'outils,
// qui sont validés ici avant d'être appliqués. Le moteur fait ensuite tous les calculs.

import { parseGas, defaultSwitchDepth } from '../engine/gases.js';
import { createEnvironment } from '../engine/zhl16c.js';

export class CommandError extends Error {
  constructor(code, params = {}) {
    super(code);
    this.code = code;
    this.params = params;
  }
}

const LIMITS = {
  depth: [1, 150],
  bottomTime: [1, 300],
  gf: [5, 100],
  volume: [1, 50],
  pressure: [20, 300],
  switchDepth: [0, 150],
};

const CYL_BOTTOM = { volume: 12, startPressure: 200 };
const CYL_DECO = { volume: 7, startPressure: 200 };

function inRange(field, value, key = field) {
  const [min, max] = LIMITS[key];
  if (!Number.isFinite(value) || value < min || value > max) throw new CommandError('x_RANGE', { field, from: min, to: max, value });
  return value;
}

const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));

/** Définition des outils au format OpenAI (tools / function calling). */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_dive',
      description: 'Règle la profondeur (m) et/ou le temps fond (min, descente incluse). add_* pour ajuster relativement (valeurs négatives possibles).',
      parameters: {
        type: 'object',
        properties: {
          depth: { type: 'number', description: 'Profondeur max en mètres' },
          bottom_time: { type: 'number', description: 'Temps fond en minutes, descente incluse' },
          add_depth: { type: 'number', description: 'Mètres à ajouter (ou retirer si négatif)' },
          add_time: { type: 'number', description: 'Minutes à ajouter (ou retirer si négatif)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_gf',
      description: 'Règle les gradient factors en pourcentage.',
      parameters: { type: 'object', properties: { low: { type: 'number' }, high: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_bottom_gas',
      description: 'Change le gaz fond. Format : "Air", "EAN32", "O2", "TX18/45".',
      parameters: { type: 'object', properties: { mix: { type: 'string' } }, required: ['mix'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_deco_gas',
      description: 'Ajoute un gaz de déco (ou modifie sa profondeur de switch s\'il existe). Sans switch_depth : MOD à ppO2 1.6.',
      parameters: {
        type: 'object',
        properties: { mix: { type: 'string' }, switch_depth: { type: 'number', description: 'Profondeur de switch en mètres' } },
        required: ['mix'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_gas',
      description: 'Retire un gaz de déco.',
      parameters: { type: 'object', properties: { mix: { type: 'string' } }, required: ['mix'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_cylinder',
      description: 'Règle le bloc d\'un gaz : volume en litres (bi 2x12 = 24) et/ou pression de départ en bar. gas = nom du mélange ou "bottom" pour le gaz fond.',
      parameters: {
        type: 'object',
        properties: { gas: { type: 'string' }, volume: { type: 'number' }, pressure: { type: 'number' } },
        required: ['gas'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_plan',
      description: 'Renvoie le plan calculé par JARVIS (paliers, DTR, gaz restants, alertes). Ne jamais calculer soi-même.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);

function findGasIndex(state, mix) {
  if (mix === 'bottom' || mix === 'fond') return 0;
  const name = parseGas(mix).name;
  return state.gases.findIndex((g) => parseGas(g.mix).name === name);
}

/**
 * Applique un appel d'outil à l'état du formulaire.
 * state : { depth, bottomTime, gfLow, gfHigh, gases: [{ mix, switchDepth, volume, startPressure }] }
 * Retourne { state, changes } sans modifier l'état reçu.
 */
export function applyToolCall(state, call, envOptions = {}) {
  const env = createEnvironment(envOptions);
  const s = structuredClone(state);
  const a = call.args || call.arguments || {};
  const changes = [];

  switch (call.name) {
    case 'set_dive': {
      const depth = num(a.depth);
      const time = num(a.bottom_time);
      const addD = num(a.add_depth);
      const addT = num(a.add_time);
      if (depth !== undefined) s.depth = inRange('depth', depth);
      if (addD !== undefined) s.depth = inRange('depth', s.depth + addD);
      if (time !== undefined) s.bottomTime = inRange('bottomTime', time);
      if (addT !== undefined) s.bottomTime = inRange('bottomTime', s.bottomTime + addT);
      if (s.depth !== state.depth) changes.push({ code: 'c_DEPTH', params: { value: s.depth } });
      if (s.bottomTime !== state.bottomTime) changes.push({ code: 'c_TIME', params: { value: s.bottomTime } });
      break;
    }
    case 'set_gf': {
      const low = num(a.low);
      const high = num(a.high);
      if (low !== undefined) s.gfLow = inRange('gf', low);
      if (high !== undefined) s.gfHigh = inRange('gf', high);
      if (s.gfLow > s.gfHigh) throw new CommandError('x_GF_ORDER', { low: s.gfLow, high: s.gfHigh });
      changes.push({ code: 'c_GF', params: { low: s.gfLow, high: s.gfHigh } });
      break;
    }
    case 'set_bottom_gas': {
      const gas = parseGas(a.mix);
      s.gases[0] = { ...s.gases[0], mix: gas.name, switchDepth: null };
      changes.push({ code: 'c_BOTTOM_GAS', params: { gas: gas.name } });
      break;
    }
    case 'add_deco_gas': {
      const gas = parseGas(a.mix);
      const sw = num(a.switch_depth);
      const depth = sw !== undefined ? inRange('switchDepth', sw) : defaultSwitchDepth(gas, env);
      const idx = findGasIndex(s, gas.name);
      if (idx === 0) throw new CommandError('x_SAME_AS_BOTTOM', { gas: gas.name });
      if (idx > 0) {
        s.gases[idx] = { ...s.gases[idx], switchDepth: depth };
        changes.push({ code: 'c_SWITCH', params: { gas: gas.name, depth } });
      } else {
        s.gases.push({ mix: gas.name, switchDepth: depth, ...CYL_DECO });
        changes.push({ code: 'c_ADD_GAS', params: { gas: gas.name, depth } });
      }
      break;
    }
    case 'remove_gas': {
      const idx = findGasIndex(s, a.mix);
      if (idx === 0) throw new CommandError('x_REMOVE_BOTTOM', {});
      if (idx < 0) throw new CommandError('x_GAS_NOT_FOUND', { gas: a.mix });
      const [removed] = s.gases.splice(idx, 1);
      changes.push({ code: 'c_REMOVE_GAS', params: { gas: parseGas(removed.mix).name } });
      break;
    }
    case 'set_cylinder': {
      const idx = findGasIndex(s, a.gas ?? 'bottom');
      if (idx < 0) throw new CommandError('x_GAS_NOT_FOUND', { gas: a.gas });
      const vol = num(a.volume);
      const bar = num(a.pressure);
      if (vol !== undefined) s.gases[idx].volume = inRange('volume', vol);
      if (bar !== undefined) s.gases[idx].startPressure = inRange('pressure', bar);
      changes.push({ code: 'c_CYL', params: { gas: parseGas(s.gases[idx].mix).name, volume: s.gases[idx].volume, pressure: s.gases[idx].startPressure } });
      break;
    }
    case 'get_plan':
      break;
    default:
      throw new CommandError('x_UNKNOWN_TOOL', { name: call.name });
  }
  return { state: s, changes };
}

/** Applique une liste d'appels ; s'arrête à la première erreur (l'état n'est alors pas modifié). */
export function applyToolCalls(state, calls, envOptions = {}) {
  let s = state;
  const changes = [];
  for (const call of calls) {
    const r = applyToolCall(s, call, envOptions);
    s = r.state;
    changes.push(...r.changes);
  }
  return { state: s, changes };
}

export const DEFAULT_CYLINDERS = { bottom: CYL_BOTTOM, deco: CYL_DECO };
