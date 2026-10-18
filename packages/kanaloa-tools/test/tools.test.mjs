import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, containerArguments } from '../index.mjs';
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot';

const root = fileURLToPath(new URL('../', import.meta.url));
const python = process.env.KANALOA_TEST_PYTHON ?? resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const hasPython = existsSync(python);
const containerTest = process.env.KANALOA_TEST_CONTAINER === '1';
const noPython = hasPython || containerTest ? false : 'Install the private Python 3.12 test environment or set KANALOA_TEST_CONTAINER=1; no fake NOOA substitute is used.';
const noNooa = noPython || (!containerTest && process.platform === 'win32' ? 'NOOA 0.0.10 imports Linux fcntl; run with KANALOA_TEST_CONTAINER=1 against the real offline image. No Windows shim is used.' : false);

function fixture(directory, config = {}) {
  const tools = new Map();
  const disposers = [];
  const listeners = new Map();
  const processes = [];
  const stats = { starts: 0, removals: 0, approvals: 0, models: [], decision: 'allowed-once' };
  let reply = () => ({ text: '{"answer":"PONG","facts":[]}' });
  const ctx = {
    tools: { register(definition) { tools.set(definition.name, definition); } },
    approval: { async request(request) { stats.approvals++; request.signal.throwIfAborted(); return stats.decision; } },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: directory }) },
    llm: { async *stream(options) {
      stats.models.push(options);
      const result = await reply(options, stats.models.length);
      if (result.block) yield { type: 'block-end', index: 0, block: result.block };
      else yield { type: 'text-delta', index: 0, text: result.text };
      yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 10 } };
      if (!result.noFinish) yield { type: 'finish', reason: { kind: result.block ? 'tool-calls' : 'stop' } };
    } },
    subprocess: { spawn(spec) {
      // Only this test fixture substitutes the container process. Real NOOA/IPython
      // still execute; OS containment has its own opt-in container acceptance test.
      if (spec.argv.includes('rm') && !containerTest) {
        stats.removals++;
        return { done: Promise.resolve({ exitCode: 0 }), collected: {} };
      }
      if (spec.argv.includes('run')) stats.starts++;
      else stats.removals++;
      const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
      env.IPYTHONDIR = directory;
      const child = containerTest ? spawn(spec.argv[0], spec.argv.slice(1), { cwd: directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
        : spawn(python, ['-I', resolve(root, 'worker.py')], { cwd: directory, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', data => { stderr = (stderr + data).slice(-2048); });
      const done = once(child, 'close').then(([exitCode, signal]) => ({ exitCode, signal }));
      const handle = { container: spec.argv[spec.argv.indexOf('--name') + 1], stdin: child.stdin, stdout: child.stdout, done, collected: { stderr: { readFrom: () => ({ text: stderr }) } }, terminate() { child.kill(); }, async waitForExit() { await done; return true; } };
      processes.push(handle);
      return handle;
    } },
    on(event, listener) { listeners.set(event, listener); },
    effect(callback) { disposers.push(callback()); },
  };
  apply(ctx, config);
  const agent = id => ({ id, session: { id, header: { cwd: directory } }, options: { provider: 'saved-provider', model: 'saved-model' } });
  let call = 0;
  return {
    tools, stats, agent, processes, ctx, directory,
    setReply(value) { reply = value; },
    execute(name, args, owner, signal = new AbortController().signal) {
      return tools.get(name).execute(args, { agent: owner, name, arguments: args, callId: `test-${++call}`, rootCallId: 'root', token: Symbol(), signal, deferContext() {} });
    },
    disposeAgent(owner) { return listeners.get('agent/disposed')?.({ agent: owner }); },
    async close() { for (const dispose of disposers.toReversed()) await dispose(); },
  };
}

async function withFixture(run, config) {
  const directory = await mkdtemp(resolve(tmpdir(), 'kanaloa-tools-'));
  const f = fixture(directory, config);
  try { await run(f); } finally { await f.close(); await rm(directory, { recursive: true, force: true }); }
}

test('disabled tool plugin registers nothing and starts no process', async () => {
  await withFixture(async f => { assert.equal(f.tools.size, 0); assert.equal(f.stats.starts, 0); }, { enabled: false });
});

test('the real Kanaloa overlay inserts the plugin instead of silently patching a missing row', () => {
  const overlay = loadOverlayPatches('test', resolve(root, '../../apps/api/app/adapters/kanaloa-persona.patch.yml'));
  const warnings = [];
  const entries = composeEntries([[{ insert: [{ id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' }] }], overlay], (...args) => warnings.push(args));
  assert.equal(warnings.length, 0);
  assert.equal(entries.find(entry => entry.id === 'kanaloa-tools')?.name, new URL('../index.mjs', import.meta.url).href);
});

test('tools register lazily and use one offline, resource-limited container per session', async () => {
  await withFixture(async f => { assert.deepEqual([...f.tools.keys()], ['ipython', 'nooa_execute']); assert.equal(f.stats.starts, 0); });
  const args = containerArguments('only-this-container', { workspaceRoot: root, mode: 'read-only' });
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=768m', '--pids-limit=64', '--pull=never']) assert.ok(args.includes(flag));
  assert.ok(args.some(arg => arg.endsWith('target=/workspace,readonly')));
  assert.ok(!args.some(arg => /API_KEY|TOKEN|USERPROFILE/u.test(arg)));
});

test('missing session, forged binding, denied approval and disabled NOOA never launch', async () => {
  await withFixture(async f => {
    const a = f.agent('a');
    await assert.rejects(f.execute('ipython', { code: '1', native_session_ref: 'b' }, a), { code: 'INVALID_TOOL_ARGS' });
    await assert.rejects(f.execute('ipython', { code: '1' }, null), { code: 'SESSION_BOUNDARY_VIOLATION' });
    await assert.rejects(f.execute('nooa_execute', { goal: 42 }, a), { code: 'INVALID_ARGS' });
    await assert.rejects(f.execute('nooa_execute', { goal: 'test', strategy: 'unknown' }, a), { code: 'INVALID_ARGS' });
    f.stats.decision = 'rejected';
    await assert.rejects(f.execute('ipython', { code: '1' }, a), { code: 'PERMISSION_DENIED' });
    assert.equal(f.stats.starts, 0);
  });
  await withFixture(async f => { assert.ok(!f.tools.has('nooa_execute')); }, { nooaEnabled: false });
});

test('real IPython persists per native session, isolates peers and never replays lost state', { skip: noPython, timeout: 30_000 }, async () => {
  await withFixture(async f => {
    const a = f.agent('a'); const b = f.agent('b');
    await f.execute('ipython', { code: 'shared_total = 40' }, a);
    assert.equal((await f.execute('ipython', { code: 'shared_total + 2' }, a)).value, '42');
    assert.equal((await f.execute('ipython', { code: "'shared_total' in globals()" }, b)).value, 'False');
    assert.equal(f.stats.starts, 2);
    await f.disposeAgent(a);
    assert.equal((await f.execute('ipython', { code: "'shared_total' in globals()" }, a)).value, 'False');
    assert.equal(f.stats.starts, 3);
  });
});

test('real NOOA Predict validates typed output and uses the original DSH provider/model', { skip: noNooa, timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('native-a');
    const result = await f.execute('nooa_execute', { goal: 'Return PONG', strategy: 'predict' }, owner);
    assert.deepEqual(result.result, { answer: 'PONG', facts: [] });
    assert.equal(result.model_calls, 1);
    assert.equal(f.stats.models[0].provider, 'saved-provider');
    assert.equal(f.stats.models[0].model, 'saved-model');
    assert.equal(f.stats.models[0].sessionId, 'native-a');
    assert.ok(f.stats.models[0].messages.some(message => message.content.some(block => block.text?.includes('JSON'))));
  });
});

test('real NOOA CodeAct uses a separate ephemeral worker and the same persistent IPython', { skip: noNooa, timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('native-a');
    await f.execute('ipython', { code: 'shared_total = 40' }, owner);
    f.setReply((_options, count) => count === 1 ? { block: {
      type: 'tool-call', id: 'execute-1', name: 'execute_python',
      arguments: JSON.stringify({ code: 'r = await self.ipython("shared_total += 2\\nshared_total")\ntyped = await self.predict("Return the typed answer " + r["value"])\nreturn_result(typed)' }),
    } } : { text: '{"answer":"42","facts":["shared IPython"]}' });
    const result = await f.execute('nooa_execute', { goal: 'Add two using self.ipython and return its value.', strategy: 'codeact', python_state: 'reuse_session' }, owner);
    assert.equal(result.result.answer, '42');
    assert.equal(result.ipython_calls, 1);
    assert.equal(result.model_calls, 2);
    assert.equal(f.stats.starts, 2);
    assert.equal((await f.execute('ipython', { code: 'shared_total' }, owner)).value, '42');
  });
});

test('invalid NOOA output and missing explicit model finish cannot silently succeed', { skip: noNooa, timeout: 60_000 }, async () => {
  await withFixture(async f => {
    f.setReply(() => ({ text: '{"answer":17,"facts":[]}' }));
    await assert.rejects(f.execute('nooa_execute', { goal: 'Return a typed answer' }, f.agent('bad')), { code: 'OUTPUT_VALIDATION_FAILED' });
    assert.ok(f.stats.models.length > 0);
    f.setReply(() => ({ text: '{"answer":"PONG","facts":[]}', noFinish: true }));
    await assert.rejects(f.execute('nooa_execute', { goal: 'Return PONG' }, f.agent('unfinished')));
    assert.ok(f.stats.removals >= 2);
  });
});

test('real busy IPython cancellation destroys the process and does not restore variables', { skip: noPython, timeout: 30_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('cancel');
    await f.execute('ipython', { code: 'before_cancel = 10' }, owner);
    const controller = new AbortController();
    const work = f.execute('ipython', { code: 'while True: pass' }, owner, controller.signal);
    setTimeout(() => controller.abort(), 150).unref();
    await assert.rejects(work, { code: 'SUBTASK_CANCELLED' });
    assert.equal((await f.execute('ipython', { code: "'before_cancel' in globals()" }, owner)).value, 'False');
  });
});

test('timeout and process crash are explicit; neither retries an unfinished cell', { skip: noPython, timeout: 30_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('crash');
    await f.execute('ipython', { code: 'before_crash = 10' }, owner);
    await assert.rejects(f.execute('ipython', { code: 'import os, subprocess; subprocess.Popen(["python", "-c", "import time; time.sleep(60)"]); os._exit(7)' }, owner), { code: 'PYTHON_SESSION_LOST' });
    assert.equal(f.stats.starts, 1);
    assert.equal((await f.execute('ipython', { code: "'before_crash' in globals()" }, owner)).value, 'False');
  });
  await withFixture(async f => {
    await assert.rejects(f.execute('ipython', { code: 'while True: pass' }, f.agent('timeout')), { code: 'SUBTASK_TIMEOUT' });
    assert.equal(f.stats.starts, 1);
  }, { timeoutMs: 1000 });
});

