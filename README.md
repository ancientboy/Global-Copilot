# Global Copilot V2

A mobile-first English practice workspace for overseas life, social conversations and business. Four main views: Practice, Scenarios, Review and Growth. The earlier Meeting Prep, Quick English, professional library and learning history remain available under professional tools.

The existing strategy-server workbench uses the owner's **shared GPT account**, via the dedicated `MODEL_SERVICE` bridge and `gpt-5.6-sol`. It does not need an API key or another login. Use [the shared-account deployment profile](docs/STRATEGY-SHARED-ACCOUNT.md) for updates to `/english/`; it preserves the current login and learning data.

## Implemented

- Guided coaching, free conversation and in-character simulation; 5/15/30–45 minute intentions.
- 36 curated scenes, 288 scene vocabulary items, 144 sentence patterns; 304 distinct words including the existing professional library.
- Separate contextual coach help: misunderstanding, slower playback, keywords → sentence frame → full example, Chinese intent and natural phrasing.
- Browser speech recognition, editable transcript, speech synthesis, speed, pause/continue/stop, subtitles, and text fallback. No audio-based pronunciation score.
- Per-session cloud persistence after every submitted learner turn, before requesting the reply. Resume unfinished conversations after reload; retry a failed reply without duplicating the learner message.
- Grounded debrief: exact original, issue, minimal correction, natural/polished wording, practice reminder, next focus and review cards.
- Active listen/recognize/say/transfer review with 1/3/7/14/30-day scheduling. Saved items are not marked mastered automatically.
- Six ability stages with separate life/social/business tracks. Two independent contexts plus a delayed retest are required; hints and restored sessions do not create independent evidence. Course completion is shown separately.
- Adaptive request context from weak vocabulary, real errors, prior feedback and demonstrated level.
- User-isolated D1 records with optimistic concurrency, pagination, encrypted API credentials and private Site access.
- Export V2 and legacy data; import V2 sessions/cards without replacing existing IDs, merge saved expressions. Imported records cannot fabricate verified progress.
- Optional single-owner Node/SQLite server with private workspace login and Codex device-code authorization adapter, Docker recipe and backup instructions.

## Run and validate

`npm ci`

`npm run build`

`npm test`

`npm run dev` serves the frontend; real protected API routes require Sites or the private server. Vite alone does not supply fake learning data or fake AI. Deployment packaging remains `npm run build`, emitting `dist/client`, `dist/server/index.js` and migration metadata.

See [V2 plan](docs/V2-PLAN.md), [private-server deployment](docs/SELF-HOST.md) and [release verification](docs/RELEASE-V2.md).

## Important release boundaries

The Sites edition continues to use the user-configured OpenAI/DeepSeek API. Signing into the Site does not authorize model inference through a ChatGPT subscription. The existing strategy-server profile instead reuses its already-authorized dedicated GPT service. The optional standalone server has a separate device-code authorization flow; that flow is not required for the existing shared-account deployment.

Automated tests use controlled model responses, not paid live inference. A real Codex 0.160.0 process completed initialization/account-read in an isolated empty home; no user account was connected. Physical phone microphone/playback and sustained conversation still require device validation. The current environment does not provide the required managed browser-control skill, so no rendered browser/visual QA is claimed.

All previously deployed Drizzle migrations are preserved. New V2 migrations add normalized records and a unique owner/kind/id key without replacing the legacy learning document.
