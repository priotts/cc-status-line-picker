/**
 * fancy/dashboard — four lines, three aligned bars.
 *
 *   ◆ Opus ▸ my-project ⎇ main ●3 ○1 ?2
 *   ctx █████▎░░░░░░░░ 38%   76k/200k   $0.42 · ◴ 12m · +156 -23
 *    5h ███▎░░░░░░░░░░ 24%  resets 21:12 (4h11m)
 *    7d █████▋░░░░░░░░ 41%  resets Tue 22:01 (2d4h)  ▲ on pace for 154%
 *
 * Putting context and both rate-limit windows on the same scale, one under the
 * other, is the whole point: you can see at a glance which one will run out
 * first. That comparison is what a single inline row cannot give you.
 *
 * This is also the only style that uses `fineBar`; the others keep whole blocks.
 */
import { run } from '../lib/input.js';
import { loadConfig, DEFAULT_CONFIG } from '../lib/config.js';
import { c, byThreshold } from '../lib/ansi.js';
import { getGitInfo } from '../lib/git.js';
import {
  basename,
  compactNumber,
  duration,
  fineBar,
  join,
  money,
  pct,
  printLines,
  resetsAtClock,
  resetsIn,
} from '../lib/format.js';
import { projectedUsage, WINDOW_SECONDS, type WindowLabel, effortTag, fileMarkers, prSegment, sessionSegment } from '../lib/segments.js';
import type { RateLimitWindow } from '../types.js';

/** Wider than the other styles because the layout has the room for it. */
const DASHBOARD_BAR_WIDTH = 14;

function barWidth(): number {
  const cfg = loadConfig();
  // Honour an explicit override, otherwise use this style's wider default.
  return cfg.barWidth === DEFAULT_CONFIG.barWidth ? DASHBOARD_BAR_WIDTH : cfg.barWidth;
}

/** `ctx ████▎░░░ 38%` — label, bar and percentage on a fixed grid so rows align. */
function gauge(label: string, percentage: number): string {
  const value = `${Math.round(percentage)}%`.padEnd(4);
  return `${c.muted(label.padStart(3))} ${byThreshold(percentage, fineBar(percentage, barWidth()))} ${byThreshold(percentage, value)}`;
}

function limitRow(label: WindowLabel, window: RateLimitWindow | null | undefined): string | null {
  if (typeof window?.used_percentage !== 'number') return null;

  const used = pct(window.used_percentage);
  const clock = resetsAtClock(window.resets_at);
  const left = resetsIn(window.resets_at);
  const reset = clock ? `resets ${clock}${left ? ` (${left})` : ''}` : '';

  const projected = projectedUsage(used, window.resets_at, WINDOW_SECONDS[label]);
  let pace = '';
  if (projected !== null) {
    const text = `on pace for ${Math.round(projected)}%`;
    // Only flag the case that needs action: running out before the reset.
    pace = projected > 100 ? c.danger(`▲ ${text}`) : c.muted(`▸ ${text}`);
  }

  return `${gauge(label, used)}  ${join([c.muted(reset), pace], '  ')}`;
}

run((input) => {
  const cfg = loadConfig();
  const cwd = input.workspace?.current_dir ?? input.cwd ?? null;

  // Line 1 — identity and repository state.
  const top: Array<string | null> = [];

  if (cfg.showModel && input.model?.display_name) {
    const fast = input.fast_mode ? c.warn(` ${cfg.icons.fast}`) : '';
    top.push(c.muted(`${cfg.icons.model} `) + input.model.display_name + effortTag(input) + fast);
  }

  top.push(sessionSegment(input, true));

  top.push(c.accent(`${cfg.icons.folder} ${basename(cwd)}`));

  const git = cfg.showGit ? getGitInfo(cwd) : null;
  if (git) {
    top.push(`${c.muted(cfg.icons.branch)} ${c.ok(git.branch)}`);

    const changes: string[] = [];
    if (git.ahead > 0) changes.push(c.accent(`${cfg.icons.ahead}${git.ahead}`));
    if (git.behind > 0) changes.push(c.warn(`${cfg.icons.behind}${git.behind}`));
    changes.push(...fileMarkers(git));
    if (changes.length > 0) top.push(changes.join(' '));
  }

  const worktree = input.workspace?.git_worktree ?? input.worktree?.name;
  if (worktree) top.push(c.muted(`${cfg.icons.worktree} ${worktree}`));
  top.push(prSegment(input.pr));

  // Line 2 — context, with the session totals alongside it.
  const ctxUsed = pct(input.context_window?.used_percentage);
  const totalTokens =
    (input.context_window?.total_input_tokens ?? 0) +
    (input.context_window?.total_output_tokens ?? 0);
  const windowSize = input.context_window?.context_window_size ?? 200_000;

  const ctxTail: Array<string | null> = [
    totalTokens > 0 ? c.muted(`${compactNumber(totalTokens)}/${compactNumber(windowSize)}`) : null,
  ];

  if (cfg.showCost && typeof input.cost?.total_cost_usd === 'number') {
    const added = input.cost.total_lines_added ?? 0;
    const removed = input.cost.total_lines_removed ?? 0;
    const lines = added > 0 || removed > 0 ? ` ${c.muted(`+${added} -${removed}`)}` : '';
    ctxTail.push(
      c.accent(money(input.cost.total_cost_usd)) +
        c.muted(` ${cfg.icons.clock} ${duration(input.cost.total_duration_ms)}`) +
        lines,
    );
  }

  const contextRow = `${gauge('ctx', ctxUsed)}  ${join(ctxTail, '  ')}`;

  // Lines 3 and 4 — the rate-limit windows, on the same scale as the context.
  const limits = cfg.showLimits
    ? [limitRow('5h', input.rate_limits?.five_hour), limitRow('7d', input.rate_limits?.seven_day)]
    : [];

  printLines([join(top, ' '), contextRow, ...limits]);
});
