# Requiem-Warcraftlogs

A Wipefest-style analyzer for Requiem's (Tarren Mill EU) Warcraft Logs reports.
The site only accepts reports from the guild set in `src/config/guild.ts` (or the `GUILD_ID` environment variable).

- **Report view**: every boss pull, grouped by boss and difficulty, with progress bars
- **Pull view**: "what went wrong" insights, a death timeline with phases, the killing blow and last hits for each death, a per-player table (score, DPS, HPS, avoidable hits, interrupts), and damage taken by ability
- **Progression view**: all pulls on one boss: progress chart, what kills you, avoidable damage, and a per-player execution ranking
- **Home page**: the guild's current raid progression per boss and recent raid nights

## Setup

1. Create an API client at https://www.warcraftlogs.com/api/clients/ (any redirect URL works).
2. `cp .env.example .env.local` and fill in `WCL_CLIENT_ID` / `WCL_CLIENT_SECRET`.
3. `npm install && npm run dev`, then open http://localhost:3000

`/report/demo` shows generated sample data and works without keys.

## Teaching it your bosses

Edit `src/config/encounters.ts`. The encounter ID is shown on each boss page, and spell IDs (`#123456`) are shown in the
damage-taken table. Mark spells as `avoidable` (they count against players) or `ignore` (never flagged).
Without config, the app flags damage as *possibly avoidable* when only part of the raid takes it and some players take it more than once.

## Code map

- `src/lib/wcl.ts`: Warcraft Logs v2 GraphQL client (OAuth client credentials, caching, event pagination)
- `src/lib/analysis.ts`: all the insight, score, and progression logic (pure functions)
- `src/lib/demo.ts`: sample data
- `src/app/...`: pages

## Deploying to Cloudflare

The repo is set up for Cloudflare Workers through the OpenNext adapter (`wrangler.jsonc`, `open-next.config.ts`).

1. In Cloudflare, connect the GitHub repo. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
2. Under the Worker's **Settings → Variables and Secrets**, add `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` (as secrets).
3. If you rename the Worker, change `name` in `wrangler.jsonc` to match.

To test locally in the Workers runtime: put the keys in `.dev.vars` and run `npm run preview`.
