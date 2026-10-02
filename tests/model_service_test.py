import importlib.util
import json
import os
import socket
import stat
import time
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

source = Path(__file__).with_name('model_service.py')
if not source.exists():
    source = Path(__file__).resolve().parents[1] / 'deploy/model_service.py'
spec = importlib.util.spec_from_file_location('copilot_model', source)
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)


class ModelServiceTests(unittest.TestCase):
    def test_service_bootstraps_private_socket_and_rejects_anonymous_calls(self):
        with tempfile.TemporaryDirectory() as root:
            process = subprocess.Popen([sys.executable, str(source)], env={**os.environ, 'COPILOT_MODEL_DIR': root},
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                path = Path(root) / 'model.sock'
                deadline = time.monotonic() + 4
                while not path.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue(path.exists(), 'service failed to initialize its socket')
                self.assertEqual(stat.S_IMODE((Path(root) / 'token').stat().st_mode), 0o600)
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(2); client.connect(str(path))
                    client.sendall(b'GET /status HTTP/1.0\r\n\r\n')
                    self.assertIn(b'401', client.recv(4096).split(b'\r\n')[0])
            finally:
                process.terminate(); process.communicate(timeout=5)

    def test_only_tool_free_pinned_model_payload_is_accepted(self):
        payload = {'model': 'gpt-5.6-sol', 'system_prompt': 'Return JSON', 'context': {}, 'output_schema': {}}
        self.assertTrue(service.validate(payload))
        self.assertFalse(service.validate({**payload, 'model': 'shared-gpt'}))
        self.assertFalse(service.validate({**payload, 'tools': ['shell']}))
        self.assertFalse(service.validate({**payload, 'context': 'bad'}))

    def test_error_categories_do_not_leak_provider_details(self):
        samples = [(service.AccountBusy('secret'), 'account_queue_timeout', 429),
                   (TimeoutError('secret'), 'model_timeout', 504),
                   (ConnectionError('secret'), 'model_connection_error', 502),
                   (ValueError('secret'), 'model_unavailable', 503)]
        for error, code, status in samples:
            self.assertEqual(service.error_result(error), {'error': code, 'status': status})
        for status, code in [(401, 'login_required'), (403, 'access_denied'), (429, 'rate_limited')]:
            error = RuntimeError('secret'); error.status_code = status
            self.assertEqual(service.error_result(error), {'error': code, 'status': status})
        wrapped = ConnectionError('private SDK detail')
        wrapped.__cause__ = service.AccountBusy('private lock path')
        self.assertEqual(service.error_result(wrapped), {'error': 'account_queue_timeout', 'status': 429})

    def test_hard_process_deadline_and_invalid_child_output(self):
        with patch.object(service.subprocess, 'run', side_effect=subprocess.TimeoutExpired('private-command', 225)) as run:
            self.assertEqual(service.invoke('complete', {}), {'error': 'model_timeout', 'status': 504})
            self.assertEqual(run.call_args.kwargs['timeout'], 225)
        with patch.object(service.subprocess, 'run', return_value=types.SimpleNamespace(stdout=b'not json')):
            self.assertEqual(service.invoke('complete', {})['error'], 'model_unavailable')
        with patch.object(service.subprocess, 'run', return_value=types.SimpleNamespace(stdout=b'[]')):
            self.assertEqual(service.invoke('complete', {})['error'], 'invalid_output')

    def test_shared_limits_extend_wait_without_replacing_locks(self):
        calls = []
        shared = types.SimpleNamespace(acquire=lambda root, timeout: calls.append((root, timeout)) or 'lease',
                                       remaining_seconds=lambda default: default, install=lambda: None)
        service.install_shared_limits(shared)
        self.assertEqual(shared.acquire('/unchanged-shared-directory'), 'lease')
        self.assertEqual(calls, [('/unchanged-shared-directory', 45)])
        self.assertEqual(shared.remaining_seconds(), 180)
        self.assertEqual(shared.remaining_seconds(10), 10)

    def test_actual_shared_two_slot_limit_is_preserved(self):
        try:
            from steward import shared_model as shared
        except ImportError:
            self.skipTest('native shared limiter verified in server image')
        original_acquire, original_remaining = shared.acquire, shared.remaining_seconds
        leases = []
        try:
            with patch.object(shared, 'install'), tempfile.TemporaryDirectory() as root:
                service.install_shared_limits(shared)
                leases.extend([shared.acquire(root), shared.acquire(root)])
                with self.assertRaises(service.AccountBusy):
                    shared.acquire(root, timeout=0.02)
                leases.pop().close()
                leases.append(shared.acquire(root, timeout=0.02))
        finally:
            for lease in leases: lease.close()
            shared.acquire, shared.remaining_seconds = original_acquire, original_remaining

    def test_native_request_uses_selected_account_and_long_deadline(self):
        from contextlib import contextmanager
        calls = {}
        @contextmanager
        def budget(seconds):
            calls['budget'] = seconds
            yield {'queue_ms': 1, 'model_ms': 2}
        shared = types.SimpleNamespace(request_budget=budget, remaining_seconds=lambda limit: limit)
        result = types.SimpleNamespace(model='gpt-5.6-sol', choices=[types.SimpleNamespace(message=types.SimpleNamespace(content='{"ok":true}', tool_calls=None))])
        class Client:
            def __init__(self): self.chat = types.SimpleNamespace(completions=self)
            def with_options(self, **kwargs): calls['options'] = kwargs; return self
            def create(self, **kwargs): calls['request'] = kwargs; return result
            def close(self): calls['closed'] = True
        modules = {
            'steward': types.SimpleNamespace(shared_model=shared),
            'hermes_cli.auth': types.SimpleNamespace(get_auth_status=lambda provider: {'logged_in': True}),
            'hermes_cli.runtime_provider': types.SimpleNamespace(resolve_runtime_provider=lambda **kwargs: calls.update(provider=kwargs)),
            'agent.auxiliary_client': types.SimpleNamespace(resolve_provider_client=lambda provider, model: (Client(), model)),
        }
        with patch.dict(sys.modules, modules), patch.object(service, 'install_shared_limits'):
            value = service.native_call({'model': 'gpt-5.6-sol', 'system_prompt': 'Return JSON', 'context': {}, 'output_schema': {}})
        self.assertEqual(value['content'], '{"ok":true}')
        self.assertEqual(calls['provider'], {'requested': 'openai-codex', 'target_model': 'gpt-5.6-sol'})
        self.assertEqual(calls['request']['timeout'], 180)
        self.assertEqual(calls['options'], {'max_retries': 0})
        self.assertEqual(calls['budget'], 210)
        self.assertNotIn('tools', calls['request'])
        self.assertTrue(calls['closed'])


if __name__ == '__main__':
    unittest.main()
