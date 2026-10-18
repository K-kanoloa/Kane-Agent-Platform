"""Opt-in observational comparison using the saved Provider, never a synthetic model."""
import asyncio
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
from time import perf_counter

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'apps' / 'api'))
sys.path.insert(0, str(ROOT / 'apps' / 'api' / 'tests'))
from test_kanaloa_runtime_acceptance import (  # noqa: E402
    agent_messages, create_and_send, real_http_runtime, wait_terminal,
)

pytestmark = [pytest.mark.asyncio, pytest.mark.skipif(
    os.getenv('KANALOA_PERFORMANCE') != '1' or os.name != 'nt',
    reason='opt-in Windows saved-provider timing/RSS observation; not a cross-platform benchmark',
)]


async def test_normal_path_cost_with_and_without_optional_tools(tmp_path, monkeypatch):
    records = []
    for sample in range(3):
        for mode in ('disabled', 'ipython_only', 'enabled'):
            monkeypatch.setenv('KANALOA_TOOLS_ENABLED', '0' if mode == 'disabled' else '1')
            monkeypatch.setenv('KANALOA_NOOA_ENABLED', '0' if mode == 'ipython_only' else '1')
            workspace = tmp_path / f'{sample}-{mode}'
            workspace.mkdir()
            async with real_http_runtime(workspace) as (_, client, adapter, frames):
                start = perf_counter()
                await adapter.activate()
                startup = (perf_counter() - start) * 1000
                rss = int(subprocess.check_output([
                    'powershell', '-NoProfile', '-Command',
                    f'(Get-Process -Id {adapter._process.pid}).WorkingSet64',
                ], text=True, timeout=10).strip())
                start = perf_counter()
                cid, tid = await create_and_send(client, 'Reply with PONG only. Do not use tools.')
                turn = await wait_terminal(client, tid, [])
                latency = (perf_counter() - start) * 1000
                assert turn['status'] == 'finished'
                assert frames[-1]['native'] == 'completed'
                messages = await agent_messages(client, cid)
                assert len(messages) == 1 and messages[0]['content'].strip() == 'PONG'
                assert not any(event['event_type'] == 'tool_start' for event in turn['events'])
                assert sum(frame['method'] == 'session/prompt' for frame in frames) == 1
                record = dict(sample=sample, mode=mode, startup_ms=round(startup),
                              rss_mib=round(rss / 1048576, 1), latency_ms=round(latency),
                              session=turn['native_session_ref'], turn=tid, tools_called=0)
                records.append(record)
                print('PERFORMANCE ' + json.dumps(record))
    for mode in ('disabled', 'ipython_only', 'enabled'):
        samples = [record for record in records if record['mode'] == mode]
        print('PERFORMANCE_MEDIAN ' + json.dumps(dict(mode=mode, **{
            key: statistics.median(record[key] for record in samples)
            for key in ('startup_ms', 'rss_mib', 'latency_ms')
        })))
    # No optional worker may be created by the no-tool requests above.
    owned = await asyncio.create_subprocess_exec(
        'docker', 'ps', '-a', '--filter', 'name=kane-kanaloa-', '--format', '{{.Names}}',
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    output, _ = await asyncio.wait_for(owned.communicate(), 15)
    assert owned.returncode == 0 and not output.strip()
