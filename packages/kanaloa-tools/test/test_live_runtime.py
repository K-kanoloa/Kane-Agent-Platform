"""Opt-in saved-provider acceptance; reuse the existing Runtime HTTP fixture."""
import os
import asyncio
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "apps" / "api" / "tests"))
from test_kanaloa_runtime_acceptance import (  # noqa: E402
    agent_messages, create_and_send, real_http_runtime, wait_terminal,
)

pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(os.getenv("KANALOA_LIVE_ACCEPTANCE") != "1", reason="requires saved Provider and built offline Kanaloa Tool image"),
]


async def test_real_kanaloa_ipython_and_nooa_same_native_session(tmp_path):
    async with real_http_runtime(tmp_path) as (_, client, adapter, frames):
        approvals = []
        cid, tid = await create_and_send(client,
            "Call the ipython tool exactly once with code 'kanaloa_value = 40; kanaloa_value + 2'. "
            "Wait for the actual result. If it is 42 reply IPYTHON_OK only. "
            "Do not use Shell or any other tool; report the real error if unavailable.")
        turn = await wait_terminal(client, tid, approvals)
        session = turn["native_session_ref"]
        assert turn["status"] == "finished"
        assert frames[-1]["native"] == "completed" and adapter.is_alive()
        messages = await agent_messages(client, cid)
        assert len(messages) == 1 and messages[0]["content"].strip() == "IPYTHON_OK"
        assert any(event["event_type"] == "tool_start" and event["payload"].get("tool") == "ipython" for event in turn["events"])
        assert approvals, "Approval must pass through the existing waiting_user path"
        print(f"ACCEPTANCE ipython session={session} turn={tid} finished one_message approval=true")

        response = await client.post(f"/api/v1/conversations/{cid}/messages", json={"content":
            "Use nooa_execute exactly once with strategy=codeact, python_state=reuse_session, "
            "output_contract=answer, goal='Use self.ipython to read kanaloa_value, add 2, "
            "and return an answer of 42 with a fact confirming persistent state.' "
            "If its validated answer is 42, reply NOOA_OK only. Never substitute Shell. "
            "Report the actual error if the tool fails."})
        assert response.status_code == 200 and response.json()["turn"]["turn_id"] == tid
        turn = await wait_terminal(client, tid, approvals)
        assert turn["native_session_ref"] == session and turn["status"] == "finished"
        assert frames[-1]["native"] == "completed" and adapter.is_alive()
        messages = await agent_messages(client, cid)
        assert len(messages) == 2 and messages[-1]["content"].strip() == "NOOA_OK"
        assert any(event["event_type"] == "tool_start" and event["payload"].get("tool") == "nooa_execute" for event in turn["events"])
        print(f"ACCEPTANCE nooa_codeact_ipython session={session} turn={tid} finished one_message_per_reply")


async def test_real_branch_and_parallel_turn_have_fresh_python_state(tmp_path):
    async with real_http_runtime(tmp_path) as (_, client, adapter, frames):
        approvals = []
        cid, main = await create_and_send(client,
            "Call ipython exactly once with code: import pathlib; kanaloa_private = 42; "
            "pathlib.Path('executions.txt').open('a').write('ONCE\\n'); kanaloa_private. "
            "After its actual result reply BASE_OK only. Do not use other tools.")
        original = await wait_terminal(client, main, approvals)
        assert original['status'] == 'finished'
        initial_messages = await agent_messages(client, cid)
        assert len(initial_messages) == 1 and initial_messages[0]['content'].strip() == 'BASE_OK'
        branch = await client.post(f'/api/v1/conversations/{cid}/branches', json={
            'message_id': initial_messages[0]['message_id'], 'name': 'Python isolation acceptance',
        })
        assert branch.status_code == 200
        branch_turn = branch.json()['initial_turn_id']
        parallel = await client.post(f'/api/v1/conversations/{cid}/turns', json={'title': 'Independent Python'})
        assert parallel.status_code == 200
        parallel_turn = parallel.json()['turn_id']

        async def check(tid):
            response = await client.post(f'/api/v1/conversations/{cid}/messages', json={
                'turn_id': tid, 'content': "Do not repeat previous tools or setup. Call ipython exactly once with code: "
                "'kanaloa_private' in globals(). If the actual value is False reply FRESH only; otherwise report SHARED. No other tools.",
            })
            assert response.status_code == 200 and response.json()['turn']['turn_id'] == tid
            turn = await wait_terminal(client, tid, approvals)
            assert turn['status'] == 'finished'
            return turn

        branched, independent = await asyncio.gather(check(branch_turn), check(parallel_turn))
        sessions = {original['native_session_ref'], branched['native_session_ref'], independent['native_session_ref']}
        assert len(sessions) == 3
        messages = await agent_messages(client, cid)
        assert len(messages) == 3 and all(message['content'].strip() == 'FRESH' for message in messages[1:])
        assert (tmp_path / 'executions.txt').read_text().splitlines() == ['ONCE']
        assert adapter.is_alive()
        print(f"ACCEPTANCE branch_parallel sessions={sorted(sessions)} turns={[main, branch_turn, parallel_turn]} status=finished isolated=true history_side_effect_replay=NO agent_messages=3")


