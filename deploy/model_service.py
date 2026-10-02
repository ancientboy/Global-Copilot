"""Workbench-only, tool-free inference via the existing native ChatGPT login.

Uses the pinned strategy image's provider resolver and its SAME two shared
request locks. No strategy module, login file, or account setting is changed.
"""
import contextlib
import hmac
import json
import os
from pathlib import Path
import secrets
import socketserver
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler

MODEL = 'gpt-5.6-sol'
ROOT = Path(os.getenv('COPILOT_MODEL_DIR', '/run/copilot-model'))
MAX_BYTES = 131072
ACCOUNT_WAIT_SECONDS = 45
GENERATION_SECONDS = 180
TOTAL_SECONDS = 210
GATE = threading.BoundedSemaphore(1)


class AccountBusy(TimeoutError):
    pass


def validate(payload):
    required = {'model', 'system_prompt', 'context', 'output_schema'}
    return (isinstance(payload, dict) and set(payload) == required
            and payload['model'] == MODEL and isinstance(payload['system_prompt'], str)
            and bool(payload['system_prompt']) and isinstance(payload['context'], dict)
            and isinstance(payload['output_schema'], dict))


def error_result(error):
    status = getattr(error, 'status_code', None)
    cause, seen = error, set()
    while cause is not None and id(cause) not in seen and len(seen) < 8:
        if isinstance(cause, AccountBusy):
            return {'error': 'account_queue_timeout', 'status': 429}
        seen.add(id(cause))
        cause = cause.__cause__ or cause.__context__
    if status in (401, 403, 429):
        return {'error': {401: 'login_required', 403: 'access_denied', 429: 'rate_limited'}[status], 'status': status}
    if isinstance(error, TimeoutError) or 'Timeout' in type(error).__name__:
        return {'error': 'model_timeout', 'status': 504}
    if isinstance(error, ConnectionError) or 'Connection' in type(error).__name__:
        return {'error': 'model_connection_error', 'status': 502}
    return {'error': 'model_unavailable', 'status': 503}


def install_shared_limits(shared):
    # Only this disposable process waits longer; the original lock count and
    # files are unchanged, so other applications still share the same budget.
    original_acquire = shared.acquire
    original_remaining = shared.remaining_seconds

    def acquire(root, timeout=ACCOUNT_WAIT_SECONDS):
        try:
            return original_acquire(root, timeout=timeout)
        except TimeoutError as error:
            raise AccountBusy() from error

    def remaining(default=GENERATION_SECONDS):
        return original_remaining(default)

    shared.acquire = acquire
    shared.remaining_seconds = remaining
    shared.install()


def native_call(payload=None):
    from steward import shared_model
    install_shared_limits(shared_model)
    from hermes_cli.auth import get_auth_status
    if payload is None:
        return {'authenticated': bool(get_auth_status('openai-codex').get('logged_in')),
                'model': MODEL, 'models': [MODEL], 'channel': 'dedicated', 'execution_authority': 'none'}
    if not validate(payload):
        return {'error': 'invalid_request', 'status': 400}
    from hermes_cli.runtime_provider import resolve_runtime_provider
    from agent.auxiliary_client import resolve_provider_client
    with shared_model.request_budget(TOTAL_SECONDS) as budget:
        resolve_runtime_provider(requested='openai-codex', target_model=MODEL)
        client, actual = resolve_provider_client('openai-codex', model=MODEL)
        if client is None:
            return {'error': 'login_required', 'status': 401}
        try:
            if hasattr(client, 'with_options'):
                client = client.with_options(max_retries=0)
            result = client.chat.completions.create(
                model=actual, timeout=shared_model.remaining_seconds(GENERATION_SECONDS),
                messages=[
                    {'role': 'system', 'content': payload['system_prompt'] + '\nReturn only a JSON object. No tools are available.'},
                    {'role': 'user', 'content': json.dumps({'task_context': payload['context'], 'required_output_schema': payload['output_schema']}, ensure_ascii=False)},
                ],
                extra_body={'reasoning': {'effort': 'low'}},
            )
            message = result.choices[0].message
            if message.tool_calls or not isinstance(message.content, str) or len(message.content.encode()) > 65536:
                return {'error': 'invalid_output', 'status': 502}
            return {'content': message.content, 'model': result.model or actual,
                    'timing': {key: round(budget[key], 1) for key in ('queue_ms', 'model_ms')}}
        finally:
            client.close()


def child(mode):
    try:
        payload = json.load(sys.stdin) if mode == 'complete' else None
        # Never log prompts, model output, provider diagnostics or account data.
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            result = native_call(payload)
    except Exception as error:
        result = error_result(error)
    print(json.dumps(result))


def invoke(mode, payload=None):
    try:
        result = subprocess.run(
            [sys.executable, __file__, mode],
            input=json.dumps(payload).encode() if payload is not None else None,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=225 if mode == 'complete' else 8, check=True,
        )
        if len(result.stdout) > MAX_BYTES:
            return {'error': 'invalid_output', 'status': 502}
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            return {'error': 'invalid_output', 'status': 502}
        return value
    except subprocess.TimeoutExpired:
        return {'error': 'model_timeout', 'status': 504}
    except (OSError, ValueError, subprocess.SubprocessError):
        return {'error': 'model_unavailable', 'status': 503}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def reply(self, status, value):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def authorized(self):
        return hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + (ROOT / 'token').read_text().strip())

    def do_GET(self):
        if not self.authorized():
            return self.reply(401, {'error': 'unauthorized'})
        if self.path != '/status':
            return self.reply(404, {'error': 'not_found'})
        value = invoke('status')
        self.reply(value.pop('status', 200), value)

    def do_POST(self):
        if not self.authorized():
            return self.reply(401, {'error': 'unauthorized'})
        if self.path != '/complete':
            return self.reply(404, {'error': 'not_found'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BYTES:
                return self.reply(413, {'error': 'request_too_large'})
            payload = json.loads(self.rfile.read(length))
            if not validate(payload):
                raise ValueError()
        except (ValueError, OSError):
            return self.reply(400, {'error': 'invalid_request'})
        if not GATE.acquire(blocking=False):
            return self.reply(429, {'error': 'queue_full'})
        started = time.monotonic()
        try:
            value = invoke('complete', payload)
            status = value.pop('status', 200)
            print(json.dumps({'event': 'inference', 'id': str(uuid.uuid4()), 'status': status,
                              'code': value.get('error', 'ok'), 'elapsed_ms': round((time.monotonic() - started) * 1000),
                              'timing': value.get('timing')}), flush=True)
            self.reply(status, value)
        finally:
            GATE.release()


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    request_queue_size = 8


def serve():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    token = ROOT / 'token'
    if not token.exists():
        with open(token, 'x', opener=lambda path, flags: os.open(path, flags, 0o600)) as file:
            file.write(secrets.token_urlsafe(32))
    path = ROOT / 'model.sock'
    path.unlink(missing_ok=True)
    with Server(str(path), Handler) as server:
        path.chmod(0o600)
        print('Dedicated workbench model service ready', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    if len(sys.argv) > 1:
        child(sys.argv[1])
    else:
        serve()
