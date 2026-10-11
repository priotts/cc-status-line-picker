/**
 * git/full — everything about the repository state in one line: branch,
 * divergence from upstream, staged / modified / untracked counts, the worktree
 * name when you are inside one, and the open pull request for the branch.
 *
 *   ▸ my-project ⎇ main ↑2 ↓1 ●3 ○1 ?2 ⧉ feature-xyz ⑂ #1234 pending
 *
 * Merge conflicts show first, in red (`✗2`). The PR number is a clickable link
 * in terminals that support OSC 8.
 */
import { run } from '../lib/input.js';
import { loadConfig } from '../lib/config.js';
import { c, link } from '../lib/ansi.js';
import { getGitInfo } from '../lib/git.js';
import { basename, join, printLines } from '../lib/format.js';
import { fileMarkers } from '../lib/segments.js';
import type { ReviewState } from '../types.js';

/** Review states map onto the same green/yellow/red scale used elsewhere. */
function reviewColor(state: ReviewState): (t: string) => string {
  switch (state) {
    case 'approved':
      return c.ok;
    case 'changes_requested':
      return c.danger;
    default:
      return c.muted;
  }
}

run((input) => {
  const cfg = loadConfig();
  const cwd = input.workspace?.current_dir ?? input.cwd ?? null;
  const parts: Array<string | null> = [c.accent(`${cfg.icons.folder} ${basename(cwd)}`)];

  const git = cfg.showGit ? getGitInfo(cwd) : null;
  if (git) {
    parts.push(`${c.muted(cfg.icons.branch)} ${c.ok(git.branch)}`);

    const divergence: string[] = [];
    if (git.ahead > 0) divergence.push(c.accent(`${cfg.icons.ahead}${git.ahead}`));
    if (git.behind > 0) divergence.push(c.warn(`${cfg.icons.behind}${git.behind}`));
    if (divergence.length > 0) parts.push(divergence.join(''));

    const changes = fileMarkers(git);
    parts.push(changes.length > 0 ? changes.join(' ') : c.muted('clean'));
  }

  // `workspace.git_worktree` covers any linked worktree; `worktree.name` only
  // appears in `--worktree` sessions, so prefer whichever is present.
  const worktree = input.workspace?.git_worktree ?? input.worktree?.name;
  if (worktree) parts.push(c.muted(`${cfg.icons.worktree} ${worktree}`));

  if (typeof input.pr?.number === 'number') {
    const state = input.pr.review_state;
    const label = link(input.pr.url, c.accent(`${cfg.icons.pr} #${input.pr.number}`));
    parts.push(state ? `${label} ${reviewColor(state)(state)}` : label);
  }

  printLines([join(parts, ' ')]);
});
