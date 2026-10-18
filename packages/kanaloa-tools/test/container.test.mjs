import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { containerArguments } from '../index.mjs';

const enabled = process.env.KANALOA_TEST_CONTAINER === '1';

async function docker(args) {
  const child = spawn('docker', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  child.stdout.on('data', data => output.push(data));
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 15_000);
  const [code] = await once(child, 'close');
  clearTimeout(timer);
  assert.equal(code, 0, 'Docker command must succeed against the existing Linux engine');
  return Buffer.concat(output).toString();
}

test('real offline container denies network/host reads/root writes and enforces declared resources', {
  skip: enabled ? false : 'Set KANALOA_TEST_CONTAINER=1 after building the optional image; this OS-isolation check is not replaced by a subprocess fixture.',
  timeout: 60_000,
}, async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'kanaloa-containment-'));
  const name = `kane-kanaloa-${randomUUID()}`;
  let child;
  try {
    child = spawn('docker', containerArguments(name, { workspaceRoot: directory, mode: 'read-only' }).slice(1), {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, KANALOA_HOST_SECRET_SENTINEL: 'must-not-enter-container' },
    });
    child.stderr.resume();
    let output = '';
    let resolveFrame;
    const frames = [];
    child.stdout.on('data', data => {
      output += data.toString();
      let index;
      while ((index = output.indexOf('\n')) !== -1) {
        const frame = JSON.parse(output.slice(0, index)); output = output.slice(index + 1);
        if (resolveFrame) { const done = resolveFrame; resolveFrame = null; done(frame); }
        else frames.push(frame);
      }
    });
    const read = () => frames.length ? Promise.resolve(frames.shift()) : new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('Container frame deadline')), 15_000);
      resolveFrame = frame => { clearTimeout(timer); done(frame); };
    });
    assert.equal((await read()).type, 'ready');
    const inspect = JSON.parse(await docker(['inspect', name]))[0];
    assert.equal(inspect.HostConfig.NetworkMode, 'none');
    assert.equal(inspect.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspect.HostConfig.Memory, 768 * 1024 * 1024);
    assert.equal(inspect.Config.User, '1000:1000');
    assert.equal(inspect.Mounts.filter(mount => mount.Type === 'bind').length, 1);
    assert.equal(inspect.Mounts.find(mount => mount.Destination === '/workspace').RW, false);
    const code = [
      'import os, socket',
      "assert 'KANALOA_HOST_SECRET_SENTINEL' not in os.environ",
      "assert not os.path.exists('/var/run/docker.sock')",
      'network_blocked = False',
      'try:',
      '    socket.create_connection(("1.1.1.1", 443), timeout=1)',
      'except OSError:',
      '    network_blocked = True',
      'assert network_blocked',
      'for path in ["/blocked-write", "/workspace/blocked-write"]:',
      '    try:',
      '        open(path, "w").close()',
      '    except OSError:',
      '        pass',
      '    else:',
      '        raise AssertionError("write escaped boundary")',
      '"CONTAINMENT_OK"',
    ].join('\n');
    child.stdin.write(JSON.stringify({ type: 'ipython', payload: { code } }) + '\n');
    const result = await read();
    assert.equal(result.type, 'result');
    assert.equal(result.payload.value, "'CONTAINMENT_OK'");
  } finally {
    child?.stdin.end();
    child?.kill();
    await docker(['container', 'rm', '--force', name]).catch(() => {});
    let remaining;
    for (let attempt = 0; attempt < 40; attempt++) {
      remaining = (await docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])).trim();
      if (!remaining) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(remaining, '', 'Cleanup must confirm the exact test container is absent');
    await rm(directory, { recursive: true, force: true });
  }
});