async def test_real_tool_approval_reject_never_starts_execution(tmp_path):
    async with real_http_runtime(tmp_path) as (_, client, adapter, frames):
        cid, tid = await create_and_send(client,
            "Call ipython exactly once with code: from pathlib import Path; Path('must-not-exist.txt').write_text('DENIED'). "
            "If permission is rejected do not retry or use any other tools; reply DENIED only.")
        decisions = []
        async with asyncio.timeout(180):
            while True:
                turn = (await client.get(f'/api/v1/turns/{tid}')).json()
                for permission in turn['pending_permissions']:
                    assert turn['status'] == 'waiting_user'
                    result = await client.post(f"/api/v1/turns/{tid}/permissions/{permission['request_id']}/respond",
                                              json={'decision': 'reject-once'})
                    assert result.status_code == 200
                    decisions.append(permission['request_id'])
                if turn['status'] not in {'running', 'waiting_user'}:
                    break
                await asyncio.sleep(0.1)
        assert decisions and not (tmp_path / 'must-not-exist.txt').exists()
        assert turn['status'] == 'finished' and frames[-1]['native'] == 'completed'
        messages = await agent_messages(client, cid)
        assert len(messages) == 1 and messages[0]['content'].strip() == 'DENIED'
        print(f"ACCEPTANCE approval_reject session={turn['native_session_ref']} turn={tid} status=finished approval_count={len(decisions)} side_effect=NONE")


async def test_real_steer_changes_behavior_after_tool_boundary(tmp_path):
    async with real_http_runtime(tmp_path) as (_, client, adapter, frames):
        cid, tid = await create_and_send(client,
            "First call ipython with code: import pathlib, time; pathlib.Path('steer-started.txt').write_text('STARTED'); "
            "time.sleep(15); 'READY'. After that call finishes, in a SEPARATE ipython call write result-A.txt containing A. "
            "Do not combine the calls. No other tools. Follow any new user direction before that second call.")
        async with asyncio.timeout(150):
            while not (tmp_path / 'steer-started.txt').exists():
                turn = (await client.get(f'/api/v1/turns/{tid}')).json()
                assert turn['status'] in {'running', 'waiting_user'}
                for permission in turn['pending_permissions']:
                    result = await client.post(f"/api/v1/turns/{tid}/permissions/{permission['request_id']}/respond",
                                              json={'decision': 'allow-once'})
                    assert result.status_code == 200
                await asyncio.sleep(0.1)
        before = (await client.get(f'/api/v1/turns/{tid}')).json()
        assert before['status'] == 'running'
        response = await client.post(f'/api/v1/conversations/{cid}/messages', json={
            'turn_id': tid, 'content': "Change direction now: abandon A. Do NOT create result-A.txt. After the current cell returns, "
            "use ipython to write result-B.txt containing B instead. Then reply B_DONE only. No other tools.",
        })
        assert response.status_code == 200 and response.json()['turn']['turn_id'] == tid
        turn = await wait_terminal(client, tid, [])
        assert turn['status'] == 'finished' and turn['native_session_ref'] == before['native_session_ref']
        assert not (tmp_path / 'result-A.txt').exists()
        assert (tmp_path / 'result-B.txt').read_text() == 'B'
        messages = await agent_messages(client, cid)
        assert len(messages) == 1 and messages[0]['content'].strip() == 'B_DONE'
        assert any(frame['method'] == 'session/steer' for frame in frames)
        print(f"ACCEPTANCE steer session={turn['native_session_ref']} turn={tid} status=finished behavior=A_to_B native_session_count=1 agent_messages=1")
