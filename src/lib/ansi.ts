/**
 * ANSI colors. Honors NO_COLOR (https://no-color.org): when set, every color
 * helper becomes the identity function and the output stays readable as plain
 * text.
 */
import { loadConfig } from './config.js';

const NAMED_FG: Record<string, string> = {
  black: '30',
  red: '31',
  green: '32',
  yellow: '33',
  blue: '34',
  magenta: '35',
  cyan: '36',
  white: '37',
  gray: '90',
  grey: '90',
  brightRed: '91',
  brightGreen: '92',
  brightYellow: '93',
  brightBlue: '94',
  brightMagenta: '95',
  brightCyan: '96',
  brightWhite: '97',
};

const NAMED_BG: Record<string, string> = {
  black: '40',
  red: '41',
  green: '42',
  yellow: '43',
  blue: '44',
  magenta: '45',
  cyan: '46',
  white: '47',
  gray: '100',
  grey: '100',
  brightRed: '101',
  brightGreen: '102',
  brightYellow: '103',
  brightBlue: '104',
  brightMagenta: '105',
  brightCyan: '106',
  brightWhite: '107',
};

export const colorEnabled = !process.env['NO_COLOR'];

/** Control Sequence Introducer. Written as an explicit escape so the source survives any encoding. */
const CSI = '[';
export const RESET = colorEnabled ? `${CSI}0m` : '';

/** Accepts a name ("cyan"), a 256-color index ("123"), or a raw SGR sequence ("38;5;123"). */
function fgCode(spec: string): string {
  const named = NAMED_FG[spec];
  if (named) return named;
  if (/^\d{1,3}$/.test(spec)) return `38;5;${spec}`;
  if (/^[\d;]+$/.test(spec)) return spec;
  return '39';
}

function bgCode(spec: string): string {
  const named = NAMED_BG[spec];
  if (named) return named;
  if (/^\d{1,3}$/.test(spec)) return `48;5;${spec}`;
  if (/^[\d;]+$/.test(spec)) return spec;
  return '49';
}

export function fg(spec: string, text: string): string {
  if (!colorEnabled || !text) return text;
  return `${CSI}${fgCode(spec)}m${text}${RESET}`;
}

export function bg(spec: string, text: string): string {
  if (!colorEnabled || !text) return text;
  return `${CSI}${bgCode(spec)}m${text}${RESET}`;
}

export function fgBg(fgSpec: string, bgSpec: string, text: string): string {
  if (!colorEnabled || !text) return text;
  return `${CSI}${fgCode(fgSpec)};${bgCode(bgSpec)}m${text}${RESET}`;
}

export function bold(text: string): string {
  if (!colorEnabled || !text) return text;
  return `${CSI}1m${text}${RESET}`;
}

export function dim(text: string): string {
  if (!colorEnabled || !text) return text;
  return `${CSI}2m${text}${RESET}`;
}

/** Operating System Command introducer and String Terminator, for OSC 8 links. */
const OSC = '\u001b]';
const ST = '\u001b\\';

/** Closes an OSC 8 hyperlink; `truncate` emits it when a cut lands inside one. */
export const LINK_END = `${OSC}8;;${ST}`;

/**
 * Makes `text` a clickable OSC 8 hyperlink to `url`. Terminals without OSC 8
 * support show the text unchanged. Off under NO_COLOR (the output must stay
 * plain text) and with `links: false`; only http(s) URLs are linked.
 */
export function link(url: string | null | undefined, text: string): string {
  if (!colorEnabled || !text || !url || !loadConfig().links) return text;
  if (!/^https?:\/\/[^\s\u0000-\u001f\u007f]+$/.test(url)) return text;
  return `${OSC}8;;${url}${ST}${text}${LINK_END}`;
}

/** Shorthands for the semantic roles defined in config.json. */
export const c = {
  accent: (t: string) => fg(loadConfig().colors.accent, t),
  ok: (t: string) => fg(loadConfig().colors.ok, t),
  warn: (t: string) => fg(loadConfig().colors.warn, t),
  danger: (t: string) => fg(loadConfig().colors.danger, t),
  muted: (t: string) => fg(loadConfig().colors.muted, t),
};

/** Green / yellow / red according to the configured thresholds. */
export function byThreshold(pct: number, text: string): string {
  const { thresholds } = loadConfig();
  if (pct >= thresholds.danger) return c.danger(text);
  if (pct >= thresholds.warn) return c.warn(text);
  return c.ok(text);
}

/** Raw color spec (not ANSI-wrapped) for the same threshold scale. */
export function thresholdSpec(pct: number): string {
  const { colors, thresholds } = loadConfig();
  if (pct >= thresholds.danger) return colors.danger;
  if (pct >= thresholds.warn) return colors.warn;
  return colors.ok;
}

/**
 * SGR color sequences plus OSC 8 hyperlink sequences, which end in ST (ESC \\)
 * or BEL. Neither takes a column.
 */
const ANSI_RE = /\u001b\[[0-9;]*m|\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** Combining marks, zero-width joiners and variation selectors take no column. */
const ZERO_WIDTH_RE = /^[\p{Mn}\p{Me}​-‍︀-️]$/u;

/**
 * East Asian wide / fullwidth characters and emoji drawn as emoji by default
 * take two columns. The ranges follow wcwidth; Nerd Font glyphs live in the
 * Private Use Area and stay at one.
 */
const WIDE_RE =
  /^[\p{Emoji_Presentation}ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3FFFD}]$/u;

/** Terminal columns taken by a single code point. */
export function charWidth(ch: string): number {
  if (ZERO_WIDTH_RE.test(ch)) return 0;
  return WIDE_RE.test(ch) ? 2 : 1;
}

/**
 * Visible width in terminal columns, ignoring escape sequences. Counts code
 * points, not UTF-16 units, so astral characters are not counted twice.
 */
export function visibleLength(text: string): number {
  let width = 0;
  for (const ch of text.replace(ANSI_RE, '')) width += charWidth(ch);
  return width;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
