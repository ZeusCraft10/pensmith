# Pensmith for Claude Code

Pensmith helps you write an academic paper one section at a time: intake, research, an outline you approve, then plan, write and verify for each section, compile and export. Every citation is checked against live scholarly registries, and a section with a fabricated or mis-cited reference, or a quote that is not in its source, cannot be compiled or exported.

This plugin adds one skill (`/pensmith`), one session-start hook that only speaks up inside a paper workspace (a folder with `.paper/`), and the bundled `pensmith` command. It is an alpha.

## Install

In Claude Code:

```text
/plugin marketplace add ZeusCraft10/pensmith
/plugin install pensmith@pensmith
```

You need Node.js 22.12 or newer on your `PATH`, because the hook and the `pensmith` command run with `node`. Drafting currently calls the Anthropic API from the `pensmith` command, so set `ANTHROPIC_API_KEY` in the environment you start Claude Code from. Then run `/pensmith` in the folder you want the paper in.

## More

- Documentation and source: https://github.com/ZeusCraft10/pensmith
- Which hosts it contacts and what it stores: https://github.com/ZeusCraft10/pensmith/blob/main/PRIVACY.md

Releases publish this folder, built, on the repository's `release` branch, which is what the install above fetches. Change it on `main`, not on `release`.
