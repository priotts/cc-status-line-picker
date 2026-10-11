/**
 * User overrides read from `config.json`.
 *
 * The file is looked up NEXT TO the running script (via import.meta.url), not in
 * the cwd: the status line runs with an arbitrary cwd, while the active script
 * always lives in ~/.claude/statusline-picker/ alongside its config.
 *
 * Anything that goes wrong (missing file, invalid JSON, unknown keys) silently
 * falls back to the defaults: a status line must never fail because of config.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface Thresholds {
  /** Percentage at which a value turns yellow. */
  warn: number;
  /** Percentage at which a value turns red. */
  danger: number;
}

export interface Config {
  colors: {
    accent: string;
    ok: string;
    warn: string;
    danger: string;
    muted: string;
  };
  icons: {
    branch: string;
    model: string;
    folder: string;
    context: string;
    cost: string;
    clock: string;
    added: string;
    removed: string;
    staged: string;
    modified: string;
    untracked: string;
    conflict: string;
    ahead: string;
    behind: string;
    pr: string;
    worktree: string;
    fast: string;
    agent: string;
  };
  separator: string;
  barWidth: number;
  barChars: { filled: string; empty: string };
  showModel: boolean;
  showGit: boolean;
  showCost: boolean;
  showLimits: boolean;
  /** Append the wall-clock reset time next to the countdown, e.g. `(4h11m · 18:30)`. */
  showResetTime: boolean;
  /** Agent name, vim mode, session name and effort level, where a style has room. */
  showSession: boolean;
  /** Make the PR number a clickable OSC 8 link to the pull request. */
  links: boolean;
  /**
   * Branch names treated as "the trunk". Anything else is a feature branch and
   * `fancy/powerline` tints it differently. A list because the convention is
   * not universal — trunk, develop and integration all exist in the wild.
   */
  defaultBranches: string[];
  thresholds: Thresholds;
}

export const DEFAULT_CONFIG: Config = {
  colors: {
    accent: 'cyan',
    ok: 'green',
    warn: 'yellow',
    danger: 'red',
    muted: 'gray',
  },
  icons: {
    branch: '⎇',
    model: '◆',
    folder: '▸',
    context: '▤',
    cost: '$',
    clock: '◴',
    added: '+',
    removed: '-',
    staged: '●',
    modified: '○',
    untracked: '?',
    conflict: '✗',
    ahead: '↑',
    behind: '↓',
    pr: '⑂',
    worktree: '⧉',
    fast: '⚡',
    agent: '@',
  },
  separator: ' · ',
  barWidth: 10,
  barChars: { filled: '█', empty: '░' },
  showModel: true,
  showGit: true,
  showCost: true,
  showLimits: true,
  showResetTime: true,
  showSession: true,
  links: true,
  defaultBranches: ['main', 'master'],
  thresholds: { warn: 70, danger: 90 },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Per-section shallow merge, so overriding one icon does not drop the others. */
function merge(base: Config, override: Record<string, unknown>): Config {
  const out: Config = {
    ...base,
    colors: { ...base.colors },
    icons: { ...base.icons },
    barChars: { ...base.barChars },
    thresholds: { ...base.thresholds },
  };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;

    switch (key) {
      case 'colors':
      case 'icons':
      case 'barChars':
        if (isRecord(value)) {
          for (const [k, v] of Object.entries(value)) {
            if (typeof v === 'string' && k in out[key]) {
              (out[key] as Record<string, string>)[k] = v;
            }
          }
        }
        break;
      case 'thresholds':
        if (isRecord(value)) {
          if (typeof value['warn'] === 'number') out.thresholds.warn = value['warn'];
          if (typeof value['danger'] === 'number') out.thresholds.danger = value['danger'];
        }
        break;
      case 'separator':
        if (typeof value === 'string') out.separator = value;
        break;
      case 'defaultBranches':
        if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
          out.defaultBranches = value as string[];
        }
        break;
      case 'barWidth':
        if (typeof value === 'number' && value > 0) out.barWidth = Math.min(40, Math.floor(value));
        break;
      case 'showModel':
      case 'showGit':
      case 'showCost':
      case 'showLimits':
      case 'showResetTime':
      case 'showSession':
      case 'links':
        if (typeof value === 'boolean') out[key] = value;
        break;
    }
  }

  return out;
}

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;

  cached = DEFAULT_CONFIG;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(path.join(here, 'config.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed)) cached = merge(DEFAULT_CONFIG, parsed);
  } catch {
    // No config file (or a broken one): keep the defaults.
  }
  return cached;
}
