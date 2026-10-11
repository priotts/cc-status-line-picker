/**
 * Git state for the current directory.
 *
 * The status line re-runs on every assistant message, and the Claude Code docs
 * explicitly warn that `git status` is slow enough to cause visible lag. Two
 * mitigations here:
 *   1. a single `git status --porcelain=v1 --branch` call gives branch,
 *      ahead/behind and all file counts at once;
 *   2. results are cached in a temp file, keyed by cwd, for a short TTL.
 *
 * Every failure mode (not a repo, git missing, timeout) returns `null` so the
 * caller simply omits the git section.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export interface GitInfo {
  branch: string;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  /** Unmerged paths left by a merge, rebase or cherry-pick. */
  conflicted: number;
  /** True when there is nothing staged, modified, untracked or conflicted. */
  clean: boolean;
}

const CACHE_TTL_MS = 2000;
const GIT_TIMEOUT_MS = 1500;

interface CacheEntry {
  at: number;
  info: GitInfo | null;
}

function cachePath(cwd: string): string {
  const key = createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `cc-slp-git-${key}.json`);
}

function readCache(file: string): CacheEntry | null {
  try {
    const entry = JSON.parse(readFileSync(file, 'utf8')) as CacheEntry;
    if (typeof entry?.at === 'number' && Date.now() - entry.at < CACHE_TTL_MS) return entry;
  } catch {
    // Missing or corrupt cache: fall through to a fresh call.
  }
  return null;
}

function writeCache(file: string, info: GitInfo | null): void {
  try {
    writeFileSync(file, JSON.stringify({ at: Date.now(), info } satisfies CacheEntry));
  } catch {
    // A read-only temp dir must not break the status line.
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

/**
 * Parses `git status --porcelain=v1 --branch`.
 *
 * Header: `## main...origin/main [ahead 1, behind 2]`, or `## main` with no
 * upstream, or `## HEAD (no branch)` when detached.
 * Entries: two status columns, `X` = staged, `Y` = worktree, `??` = untracked.
 * Unmerged paths (`UU`, `AA`, `DD`, or a `U` on either side) are conflicts,
 * counted on their own rather than as both staged and modified.
 */
function parseStatus(output: string): GitInfo {
  const info: GitInfo = {
    branch: '',
    detached: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
  };

  for (const line of output.split('\n')) {
    if (!line) continue;

    if (line.startsWith('## ')) {
      const header = line.slice(3);
      if (header.startsWith('HEAD (no branch)')) {
        info.detached = true;
      } else {
        const nameEnd = header.search(/\.{3}| \[/);
        info.branch = (nameEnd === -1 ? header : header.slice(0, nameEnd)).trim();
      }
      const ahead = /\bahead (\d+)/.exec(header);
      const behind = /\bbehind (\d+)/.exec(header);
      if (ahead?.[1]) info.ahead = Number.parseInt(ahead[1], 10);
      if (behind?.[1]) info.behind = Number.parseInt(behind[1], 10);
      continue;
    }

    const x = line[0];
    const y = line[1];
    if (x === '?' && y === '?') {
      info.untracked += 1;
      continue;
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      info.conflicted += 1;
      continue;
    }
    if (x && x !== ' ') info.staged += 1;
    if (y && y !== ' ') info.modified += 1;
  }

  info.clean =
    info.staged === 0 && info.modified === 0 && info.untracked === 0 && info.conflicted === 0;
  return info;
}

export function getGitInfo(cwd: string | null | undefined): GitInfo | null {
  if (!cwd) return null;

  const file = cachePath(cwd);
  const cached = readCache(file);
  if (cached) return cached.info;

  const output = git(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']);
  if (output === null) {
    // Not a repo, git unavailable, or timed out — all indistinguishable and all
    // handled the same way. Cached too, so we do not retry on every refresh.
    writeCache(file, null);
    return null;
  }

  const info = parseStatus(output);
  if (info.detached && !info.branch) {
    const sha = git(cwd, ['rev-parse', '--short', 'HEAD']);
    info.branch = sha ? sha.trim() : 'detached';
  }

  writeCache(file, info);
  return info;
}