test('native branch sessions, parallel sessions and separate Kanaloa instances cannot share Python variables', { skip: noPython, timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const main = f.agent('native-main');
    await f.execute('ipython', { code: 'private_value = 42' }, main);
    await Promise.all(['native-parallel', 'native-branch'].map(async id => {
      assert.equal((await f.execute('ipython', { code: "'private_value' in globals()" }, f.agent(id))).value, 'False');
    }));
    await withFixture(async other => {
      assert.equal((await other.execute('ipython', { code: "'private_value' in globals()" }, other.agent('native-main'))).value, 'False');
    });
    await assert.rejects(f.execute('ipython', { code: 'private_value' }, f.agent('native-main')), { code: 'SESSION_BOUNDARY_VIOLATION' });
    assert.equal((await f.execute('ipython', { code: "'private_value' in globals()" }, main)).value, 'False');
  });
});

test('NOOA CodeAct cannot use the persistent bridge in ephemeral mode', { skip: noNooa, timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const code = [
      'denied = False',
      'try:',
      '    await self.ipython("unapproved_value = 42")',
      'except Exception:',
      '    denied = True',
      'assert denied',
      'return_result(answer="ISOLATED", facts=[])',
    ].join('\n');
    f.setReply(() => ({ block: { type: 'tool-call', id: 'containment', name: 'execute_python', arguments: JSON.stringify({ code }) } }));
    const owner = f.agent('nooa-offline');
    const result = await f.execute('nooa_execute', { goal: 'Run the isolation check', strategy: 'codeact', python_state: 'ephemeral' }, owner);
    assert.equal(result.result.answer, 'ISOLATED');
    assert.equal(result.ipython_calls, 0);
    assert.equal(f.stats.starts, 1);
  });
});

