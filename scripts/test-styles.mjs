#!/usr/bin/env node
/**
 * Smoke tests for every built style.
 *
 * The contract each style must honour:
 *   - never crash, whatever stdin contains (the docs note stderr is not shown,
 *     so a crash is an invisible failure);
 *   - always print something, so an empty status bar always means a real bug;
 *   - respect COLUMNS, so no line ever wraps;
 *   - emit no ANSI sequences when NO_COLOR is set.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gallery = JSON.parse(readFileSync(path.join(root, 'styles.json'), 'utf8'));

const sample = JSON.parse(readFileSync(path.join(root, 'examples', 'session.json'), 'utf8'));
delete sample.$comment;

/** SGR colors and OSC 8 hyperlinks, the same set src/lib/ansi.ts strips. */
const ANSI_RE = /\u001b\[[0-9;]*m|\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const OSC8_OPEN = /\u001b\]8;;[^\u0007\u001b]+\u001b\\/g;
const OSC8_CLOSE = /\u001b\]8;;\u001b\\/g;

/**
 * Terminal columns, the same rule as src/lib/ansi.ts: astral characters count
 * once, wide CJK and emoji count twice, combining marks not at all.
 */
function displayWidth(line) {
  let width = 0;
  for (const ch of line.replace(ANSI_RE, '')) {
    if (/^[\p{Mn}\p{Me}\u200B-\u200D\uFE00-\uFE0F]$/u.test(ch)) continue;
    width += /^[\p{Emoji_Presentation}\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]$/u.test(ch) ? 2 : 1;
  }
  return width;
}

/** Payloads a style must survive. Fields are null or missing before the first API response. */
const CASES = [
  { name: 'full sample', input: JSON.stringify(sample) },
  { name: 'empty object', input: '{}' },
  { name: 'empty stdin', input: '' },
  { name: 'not json', input: 'hello' },
  { name: 'json array', input: '[]' },
  {
    name: 'all nulls',
    input: JSON.stringify({
      cwd: null,
      model: null,
      workspace: null,
      cost: null,
      context_window: null,
      rate_limits: null,
      pr: null,
      worktree: null,
    }),
  },
  {
    name: 'nested nulls',
    input: JSON.stringify({
      model: { display_name: null },
      workspace: { current_dir: null, repo: null },
      context_window: { used_percentage: null, context_window_size: null },
      rate_limits: { five_hour: { used_percentage: null, resets_at: null }, seven_day: null },
      cost: { total_cost_usd: null, total_duration_ms: null },
      pr: { number: null },
    }),
  },
  {
    name: '1M context window at 97%',
    input: JSON.stringify({
      ...sample,
      context_window: {
        total_input_tokens: 970_000,
        total_output_tokens: 4000,
        context_window_size: 1_000_000,
        used_percentage: 97.4,
      },
      exceeds_200k_tokens: true,
    }),
  },
  {
    name: 'agent and vim mode',
    input: JSON.stringify({
      ...sample,
      agent: { name: 'reviewer' },
      vim: { mode: 'INSERT' },
    }),
  },
  {
    name: 'PR with a hostile url',
    input: JSON.stringify({
      ...sample,
      pr: { number: 7, url: 'javascript:alert(1)\u001b]8;;x\u001b\\', review_state: 'approved' },
    }),
  },
  {
    name: 'expired rate limit windows',
    input: JSON.stringify({
      ...sample,
      rate_limits: {
        five_hour: { used_percentage: 100, resets_at: 1 },
        seven_day: { used_percentage: 0, resets_at: 0 },
      },
    }),
  },
];

let failures = 0;

function check(styleId, caseName, condition, detail) {
  if (condition) return;
  failures += 1;
  console.error(`FAIL  ${styleId}  [${caseName}]  ${detail}`);
}

function runStyle(file, input, env) {
  return execFileSync(process.execPath, [file], {
    input,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, ...env },
    windowsHide: true,
  });
}

