#!/usr/bin/env node
/**
 * Renders every style to an SVG under docs/previews/, for embedding in the README.
 *
 * Markdown cannot show ANSI colour, and a screenshot would be a heavy raster that
 * blurs when zoomed, carries no selectable text, and shows whichever font and
 * theme happened to be on the machine that took it. An SVG carries real text,
 * weighs a couple of kB, and pins the colours to the palette rather than to the
 * reader's terminal.
 *
 * Powerline separators are drawn as polygons rather than printed as U+E0B0, so
 * they render for everyone. Printing the glyph would show a filled triangle to
 * anyone with a Nerd Font and an empty box to everyone else, which would make
 * the style look like it works universally when it does not.
 *
 *   npm run svg
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseOutput } from './ansi.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'previews');
const localePreload = pathToFileURL(path.join(root, 'scripts', 'force-locale.mjs')).href;

// Layout constants. Backgrounds are drawn as rectangles on a character grid, so
// the text has to sit on that same grid: every run is given an explicit
// textLength, which pins it there whatever monospace font the reader has.
const FONT_SIZE = 14;
const CHAR_W = 8.4;
const LINE_H = 22;
const PAD_X = 14;
const PAD_Y = 12;
const RADIUS = 6;
const BG = '#16161e';

const SEP = String.fromCharCode(0xe0b0);
const THIN = String.fromCharCode(0xe0b1);

const FONT_STACK =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Splits a parsed line so powerline separators become their own drawable cells. */
function toCells(line) {
  const cells = [];
  for (const seg of line) {
    let buffer = '';
    // Spread the segment first: its own `text` field is the whole run, and would
    // overwrite the piece we just split out if it came last.
    const flush = () => {
      if (buffer) cells.push({ ...seg, kind: 'text', text: buffer });
      buffer = '';
    };
    for (const ch of seg.text) {
      if (ch === SEP || ch === THIN) {
        flush();
        cells.push({ ...seg, kind: ch === SEP ? 'sep' : 'thin', text: ch });
      } else {
        buffer += ch;
      }
    }
    flush();
  }
  return cells;
}

function renderSvg(lines) {
  const rows = lines.map(toCells);
  const widthChars = Math.max(...rows.map((r) => r.reduce((n, c) => n + c.text.length, 0)));
  const w = Math.ceil(widthChars * CHAR_W + PAD_X * 2);
  const h = rows.length * LINE_H + PAD_Y * 2;

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">`,
    `<rect width="${w}" height="${h}" rx="${RADIUS}" fill="${BG}"/>`,
    `<g font-family="${escapeXml(FONT_STACK)}" font-size="${FONT_SIZE}">`,
  ];

  rows.forEach((cells, rowIndex) => {
    const top = PAD_Y + rowIndex * LINE_H;
    const baseline = top + LINE_H * 0.7;
    let col = 0;

    for (const cell of cells) {
      const x = PAD_X + col * CHAR_W;
      const cw = cell.text.length * CHAR_W;

      if (cell.bg) {
        // Half a pixel of overlap: adjacent fills must not show a hairline seam.
        parts.push(`<rect x="${x - 0.5}" y="${top}" width="${cw + 1}" height="${LINE_H}" fill="${cell.bg}"/>`);
      }

      if (cell.kind === 'sep' || cell.kind === 'thin') {
        const fill = cell.fg ?? '#c0caf5';
        const x2 = x + cw;
        const mid = top + LINE_H / 2;
        if (cell.kind === 'sep') {
          parts.push(`<polygon points="${x},${top} ${x2},${mid} ${x},${top + LINE_H}" fill="${fill}"/>`);
        } else {
          parts.push(
            `<polyline points="${x + cw * 0.15},${top + LINE_H * 0.22} ${x2 - cw * 0.2},${mid} ${x + cw * 0.15},${top + LINE_H * 0.78}" ` +
              `fill="none" stroke="${fill}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>`,
          );
        }
      } else {
        const style = [
          `fill="${cell.fg ?? '#c0caf5'}"`,
          cell.bold ? 'font-weight="700"' : '',
          cell.dim ? 'opacity="0.65"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        parts.push(
          `<text x="${x}" y="${baseline}" ${style} textLength="${cw}" lengthAdjust="spacing" ` +
            `xml:space="preserve">${escapeXml(cell.text)}</text>`,
        );
      }

      col += cell.text.length;
    }
  });

  parts.push('</g></svg>');
  return parts.join('\n');
}

const gallery = JSON.parse(readFileSync(path.join(root, 'styles.json'), 'utf8'));
const sample = JSON.parse(readFileSync(path.join(root, 'examples', 'session.json'), 'utf8'));
delete sample.$comment;

// Resets have to be in the future or the countdowns and clocks render empty,
// which silently drops half of what these previews exist to show. Anchored to
// the current hour rather than the current second, so regenerating twice in a
// row produces identical files.
const hour = Math.floor(Date.now() / 3_600_000) * 3600;
sample.rate_limits.five_hour.resets_at = hour + 4 * 3600 + 11 * 60;
sample.rate_limits.seven_day.resets_at = hour + 2 * 86_400 + 5 * 3600;

// The real repository, so the git-aware styles have a branch to show. Their
// output therefore depends on the working tree at generation time.
sample.cwd = sample.workspace.current_dir = root;

// Render everything before touching docs/previews/: deleting the old files
// first would make them show up as uncommitted changes in the git-aware styles.
const rendered = gallery.styles.map((style) => ({
  style,
  output: execFileSync(process.execPath, ['--import', localePreload, path.join(root, style.file)], {
    input: JSON.stringify(sample),
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, COLUMNS: '200', FORCE_COLOR: '3', NO_COLOR: '' },
    windowsHide: true,
  }),
}));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const { style, output } of rendered) {
  const file = path.join(outDir, `${style.id.replace('/', '-')}.svg`);
  writeFileSync(file, `${renderSvg(parseOutput(output))}\n`);
  console.log(`  ${style.id.padEnd(18)} ${path.relative(root, file)}`);
}

console.log(`\n${gallery.styles.length} previews in docs/previews/`);
