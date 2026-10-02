# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

User decision: use option 2 Meeting Prep two-column layout with option 1 warm-white/gray/deep-emerald palette. Default light mode. Preserve a global AI input. Production uses real provider APIs and user-isolated D1 cloud storage. Never substitute preset replies for AI or claim actual pronunciation scoring. API credentials are configured by the user in the private site.

V2 user decision (2026-10-02): implement P0–P6 continuously. Mobile-first life/social/business coach inspired by TalkMe interaction, not its branding. Four primary tabs; guided/free/simulation modes; layered help; real progress stages. Retain chosen light/emerald visual direction. V1 worker/build/tests may be extended to satisfy V2 while preserving compatibility. Never label mocked model tests as live validation.

Strategy-server decision (2026-10-02): reuse the owner's existing logged-in GPT account through the dedicated MODEL_SERVICE bridge and gpt-5.6-sol. Use deploy/compose.yml and server/strategy-index.mjs on that server, preserving /english/, gc_session, selfhost-owner, copilot.sqlite, and the existing encryption key. Managed mode must not ask for an API key or start a second account login. Retain the existing shared concurrency limiter and model container; do not change trading configuration or copy credentials into source control. Keep the Sites/API and separately authorized standalone Codex modes compatible.
