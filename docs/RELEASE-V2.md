# V2 release verification

## Implemented scope

P0: four-view responsive product, fixed coach, three modes, existing light/emerald direction.
P1: normalized session/card/evidence records; private self-host runtime, signed workspace sessions, optional Codex adapter, backup recipe. Actual server deployment and owner authorization are outstanding.
P2: browser voice input/playback, subtitles, speed and interruption; text fallback; per-turn save/retry/resume. Physical phone testing outstanding.
P3: distinct guided/free/simulation prompts, progressive coach help, context from weak vocabulary/errors/last focus.
P4: real error cards, active retrieval in four modes, spaced scheduling, exact source link to original dialogue.
P5: six evidence-gated stages and three tracks, target selection, course completion separate from ability, current/next-stage gaps.
P6: 36 scenes, 304 distinct combined vocabulary items, 144 patterns, old professional/meeting tools preserved, export/restore, regression checks and deployment packaging.

## Verified locally

- Production frontend/Worker build.
- Original 11 Worker checks: authentication/origin, encryption/user binding, persistence/concurrency, real provider request construction, exact quote filtering, malformed output and deployment files.
- 12 V2 checks: curriculum, per-session storage, database restart, grounded assessment, hinted/restored session exclusion, duplicate assessment, delayed cross-context advancement, review intervals, pagination, schema rejection, hashed passwords and signed-session tampering/expiry.
- Rendered DOM interaction test (JSDOM with controlled model): start → answer → coach help → reload/resume → debrief → save card → active recall → growth; no client runtime errors. This is not a physical browser or layout test.
- Private server integration: login, origin rejection, protected API, stripping forged platform identity headers, signed-cookie access and static app delivery.
- Real installed Codex 0.160.0: protocol schema inspected and initialize/account-read succeeded using a dedicated empty auth home. Result: not authenticated. Device authorization and inference have not been verified.

## Outstanding acceptance gates

1. Target server/domain and private deployment, followed by the owner's official device-code authorization and one real response.
2. Real model quality: a restaurant conversation, social chat and payments meeting, with contextual help and debrief.
3. Physical phone microphone permissions, speech speed/playback/interruptions, and at least ten minutes of conversation.
4. Rendered browser accessibility/layout QA (managed browser-control capability unavailable in this environment).
5. Off-server backup recovery on the chosen target server; browser import deliberately does not import trusted ability evidence.

Do not describe P0–P6 as fully accepted until these gates are completed. The deployable code and API-backed Site can be delivered before those environment-dependent gates, with this distinction visible.
