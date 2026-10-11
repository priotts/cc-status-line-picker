#!/usr/bin/env node
/**
 * Renders styles against a sample session payload without touching settings.json.
 *
 *   node scripts/preview.mjs                 # every style, grouped by category
 *   node scripts/preview.mjs git/full        # one style
 *   node scripts/preview.mjs --json          # [{ id, name, output }] for programmatic use
 *
 * The sample payload is patched at run time so previews are truthful:
 *   - `resets_at` become live timestamps, otherwise every countdown reads "now";
 *   - the working directory becomes the real cwd, so git-aware styles show this
 *     repository instead of omitting the section for a path that does not exist.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** OSC 8 hyperlink open/close sequences, terminated by ST or BEL. */
const OSC8_RE = /\u001b\]8;[^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const gallery = JSON.parse(readFileSync(path.join(root, 'styles.json'), 'utf8'));

function samplePayload() {
  const sample = JSON.parse(readFileSync(path.join(root, 'examples', 'session.json'), 'utf8'));
  delete sample.$comment;

  const nowSeconds = Math.floor(Date.now() / 1000);
  sample.rate_limits.five_hour.resets_at = nowSeconds + 4 * 3600 + 12 * 60;
  sample.rate_limits.seven_day.resets_at = nowSeconds + 2 * 86400 + 6 * 3600;

  const cwd = process.cwd();
  sample.cwd = cwd;
  sample.workspace.current_dir = cwd;
  sample.workspace.project_dir = cwd;

  return JSON.stringify(sample);
}

function renderStyle(style, payload) {
  const file = path.join(root, style.file);
  if (!existsSync(file)) {
    return { error: `missing build output: ${style.file} — run \`npm run build\`` };
  }
  try {
    const output = execFileSync(process.execPath, [file], {
      input: payload,
      encoding: 'utf8',
      timeout: 10_000,
      // Styles read COLUMNS to size themselves; give previews a stable width.
      env: { ...process.env, COLUMNS: process.env.COLUMNS ?? '120' },
      windowsHide: true,
    });
    // OSC 8 links are dropped: a preview is something to look at, not to click,
    // and the URL inside them would survive a naive strip of the color codes.
    return { output: output.replace(/\n$/, '').replace(OSC8_RE, '') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const wanted = args.filter((a) => !a.startsWith('--'));

let styles = gallery.styles;
if (wanted.length > 0) {
  styles = gallery.styles.filter((s) => wanted.includes(s.id));
  const unknown = wanted.filter((id) => !gallery.styles.some((s) => s.id === id));
  if (unknown.length > 0) {
    fail(
      `Unknown style: ${unknown.join(', ')}\nAvailable: ${gallery.styles.map((s) => s.id).join(', ')}`,
    );
  }
}

const payload = samplePayload();
const results = styles.map((style) => ({ style, ...renderStyle(style, payload) }));

if (asJson) {
  console.log(
    JSON.stringify(
      results.map(({ style, output, error }) => ({
        id: style.id,
        category: style.category,
        name: style.name,
        description: style.description,
        requiresNerdFont: style.requiresNerdFont,
        output: output ?? null,
        error: error ?? null,
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

let currentCategory = null;
for (const { style, output, error } of results) {
  if (style.category !== currentCategory) {
    currentCategory = style.category;
    const category = gallery.categories.find((cat) => cat.id === currentCategory);
    console.log(`\n${(category?.name ?? currentCategory).toUpperCase()}  ${category?.description ?? ''}`);
  }
  const note = style.requiresNerdFont ? '  (requires a Nerd Font)' : '';
  console.log(`\n  ${style.id}${note}`);
  if (error) {
    console.log(`    ! ${error}`);
  } else {
    for (const line of output.split('\n')) console.log(`    ${line}`);
  }
}
console.log('');
