# Private server deployment

This is an optional single-owner runtime, separate from the current Sites publication. The implementation supports a private workspace password and a dedicated Codex App Server home. Do not reuse a trading server's existing Codex credentials or expose its home directory.

Requirements: Docker Compose, a TLS domain/reverse proxy, outbound access for Codex login/inference. Container port 3000 binds only to host loopback. Configure the reverse proxy to the exact APP_ORIGIN; preserve the browser Origin header. No current server or domain has been provided, so this deployment and real account inference are not verified.

1. Clone the repository and run `node server/setup.mjs` on the server. It writes a mode-0600 .env and refuses to overwrite an existing one. Retain the encryption key and session secret across deployments.
2. Run `docker compose up -d --build`. The image pins Node 24.19.0 and Codex 0.160.0. Data and the isolated authorization state persist in the copilot-data volume.
3. Open the HTTPS domain on your phone. Sign in with the workspace password. Open Settings, choose ChatGPT connection, follow the official device authorization URL and enter the code. Return and check authorization. Account support/limits must be validated with your actual account.
4. Run a restaurant dialogue, request a hint, resume after refresh, complete the debrief, add a review item, test it, and inspect the growth evidence. Repeat from another signed-in device. Also test denial of microphone permission and authorization expiry.

The browser never receives OAuth access/refresh tokens. The server offers fixed authorization and language-task endpoints, not a generic Codex RPC proxy. Inference threads use read-only sandboxing with network access disabled for tools, disable shell/browser/app/plugin tools and deny approval requests. The agent gets no application secrets in its environment. Model output is validated by the same worker handlers as the Sites/API edition.

API fallback: set MODEL_BACKEND=api and restart, then enter a provider key in app settings. Subscription authorization does not automatically provide a separate audio API; this release uses browser synthesis/recognition with text fallback.

## Backups and restore

Create a consistent backup within the private container volume:

`docker compose exec app node server/backup.mjs /data/learning-backup.sqlite`

Copy it to private off-server storage. Preserve .env and the Codex home securely if you want to retain authorization; OAuth credentials are sensitive and are not included in the browser export. For a database restore, stop the app, replace learning.sqlite from the backup and remove stale learning.sqlite-wal / learning.sqlite-shm while stopped, then restart. Keep the old database copy until verification. Restore checks must include counts, a saved dialogue, a review card and the account boundary.

Browser export/import covers V2 sessions and review cards; it also merges saved legacy expressions. Keep the full export as an archive for the remaining legacy profile, meeting and history data. Imported dialogue and evidence are not automatically treated as new verified ability; run a fresh independent challenge after restoration. An import skips existing IDs and does not overwrite concurrent data.

## Production validation still needed

- Actual device-code authorization and a real model response using the intended ChatGPT account.
- Real iOS/Android browser microphone, speech playback, interruption and a 10-minute practice session.
- HTTPS reverse proxy, restart recovery and off-server backup restore on the target server.
- Confirm the target machine permits Codex's restricted sandbox. Do not enable dangerous/full-access mode to bypass a sandbox incompatibility.

Official integration reference: https://learn.chatgpt.com/docs/app-server
