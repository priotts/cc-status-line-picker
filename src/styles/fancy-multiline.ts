/**
 * fancy/multiline — two lines, everything at a glance.
 *
 *   ◆ Opus high “my session” @reviewer INSERT ▸ my-project ⎇ main ✗1 ●3 ○1 ⑂ #1234
 *   ▤ ████░░░░░░ 38% · $0.42 · 5h 23% (4h12m) · 7d 41% (2d6h)
 *
 * Line one is identity and repository state, line two is consumption. Each line
 * is truncated independently, so a narrow terminal loses detail rather than
 * wrapping.
 */
import { run } from '../lib/input.js';
import { loadConfig } from '../lib/config.js';
import { c, byThreshold } from '../lib/ansi.js';
import { getGitInfo } from '../lib/git.js';
import { bar, basename, join, money, pct, printLines } from '../lib/format.js';
import { limitSegment, effortTag, fileMarkers, prSegment, sessionSegment } from '../lib/segments.js';

run((input) => {
  const cfg = loadConfig();
  const cwd = input.workspace?.current_dir ?? input.cwd ?? null;

  // Line 1 — who and where.
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

  // Line 2 — what it is costing.
  const bottom: Array<string | null> = [];
  const ctx = pct(input.context_window?.used_percentage);
  bottom.push(
    `${c.muted(cfg.icons.context)} ${byThreshold(ctx, bar(ctx))} ${byThreshold(ctx, `${Math.round(ctx)}%`)}`,
  );

  if (cfg.showCost && typeof input.cost?.total_cost_usd === 'number') {
    bottom.push(money(input.cost.total_cost_usd));
  }

  if (cfg.showLimits) {
    bottom.push(limitSegment('5h', input.rate_limits?.five_hour));
    bottom.push(limitSegment('7d', input.rate_limits?.seven_day));
  }

  printLines([join(top, ' '), join(bottom)]);
});