test('NOOA cancellation and worker crash discard unfinished code without replay', { skip: containerTest ? false : 'Requires the real Linux image to kill only the owned NOOA container.', timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('nooa-crash');
    f.setReply(() => ({ block: { type: 'tool-call', id: 'busy', name: 'execute_python', arguments: JSON.stringify({ code: 'await asyncio.sleep(60)' }) } }));
    const crash = f.execute('nooa_execute', { goal: 'Run until the test stops this container', strategy: 'codeact' }, owner);
    const crashed = assert.rejects(crash, { code: 'PYTHON_SESSION_LOST' });
    while (f.stats.models.length < 1) await new Promise(resolve => setTimeout(resolve, 10));
    const killer = spawn('docker', ['kill', '--signal=KILL', f.processes[0].container], { windowsHide: true, stdio: 'ignore' });
    assert.equal((await once(killer, 'close'))[0], 0);
    await crashed;
    assert.equal(f.stats.starts, 1);
    const controller = new AbortController();
    const work = f.execute('nooa_execute', { goal: 'Run until explicitly cancelled', strategy: 'codeact' }, owner, controller.signal);
    while (f.stats.models.length < 2) await new Promise(resolve => setTimeout(resolve, 10));
    setTimeout(() => controller.abort(), 200).unref();
    await assert.rejects(work, { code: 'SUBTASK_CANCELLED' });
    assert.equal(f.stats.starts, 2);
  });
});

