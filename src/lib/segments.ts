/**
 * Composite segments shared by more than one style.
 */
import { loadConfig } from './config.js';
import { c, byThreshold, link } from './ansi.js';
import { pct, resetsIn, resetsAtClock } from './format.js';
import type { GitInfo } from './git.js';
import type { PullRequestInfo, RateLimitWindow, StatusLineInput, VimMode } from '../types.js';

/** Nominal length of each rate-limit window, in seconds. */
export const WINDOW_SECONDS = { '5h': 5 * 3600, '7d': 7 * 86_400 } as const;

export type WindowLabel = keyof typeof WINDOW_SECONDS;

/**
 * Below this fraction of the window elapsed, a projection is mostly noise:
 * dividing by a small elapsed fraction turns a short burst into an alarming
 * number. Nothing is shown until the window is a fifth of the way through.
 */
const MIN_ELAPSED_FRACTION = 0.2;

/**
 * Projects final usage from the current average rate, keeping no history.
 *
 * ASSUMES A FIXED WINDOW: one that starts, runs for its nominal length and
 * resets, so elapsed time can be derived from `resets_at` alone. If these
 * windows turn out to slide instead, the elapsed fraction is meaningless and
 * this must go. Verifiable by watching `resets_at`: a fixed window holds steady
 * for hours and then jumps, a sliding one creeps continuously.
 *
 * Returns null whenever a projection would be unreliable.
 */
export function projectedUsage(
  used: number,
  resetsAt: number | null | undefined,
  windowSeconds: number,
): number | null {
  if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) || resetsAt <= 0) return null;

  const secondsLeft = resetsAt - Date.now() / 1000;
  if (secondsLeft <= 0 || secondsLeft > windowSeconds) return null;

  const elapsed = (windowSeconds - secondsLeft) / windowSeconds;
  if (elapsed < MIN_ELAPSED_FRACTION) return null;

  return used / elapsed;
}

/**
 * One rate-limit window: `5h 24% (4h11m · 18:30)`.
 *
 * The countdown answers "how long do I have", the clock answers "when can I
 * start again" — both are useful and neither replaces the other. Set
 * `showResetTime: false` in config.json to drop the clock and keep it shorter.
 *
 * Returns null when the window is absent, so callers can skip it cleanly.
 */
export function limitSegment(
  label: string,
  window: RateLimitWindow | null | undefined,
): string | null {
  if (typeof window?.used_percentage !== 'number') return null;

  const cfg = loadConfig();
  const used = pct(window.used_percentage);
  const value = byThreshold(used, `${Math.round(used)}%`);

  const left = resetsIn(window.resets_at);
  const clock = cfg.showResetTime ? resetsAtClock(window.resets_at) : '';
  const when = [left, clock].filter(Boolean).join(' · ');

  return c.muted(`${label} `) + value + (when ? c.muted(` (${when})`) : '');
}

/**
 * One rate-limit window as consumed-and-heading-for: `5h 24%` or `5h 71%→266%`.
 *
 * Reads as "you are at 71, heading for 266". The arrow and the projection turn
 * red together, and only when the window would be exhausted before it resets —
 * so on a quiet session the whole line stays green and grey, and red means one
 * thing only.
 *
 * When there is not yet enough elapsed window to project, the arrow is simply
 * absent and the segment gets shorter on its own.
 *
 * The wall-clock reset time follows in parentheses, unless `showResetTime` is
 * off. The projection says where you are heading; the clock says when the slate
 * is wiped. Both matter and neither implies the other.
 */
export function paceSegment(
  label: WindowLabel,
  window: RateLimitWindow | null | undefined,
): string | null {
  if (typeof window?.used_percentage !== 'number') return null;

  const used = pct(window.used_percentage);
  let out = c.muted(`${label} `) + byThreshold(used, `${Math.round(used)}%`);

  const projected = projectedUsage(used, window.resets_at, WINDOW_SECONDS[label]);
  if (projected !== null) {
    const arrow = `→${Math.round(projected)}%`;
    out += projected > 100 ? c.danger(arrow) : c.muted(arrow);
  }

  if (loadConfig().showResetTime) {
    const clock = resetsAtClock(window.resets_at);
    if (clock) out += c.muted(` (${clock})`);
  }

  return out;
}

/**
 * Working-tree markers: `✗2 ●3 ○1 ?2`. Conflicts come first and in red — they
 * block everything else. Empty when the tree is clean.
 */
export function fileMarkers(git: GitInfo): string[] {
  const { icons } = loadConfig();
  const out: string[] = [];
  if (git.conflicted > 0) out.push(c.danger(`${icons.conflict}${git.conflicted}`));
  if (git.staged > 0) out.push(c.ok(`${icons.staged}${git.staged}`));
  if (git.modified > 0) out.push(c.warn(`${icons.modified}${git.modified}`));
  if (git.untracked > 0) out.push(c.muted(`${icons.untracked}${git.untracked}`));
  return out;
}

/**
 * The open pull request, `⑂ #1234`, as a clickable link to it when the
 * terminal supports OSC 8. Null when there is no PR.
 */
export function prSegment(pr: PullRequestInfo | null | undefined): string | null {
  if (typeof pr?.number !== 'number') return null;
  return link(pr.url, c.accent(`${loadConfig().icons.pr} #${pr.number}`));
}

/** ` high` after the model name, so the effort reads as part of it. */
export function effortTag(input: StatusLineInput): string {
  const level = input.effort?.level;
  return level && loadConfig().showSession ? c.muted(` ${level}`) : '';
}

function vimColor(mode: VimMode): (t: string) => string {
  if (mode === 'INSERT') return c.ok;
  if (mode === 'NORMAL') return c.accent;
  return c.warn;
}

/**
 * Who and how: the session name (when `withName`), the running agent `@name`
 * and the vim mode. Each part shows only when Claude Code sends it, so on a
 * plain session this is null and costs no space.
 */
export function sessionSegment(input: StatusLineInput, withName = false): string | null {
  const cfg = loadConfig();
  if (!cfg.showSession) return null;

  const parts: string[] = [];
  if (withName && input.session_name) parts.push(c.muted(`“${input.session_name}”`));
  if (input.agent?.name) parts.push(c.accent(`${cfg.icons.agent}${input.agent.name}`));
  if (input.vim?.mode) parts.push(vimColor(input.vim.mode)(input.vim.mode));
  return parts.length > 0 ? parts.join(' ') : null;
}
