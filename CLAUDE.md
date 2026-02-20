# wopr-plugin-videogen

`@wopr-network/wopr-plugin-videogen` — Video generation capability plugin for WOPR.

## Commands

```bash
npm run build     # tsc
npm run dev       # tsc --watch
npm run check     # biome check + tsc --noEmit (run before committing)
npm run lint:fix  # biome check --fix src/
npm run format    # biome format --write src/
npm test          # vitest run
```

**Linter/formatter is Biome.** Never add ESLint/Prettier config.

## Architecture

```
src/
  index.ts    # Plugin entry — exports WOPRPlugin default
  types.ts    # Re-exports from @wopr-network/plugin-types
```

This is a **capability plugin** (not a channel plugin). It registers `/video` commands on all channel providers and A2A tools for AI agents. Video generation requests are routed through the socket layer — this plugin contains ZERO billing or adapter logic.

## Plugin Contract

This plugin imports ONLY from `@wopr-network/plugin-types` — never from wopr core internals.

```typescript
import type { WOPRPlugin, WOPRPluginContext } from "@wopr-network/plugin-types";
```

## Key Conventions

- Node >= 20, ESM (`"type": "module"`)
- Biome for linting/formatting
- Conventional commits with issue key: `feat: add video generation (WOP-391)`
- `npm run check` must pass before every commit

## Issue Tracking

All issues in **Linear** (team: WOPR). No GitHub issues. Issue descriptions start with `**Repo:** wopr-network/wopr-plugin-videogen`.

## Session Memory

At the start of every WOPR session, **read `~/.wopr-memory.md` if it exists.** It contains recent session context: which repos were active, what branches are in flight, and how many uncommitted changes exist. Use it to orient quickly without re-investigating.

The `Stop` hook writes to this file automatically at session end. Only non-main branches are recorded — if everything is on `main`, nothing is written for that repo.