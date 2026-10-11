/**
 * Formatting helpers shared by every style.
 */
import { loadConfig } from './config.js';
import { visibleLength, stripAnsi, charWidth, RESET } from './ansi.js';

/** Clamp a possibly-null percentage into 0..100. */
export function pct(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Progress bar such as `████░░░░░░`. */
export function bar(percentage: number, width?: number): string {
  const cfg = loadConfig();
  const w = width ?? cfg.barWidth;
  const filled = Math.max(0, Math.min(w, Math.round((pct(percentage) / 100) * w)));
  return cfg.barChars.filled.repeat(filled) + cfg.barChars.empty.repeat(w - filled);
}

/** Left-to-right eighth blocks, for sub-character bar resolution. */
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * Progress bar with eight times the resolution of `bar`, in the same width:
 * the last cell is drawn as a partial block instead of rounding to a whole one.
 *
 *   bar(38, 10)      ████░░░░░░
 *   fineBar(38, 10)  ███▊░░░░░░
 *
 * Kept separate from `bar` on purpose — the existing styles are unchanged.
 */
export function fineBar(percentage: number, width?: number): string {
  const cfg = loadConfig();
  const w = width ?? cfg.barWidth;
  const units = (pct(percentage) / 100) * w * 8;
  const full = Math.min(w, Math.floor(units / 8));
  const partial = full < w ? EIGHTHS[Math.floor(units % 8)] ?? '' : '';
  return (cfg.barChars.filled.repeat(full) + partial).padEnd(w, cfg.barChars.empty);
}

/** Last path segment, handling both separators since Windows paths reach us as-is. */
export function basename(dir: string | null | undefined): string {
  if (!dir) return '?';
  const cleaned = dir.replace(/[\\/]+$/, '');
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || cleaned || '?';
}

/** `1.2k`, `15.5k`, `1.1M` — keeps token counts short. */
export function compactNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) {
    const k = value / 1000;
    return `${k < 10 ? k.toFixed(1) : Math.round(k)}k`;
  }
  const m = value / 1_000_000;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)}M`;
}

/** `$0.42`, `$12.30`. Sub-cent amounts collapse to `$0.00` rather than scientific notation. */
export function money(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '$0.00';
  return `$${value.toFixed(2)}`;
}

/** `45s`, `12m`, `2h14m` — a wall-clock duration from milliseconds. */
export function duration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h${String(rem).padStart(2, '0')}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

/**
 * Time left until a rate-limit window resets.
 * `resets_at` is Unix epoch SECONDS; returns an empty string when unknown.
 */
export function resetsIn(epochSeconds: number | null | undefined): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return '';
  }
  const msLeft = epochSeconds * 1000 - Date.now();
  if (msLeft <= 0) return 'now';
  return duration(msLeft);
}

/**
 * Wall-clock time a rate-limit window resets at, e.g. `18:30`.
 *
 * Complements `resetsIn`: the countdown says how long is left, this says when.
 * Formatted with the system locale, so 24h/12h follows the user's settings.
 * Past 24 hours the weekday is prepended — a bare `18:30` two days out would be
 * ambiguous. Returns an empty string when unknown or already elapsed.
 */
export function resetsAtClock(epochSeconds: number | null | undefined): string {
  if (typeof epochSeconds !== 'number' || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return '';
  }
  const msLeft = epochSeconds * 1000 - Date.now();
  if (msLeft <= 0) return '';

  const at = new Date(epochSeconds * 1000);
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (msLeft < 24 * 60 * 60 * 1000) return time;
  return `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

/** Drops empty/undefined parts before joining, so a missing section leaves no dangling separator. */
export function join(parts: Array<string | null | undefined>, separator?: string): string {
  const sep = separator ?? loadConfig().separator;
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(sep);
}

/** Terminal width. Claude Code exports COLUMNS because `tput cols` cannot work from here. */
export function terminalWidth(): number {
  const raw = Number.parseInt(process.env['COLUMNS'] ?? '', 10);
  return Number.isFinite(raw) && raw > 20 ? raw : 120;
}

/**
 * Truncate to the visible width, keeping ANSI sequences intact.
 * Walks the string once, copying escape sequences for free and counting only
 * printable characters by the columns they take, then appends a reset so color
 * never bleeds.
 */
export function truncate(text: string, width?: number): string {
  const max = width ?? terminalWidth();
  if (visibleLength(text) <= max) return text;
  if (max <= 1) return stripAnsi(text).slice(0, Math.max(0, max));

  const limit = max - 1;
  let out = '';
  let visible = 0;
  let i = 0;
  let sawEscape = false;

  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const end = text.indexOf('m', i);
      if (end === -1) break;
      out += text.slice(i, end + 1);
      sawEscape = true;
      i = end + 1;
      continue;
    }
    // Whole code points only: slicing by UTF-16 unit would split a surrogate
    // pair and print U+FFFD. A wide character that does not fit is dropped.
    const ch = String.fromCodePoint(text.codePointAt(i) ?? 0);
    const w = charWidth(ch);
    if (visible + w > limit) break;
    out += ch;
    visible += w;
    i += ch.length;
  }

  // Reset only if we copied an escape, so a colorless line stays byte-clean.
  return `${out}${sawEscape ? RESET : ''}…`;
}

/** Applies `truncate` per line: a multi-line style must not wrap either. */
export function printLines(lines: Array<string | null | undefined>): void {
  const width = terminalWidth();
  const out = lines
    .filter((l): l is string => typeof l === 'string' && l.length > 0)
    .map((l) => truncate(l, width));
  if (out.length > 0) process.stdout.write(`${out.join('\n')}\n`);
}
