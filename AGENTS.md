# Rowboat monorepo

## Fork direction

This is Craig's personal fork for solo development and tinkering. The goal is an app that works on his machine by default, with cloud features optional. This is a direction for future changes, not a claim that every existing feature already works locally.

- Prioritize local use, minimal setup, and minimal reliance on external services.
- Ask before introducing required cloud services, accounts, or recurring costs.
- Prefer small, understandable changes that solve a current need. Add infrastructure or abstractions when a concrete use case requires them.
- Upstream compatibility is useful, but it is not mandatory when it conflicts with this fork's goals.
- Work autonomously on routine, reversible implementation choices within the requested scope.

## Project layout

Two applications, each its own pnpm workspace, plus product docs. Each area keeps its own guide; this file holds only what is true everywhere.

| Path | What | Guide |
|---|---|---|
| `apps/x/` | The Rowboat desktop app (Electron + React) and its packages, including the mobile app and the Spaces web app | none yet — read `apps/x/package.json` scripts and the package READMEs; the web app is [`apps/x/apps/renderer/WEB.md`](apps/x/apps/renderer/WEB.md) |
| `apps/harbor/` | Harbor, the Spaces server, and the spaces protocol package | [`apps/harbor/AGENTS.md`](apps/harbor/AGENTS.md) |
| `docs/` | Product docs that belong to no one app (the Spaces design language, notes) | — |

## How the two apps relate

`apps/x` consumes `@rowboat/spaces-protocol` and `@rowboat/harbor` from `apps/harbor` as **`link:` dependencies** — never `file:`, which pnpm copies at install time and which then goes stale during co-development. Build harbor before installing or testing x:

```sh
cd apps/harbor && pnpm install && pnpm -r build
cd ../x && pnpm install && npm test
```

**zod is pinned to one version (4.2.1) in both workspaces.** A mismatch breaks type identity across the link. CI (`.github/workflows/x-tests.yml`) builds harbor first in every job, including release builds.

## Rules that hold everywhere

- Comments explain **why** when the reason is not clear from the code. Dates and PR references are optional.
- Keep documentation proportional to the change. Update affected instructions or documented behavior alongside the code, and link to existing explanations rather than duplicating them. A PR or formal status document is not required for everyday local work.
- Run checks appropriate to the change, focusing on affected behavior and meaningful regressions.
- Preserve the technical constraints and architectural invariants in area-specific guides until an intentional implementation change replaces them. This fork's workflow preferences above supersede inherited requirements for dated comments, PR references, and PR-based documentation rituals, including those in area-specific guides.