test('parent EOF during a busy cell removes the worker and its child processes', { skip: containerTest ? false : 'Requires real container PID-namespace cleanup.', timeout: 30_000 }, async () => {
  await withFixture(async f => {
    const work = f.execute('ipython', { code: 'import pathlib, subprocess, time\nsubprocess.Popen(["python", "-c", "import time; time.sleep(60)"])\npathlib.Path("started").write_text("once")\ntime.sleep(60)' }, f.agent('parent-eof'));
    const rejected = assert.rejects(work, { code: 'PYTHON_SESSION_LOST' });
    const limit = Date.now() + 15_000;
    while (!existsSync(resolve(f.directory, 'started'))) {
      assert.ok(Date.now() < limit, 'The real cell must start before EOF injection');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    f.processes[0].stdin.end();
    await rejected;
    assert.equal(f.stats.starts, 1);
  });
});

test('NOOA model budget is enforced without starting an extra model request', { skip: noNooa, timeout: 30_000 }, async () => {
  await withFixture(async f => {
    f.setReply(() => ({ block: { type: 'tool-call', id: 'not-final', name: 'execute_python', arguments: JSON.stringify({ code: 'intermediate = 42' }) } }));
    await assert.rejects(f.execute('nooa_execute', { goal: 'A bounded CodeAct subtask', strategy: 'codeact' }, f.agent('limited')));
    assert.equal(f.stats.models.length, 1);
    assert.equal(f.stats.starts, 1);
  }, { maxModelCalls: 1 });
});

test('uncertain CLI exit never skips exact container cleanup', { skip: noPython, timeout: 30_000 }, async () => {
  await withFixture(async f => {
    const owner = f.agent('uncertain-cli');
    await f.execute('ipython', { code: '42' }, owner);
    const handle = f.processes[0];
    const wait = handle.waitForExit.bind(handle);
    let calls = 0;
    handle.waitForExit = signal => ++calls === 1 ? Promise.resolve(false) : wait(signal);
    await f.disposeAgent(owner);
    assert.equal(calls, 2);
    assert.ok(f.stats.removals > 0);
  });
});

test('observe real worker memory and cold/warm latency separately from Provider time', { skip: containerTest ? false : 'Resource observation requires real containers.', timeout: 60_000 }, async () => {
  await withFixture(async f => {
    const stats = async container => JSON.parse((await promisify(execFile)('docker', [
      'stats', '--no-stream', '--format', '{{json .}}', container,
    ], { timeout: 15_000, windowsHide: true })).stdout);
    const owner = f.agent('worker-resources');
    let started = performance.now();
    await f.execute('ipython', { code: '42' }, owner);
    const cold = Math.round(performance.now() - started);
    const kernel = await stats(f.processes[0].container);
    const warm = [];
    for (let i = 0; i < 5; i++) {
      started = performance.now();
      await f.execute('ipython', { code: '40 + 2' }, owner);
      warm.push(Math.round(performance.now() - started));
    }
    let nooa;
    f.setReply(async () => {
      nooa = await stats(f.processes.at(-1).container);
      return { text: '{"answer":"PONG","facts":[]}' };
    });
    started = performance.now();
    await f.execute('nooa_execute', { goal: 'Return PONG' }, owner);
    console.log('WORKER_PERFORMANCE ' + JSON.stringify({ ipython_cold_ms: cold, ipython_warm_ms: warm,
      ipython_memory: kernel.MemUsage, nooa_memory: nooa.MemUsage, nooa_total_ms: Math.round(performance.now() - started),
      model: 'deterministic fixture; real NOOA/container, not Provider latency' }));
  });
});
