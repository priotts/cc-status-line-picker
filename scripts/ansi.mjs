/**
 * ANSI SGR parser: turns a rendered status line into styled segments the
 * Angular components can paint.
 *
 * The gallery must show what a terminal actually shows, so the colors are
 * resolved here against a real palette rather than approximated in CSS.
 */

/** Tokyo Night. The 16 base colors a terminal maps 30-37 / 90-97 onto. */
const BASE_16 = [
  '#1a1b26', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
  '#414868', '#ff7a93', '#b9f27c', '#ff9e64', '#7da6ff', '#c7a9ff', '#0db9d7', '#c0caf5',
];

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function hex(r, g, b) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Standard xterm 256-color palette: 16 base, a 6x6x6 cube, then 24 grays. */
function xterm256(index) {
  if (index < 16) return BASE_16[index];
  if (index < 232) {
    const n = index - 16;
    return hex(
      CUBE_LEVELS[Math.floor(n / 36) % 6],
      CUBE_LEVELS[Math.floor(n / 6) % 6],
      CUBE_LEVELS[n % 6],
    );
  }
  const level = 8 + (index - 232) * 10;
  return hex(level, level, level);
}

const EMPTY_STATE = { fg: null, bg: null, bold: false, dim: false };

/**
 * Applies one SGR sequence to the current state.
 * Parameters are consumed left to right because 38/48 pull their arguments
 * from the same list.
 */
function applySgr(state, params) {
  for (let i = 0; i < params.length; i += 1) {
    const code = params[i];

    if (code === 0) {
      Object.assign(state, EMPTY_STATE);
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code >= 30 && code <= 37) {
      state.fg = BASE_16[code - 30];
    } else if (code >= 90 && code <= 97) {
      state.fg = BASE_16[code - 90 + 8];
    } else if (code === 39) {
      state.fg = null;
    } else if (code >= 40 && code <= 47) {
      state.bg = BASE_16[code - 40];
    } else if (code >= 100 && code <= 107) {
      state.bg = BASE_16[code - 100 + 8];
    } else if (code === 49) {
      state.bg = null;
    } else if (code === 38 || code === 48) {
      // 38;5;N (256-color) or 38;2;R;G;B (truecolor)
      const mode = params[i + 1];
      const target = code === 38 ? 'fg' : 'bg';
      if (mode === 5) {
        state[target] = xterm256(params[i + 2] ?? 0);
        i += 2;
      } else if (mode === 2) {
        state[target] = hex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0);
        i += 4;
      }
    }
  }
}

// Built from a char code rather than written literally: a bare ESC byte in
// source is invisible in most editors and does not survive every encoding.
const ESC = String.fromCharCode(27);
const SGR_PATTERN = `${ESC}\\[([0-9;]*)m`;

/** OSC 8 hyperlinks carry no style and an SVG cannot click through: dropped. */
const OSC8_RE = new RegExp(`${ESC}\\]8;[^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)`, 'g');

/**
 * Splits one line into `{ text, fg, bg, bold, dim }` segments.
 * Adjacent runs sharing a style are merged so the DOM stays small.
 */
export function parseLine(raw) {
  const line = raw.replace(OSC8_RE, '');
  const segments = [];
  const state = { ...EMPTY_STATE };
  const re = new RegExp(SGR_PATTERN, 'g');
  let cursor = 0;

  const push = (text) => {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.fg === state.fg &&
      last.bg === state.bg &&
      last.bold === state.bold &&
      last.dim === state.dim
    ) {
      last.text += text;
      return;
    }
    segments.push({ text, fg: state.fg, bg: state.bg, bold: state.bold, dim: state.dim });
  };

  let match;
  while ((match = re.exec(line)) !== null) {
    push(line.slice(cursor, match.index));
    const params =
      match[1] === '' ? [0] : match[1].split(';').map((p) => Number.parseInt(p, 10) || 0);
    applySgr(state, params);
    cursor = re.lastIndex;
  }
  push(line.slice(cursor));

  return segments;
}

/** Parses a full rendered status line, which may be multi-line. */
export function parseOutput(output) {
  return output.replace(/\n$/, '').split('\n').map(parseLine);
}
