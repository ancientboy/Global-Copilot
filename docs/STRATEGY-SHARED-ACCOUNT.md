# Existing strategy-server GPT account

This is the deployment profile for the existing `/english/` workbench. It reuses the owner's current authenticated GPT account through the already-running dedicated model service. It does not require an API key or a second device-code login.

## Runtime and data continuity

- `server/strategy-index.mjs` keeps the existing workspace login, `gc_session` cookie, `selfhost-owner` identity, `copilot.sqlite`, and encryption key.
- `server/strategy-model.mjs` calls the private workbench model socket. The web container mounts only that bridge; it does not receive the account login store.
- The existing dedicated model container resolves `gpt-5.6-sol` using its native authenticated provider and shares the existing account concurrency limit. Workbench requests are queued one at a time. The service exposes only status and text completion, with no tool execution.
- The Worker uses `MODEL_SERVICE` ahead of standalone Codex or API providers. An unavailable shared account returns an error instead of silently switching providers.
- Settings show **共用 GPT 账号**, the configured model, and a connection test. Both V2 and professional tools omit API-key and new-account login forms in this mode.

`compose.yaml` and `server/index.mjs` are a separate, standalone deployment. Do not run their account setup flow over this existing installation.

## Deploy an update

Keep the current model container, login, and data directories in place. Preserve a consistent SQLite backup and the previous web image before upgrading.

1. Check out the desired revision in a new release directory.
2. Use `deploy/strategy.env.example` as the deployment metadata template, retaining the existing native image and shared-directory settings. Set `COPILOT_MODEL_IMAGE` to the image of the current dedicated workbench model container. These are image names and paths, not credentials.
3. Run:

```sh
docker compose --env-file /path/to/deployment-metadata.env -f deploy/compose.yml build web
docker compose --env-file /path/to/deployment-metadata.env -f deploy/compose.yml up -d --no-deps --no-build --wait web
```

The dedicated Dockerfile installs dependencies, builds with `/english/`, and runs the Node tests. No prebuilt `dist` directory or host Node installation is needed. Only the web service is updated by these commands. The `model` service definition is retained for reproducibility; do not rebuild or recreate the running model as part of an ordinary web update.

After health checks pass, point `/opt/global-copilot/current` at the new release. Verify `/english/healthz`, the login page, denied anonymous API access, and a signed-in model request. If needed, redeploy the previous web image and restore the previous release pointer. The V2 migrations are additive; avoid replacing the database after users have written new records.

## Development checks

```sh
npm ci
npm run build
npm test
VITE_BASE_PATH=/english/ npm run build
npm test
python3 tests/model_service_test.py
```

The model-service tests use fixtures; the native limiter check requires the existing native provider image and skips when that package is unavailable. An actual account call is a separate deployment check. Keep all login files, bridge tokens, passwords, and learning databases out of Git.