for (const style of gallery.styles) {
  const file = path.join(root, style.file);
  if (!existsSync(file)) {
    failures += 1;
    console.error(`FAIL  ${style.id}  missing build output ${style.file} — run \`npm run build\``);
    continue;
  }

  for (const testCase of CASES) {
    let output;
    try {
      output = runStyle(file, testCase.input, { COLUMNS: '120' });
    } catch (error) {
      failures += 1;
      console.error(`FAIL  ${style.id}  [${testCase.name}]  crashed: ${error.message}`);
      continue;
    }

    const lines = output.replace(/\n$/, '').split('\n');
    check(style.id, testCase.name, output.trim().length > 0, 'produced no output');
    check(
      style.id,
      testCase.name,
      !output.includes('statusline error:'),
      `hit the error fallback: ${output.trim()}`,
    );
    check(
      style.id,
      testCase.name,
      lines.length <= style.lines,
      `printed ${lines.length} lines, manifest declares ${style.lines}`,
    );
    for (const line of lines) {
      check(
        style.id,
        testCase.name,
        displayWidth(line) <= 120,
        `line exceeds COLUMNS=120: ${displayWidth(line)} columns`,
      );
    }
  }

  // Narrow terminal: output must be truncated, not wrapped.
  const narrow = runStyle(file, JSON.stringify(sample), { COLUMNS: '40' });
  for (const line of narrow.replace(/\n$/, '').split('\n')) {
    check(
      style.id,
      'COLUMNS=40',
      displayWidth(line) <= 40,
      `line exceeds COLUMNS=40: ${displayWidth(line)} columns`,
    );
  }

  // Wide and astral characters: measured in columns, never split in half.
  // Odd widths are the ones that would cut a surrogate pair or a CJK glyph.
  const wide = JSON.stringify({
    ...sample,
    workspace: { ...sample.workspace, current_dir: '/work/日本語のプロジェクト-𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜𝒜-🚀🚀🚀🚀🚀🚀' },
    model: { ...sample.model, display_name: 'Opus 🚀 测试模型' },
  });
  for (const cols of [41, 57, 83]) {
    const out = runStyle(file, wide, { COLUMNS: String(cols) });
    for (const line of out.replace(/\n$/, '').split('\n')) {
      check(
        style.id,
        `wide chars COLUMNS=${cols}`,
        displayWidth(line) <= cols,
        `line exceeds COLUMNS=${cols}: ${displayWidth(line)} columns`,
      );
      check(style.id, `wide chars COLUMNS=${cols}`, !line.includes('\uFFFD'), 'split a character');
    }
  }

  // Every hyperlink opened must be closed, including when the cut lands inside
  // one, or the rest of the terminal row turns into a link.
  // The cut is aimed at the middle of `#1234`, wherever this style puts it.
  const full = runStyle(file, JSON.stringify(sample), { COLUMNS: '300' });
  const cuts = [120];
  for (const line of full.split('\n')) {
    const at = displayWidth(line.replace(ANSI_RE, '').split(`#${sample.pr.number}`)[0] ?? '');
    if (line.includes(`#${sample.pr.number}`) && at + 3 > 20) cuts.push(at + 3);
  }
  for (const cols of cuts) {
    const out = runStyle(file, JSON.stringify(sample), { COLUMNS: String(cols) });
    const opened = (out.match(OSC8_OPEN) ?? []).length;
    const closed = (out.match(OSC8_CLOSE) ?? []).length;
    check(style.id, `links COLUMNS=${cols}`, opened === closed, `${opened} link(s) opened, ${closed} closed`);
  }

  // NO_COLOR must strip every escape sequence.
  const plain = runStyle(file, JSON.stringify(sample), { COLUMNS: '120', NO_COLOR: '1' });
  check(style.id, 'NO_COLOR', !ANSI_RE.test(plain), 'emitted ANSI escapes with NO_COLOR set');
  ANSI_RE.lastIndex = 0;
}

// Feature checks against specific styles.
const styleFile = (id) => path.join(root, gallery.styles.find((s) => s.id === id).file);
const plainOf = (out) => out.replace(ANSI_RE, '');

{
  // The PR number links to the PR, and only to an http(s) url.
  const out = runStyle(styleFile('git/full'), JSON.stringify(sample), { COLUMNS: '200' });
  check('git/full', 'pr link', out.includes(`\u001b]8;;${sample.pr.url}\u001b\\`), 'PR number is not linked');
  const hostile = runStyle(styleFile('git/full'), CASES.find((c) => c.name === 'PR with a hostile url').input, {
    COLUMNS: '200',
  });
  check('git/full', 'pr link', !hostile.includes('\u001b]8;;'), 'linked a non-http url');
  const noLinks = runStyle(styleFile('git/full'), JSON.stringify(sample), { COLUMNS: '200', NO_COLOR: '1' });
  check('git/full', 'pr link', !noLinks.includes('\u001b]'), 'linked under NO_COLOR');
}

{
  // Agent and vim mode reach the styles that show them; absent, they leave no trace.
  const input = CASES.find((c) => c.name === 'agent and vim mode').input;
  for (const id of ['minimal/basic', 'fancy/multiline', 'fancy/dashboard']) {
    const out = plainOf(runStyle(styleFile(id), input, { COLUMNS: '200' }));
    check(id, 'session', out.includes('@reviewer') && out.includes('INSERT'), `missing agent/vim: ${out}`);
    const plain = plainOf(runStyle(styleFile(id), JSON.stringify(sample), { COLUMNS: '200' }));
    check(id, 'session', !plain.includes('@') && !plain.includes('INSERT'), `stray session marker: ${plain}`);
  }
}

{
  // A real merge conflict is counted as a conflict, not as staged + modified.
  const repo = mkdtempSync(path.join(os.tmpdir(), 'cc-slp-conflict-'));
  const g = (...args) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      stdio: 'ignore',
    });
  try {
    g('init', '-q', '-b', 'main');
    writeFileSync(path.join(repo, 'f.txt'), 'base\n');
    g('add', '.');
    g('commit', '-qm', 'base');
    g('checkout', '-qb', 'other');
    writeFileSync(path.join(repo, 'f.txt'), 'other\n');
    g('commit', '-qam', 'other');
    g('checkout', '-q', 'main');
    writeFileSync(path.join(repo, 'f.txt'), 'main\n');
    g('commit', '-qam', 'main');
    try {
      g('merge', '-q', 'other');
    } catch {
      // The conflict is the point.
    }
    const input = JSON.stringify({ ...sample, cwd: repo, workspace: { current_dir: repo } });
    const out = plainOf(runStyle(styleFile('git/full'), input, { COLUMNS: '200' }));
    check('git/full', 'conflict', out.includes('✗1'), `conflict not shown: ${out}`);
    check('git/full', 'conflict', !out.includes('●') && !out.includes('○'), `conflict double-counted: ${out}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`All checks passed: ${gallery.styles.length} styles x ${CASES.length} payloads`);
