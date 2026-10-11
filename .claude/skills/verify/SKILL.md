---
name: verify
description: Verify a status line change at its real surface — installed into a throwaway HOME and rendered by Claude Code itself in tmux.
---

# Verifying a style change

The surface is the `statusLine.command` Claude Code runs, rendered in its TUI.

## Setup (throwaway HOME, never the real one)

```bash
npm run build
H=$(mktemp -d -p /tmp/claude-0 home.XXXX)
HOME=$H node scripts/install-style.mjs <style-id>      # e.g. fancy/multiline
```

## Drive Claude Code

```bash
tmux -L verify new-session -d -s v -x 110 -y 30 "cd <repo-dir> && HOME=$H claude"
# first run: theme screen -> Enter, security notes -> Enter,
# trust prompt -> Down then Enter (the default is "No, exit")
tmux -L verify capture-pane -p -t v        # plain text
tmux -L verify capture-pane -p -e -t v     # keeps SGR and OSC 8 bytes
```

## Gotchas

- Claude Code re-runs the command on conversation events, not on every
  keystroke. A resize redraws once after launch, then stops refreshing. To try
  config variants without sending prompts, pipe the real captured input into the
  installed `active.mjs` directly.
- Fields Claude Code sends only in some contexts (`pr` needs `gh` signed in;
  `agent`, `vim`, `session_name`) can be injected by pointing
  `statusLine.command` at a small wrapper that merges extra JSON into stdin
  before running `active.mjs`.
- For truncation, use a working dir whose name contains CJK and emoji, and
  resize with `tmux -L verify resize-window -t v -x <cols>`.
- Merge conflicts: in a temp repo, set up two branches that both edit the same
  file and merge them, so `git status` shows `UU`.
- Clean up: `tmux -L verify kill-server`, then remove `$H` by its literal path.
