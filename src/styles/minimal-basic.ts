/**
 * minimal/basic — one line, the essentials: model, directory, context usage and
 * both rate-limit windows. Compact enough to stay out of the way.
 *
 *   ◆ Opus high · my-project · 38% ctx · 5h 23% · 7d 41%
 */
import { run } from '../lib/input.js';
import { loadConfig } from '../lib/config.js';
import { c, byThreshold } from '../lib/ansi.js';
import { basename, join, pct, printLines } from '../lib/format.js';
import { effortTag, sessionSegment } from '../lib/segments.js';

run((input) => {
  const cfg = loadConfig();
  const parts: Array<string | null> = [];

  if (cfg.showModel && input.model?.display_name) {
    parts.push(c.muted(`${cfg.icons.model} ${input.model.display_name}`) + effortTag(input));
  }

  // Agent and vim mode, only when present: a plain session pays nothing.
  parts.push(sessionSegment(input));

  parts.push(c.accent(basename(input.workspace?.current_dir ?? input.cwd)));

  const ctx = pct(input.context_window?.used_percentage);
  parts.push(byThreshold(ctx, `${Math.round(ctx)}%`) + c.muted(' ctx'));

  if (cfg.showLimits) {
    const fiveHour = input.rate_limits?.five_hour?.used_percentage;
    const sevenDay = input.rate_limits?.seven_day?.used_percentage;
    if (typeof fiveHour === 'number') {
      const p = pct(fiveHour);
      parts.push(c.muted('5h ') + byThreshold(p, `${Math.round(p)}%`));
    }
    if (typeof sevenDay === 'number') {
      const p = pct(sevenDay);
      parts.push(c.muted('7d ') + byThreshold(p, `${Math.round(p)}%`));
    }
  }

  printLines([join(parts)]);
});
