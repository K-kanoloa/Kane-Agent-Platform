# Kanaloa Structured Python Tools

Private tools for the built-in Kanaloa Agent. They add persistent Python state
and bounded structured execution without changing Kane Core, its public Adapter
contract, external Connectors, HTTP or UI. The existing Kanaloa Runtime remains
the parent Agent loop. These tools do not create Kane Turns or Messages.

## Capabilities

- `ipython` executes Python in a session-owned kernel and keeps variables alive
  across calls in the same native session.
- `nooa_execute` runs one bounded structured subtask with typed output validation
  and optional access to that same persistent Python state.
- Parallel Turns, Branches and separate Kanaloa instances receive separate
  kernels and workers.
- Existing Runtime approval, cancellation, model routing and session ownership
  remain authoritative.
- Workers start only on demand and run without network access in constrained
  Linux containers.

## Install

Use the repository's normal `npm ci`, then, with an existing Docker Linux engine:

```powershell
npm run setup:kanaloa-tools
```

This builds `kane-kanaloa-tools:0.1.0` from Python 3.12.15 and the versions pinned
in `requirements.lock`, including IPython 9.6.0 and the structured-execution
engine used by `nooa_execute`. The latter imports POSIX `fcntl`, so the image is
Linux even on a Windows host.
No upstream source modifications or Windows import shims are used.
No Python installation on the host is needed for production use.
Node.js 24 is the tested host runtime. On Windows, use Docker Desktop with
WSL2/Linux containers; on Linux, use a Linux Docker engine accessible to the
launching user. The container runs as UID/GID 1000:1000, so an approved writable
workspace must already permit that user to write. No permission-widening fallback
is performed. Never expose the Docker daemon or its socket to generated code.

The existing Kanaloa persona patch loads `@kane/kanaloa-tools`. Restart an
existing Kanaloa Runtime after installing the plugin. Merely starting Kane or
Kanaloa does not start a Tool container or import NOOA/IPython. Missing Docker
or a missing image causes a structured Tool error, never host-Python fallback
or an automatic image download. Normal model requests still work.

## Tool Contracts

`ipython({code})` runs a Python cell in the current native session. Successful
calls retain variables. Separate native sessions, parallel Turns and Branches
have different containers. Code, stdout and result representations are bounded.
Errors return an exception type, without a source traceback.

`nooa_execute({goal, strategy?, output_contract?, python_state?})` runs one bounded
subtask. `auto` and `predict` select typed prediction; `codeact` selects the
controlled Python-assisted strategy.
The registered `answer` output contract is `{answer: string, facts: string[]}`,
validated with Pydantic. Arbitrary model-supplied classes/schemas are not executed.
CodeAct can call the explicitly defined `self.ipython(code)` proxy. The proxy
is our integration API, not an upstream NOOA feature.

The structured subtask has its own ephemeral container. Its temporary Python
REPL cannot directly access the persistent IPython interpreter. `self.ipython`
crosses the private
stdio bridge to the current session's separate IPython container; it never
accepts a session or Kernel ID from model arguments. `python_state=ephemeral`
disables this bridge. NOOA containers are removed after each subtask; IPython
containers remain until session disposal or idle expiry.

## Model And Execution Boundaries

Structured subtask model requests are forwarded to the parent Kanaloa Runtime
using the invoking Agent's existing provider and model. The worker
receives no API Key, credentials file or Provider environment. OpenAI-compatible,
Responses and Anthropic routing stays with the installed Runtime adapters. These
auxiliary requests cost tokens; they are not additional Kanaloa Loop iterations.

Each Tool invocation asks the existing Kanaloa approval service. A rejection,
cancellation or missing answerer denies execution. That approval authorizes
the bounded subtask and its workspace access; it is not a review of each
generated cell. Never approve a workspace containing secrets the task must
not read: the approved workspace is deliberately accessible to Python.

Containers have no network, no host environment/credentials/home mounts, a
read-only root filesystem, dropped capabilities, non-root UID, no privilege
escalation, one CPU, 768 MiB memory, 64 PIDs and a bounded temporary filesystem.
Only the trusted session workspace is mounted; its existing read-only policy
is respected. Even a `danger-full-access` DSH session gets only that workspace
inside the container, not full host access. There is no Docker socket mount.

Private Runtime plugin configuration (`config`, not model arguments):

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | true | Register both tools; false registers neither |
| `nooaEnabled` | true | Register NOOA in addition to IPython |
| `maxSessions` | 8 | Maximum simultaneously retained native session slots |
| `timeoutMs` | 120000 | Deadline per Tool invocation, including startup |
| `idleMs` | 1800000 | Recycle inactive IPython state; active work is excluded |
| `maxModelCalls` | 8 | Maximum model calls/CodeAct iterations per subtask |

`KANALOA_TOOLS_ENABLED=0` disables the plugin; `KANALOA_NOOA_ENABLED=0` disables
only NOOA. The controls are private Runtime deployment settings, not a new UI mode.
Additional bounds: 2048 output tokens per model request, 32000 tokens per
subtask (conservative input-byte bounds before requesting, usage when available),
1 MiB serialized wire frames, 65536-character cell input/output and
32768-character goals (host string checks count UTF-16 code units).

## Cancel And Recovery

DSH's existing Tool `AbortSignal` cancels work and kills/removes the exact owned
containers. Completion waits for removal; cleanup failures remain explicit.
The input reader also exits on parent EOF while a cell is busy. Containers
are not rediscovered or reattached after a parent crash. A new native session
always starts empty. No pickle checkpoint, implicit code replay or unknown
side-effect retry is implemented. Already completed file writes are not rolled
back by cancel. Save needed results to the approved workspace explicitly.

Only sanitized lifecycle facts are written to ACP stderr: native session ref,
Tool name, normalized outcome, duration and model-call/token counts. Source code,
model prompts, tool output, raw errors and credentials are not logged there.
Ordinary DSH Tool results/events continue through the existing Adapter pipeline.

## Verification

```powershell
# Complete Tool/worker tests against the real offline image; model replies are
# deterministic fixtures, while structured execution, IPython and containers are real.
$env:KANALOA_TEST_CONTAINER = '1'
npm run test:kanaloa-tools

# Real saved-provider HTTP -> ACP -> Tool -> completed -> one Message acceptance.
# Uses a disposable workspace/database, and never changes saved model settings.
$env:KANALOA_LIVE_ACCEPTANCE = '1'
node scripts/run-python.mjs apps/api -m pytest -q ../../packages/kanaloa-tools/test/test_live_runtime.py -s
```

Without `KANALOA_TEST_CONTAINER`, Tool tests can use a private Python 3.12
environment at `.venv` or `KANALOA_TEST_PYTHON`. This is a trusted test-only
subprocess fixture, not the production transport or proof of OS isolation.
On Windows the NOOA tests explicitly skip with the `fcntl` reason; native
IPython tests still exercise real execution, isolation, cancel and crash.

The container tests additionally check blocked outbound network, absence of
host credentials, read-only filesystem and resource settings. Live Provider
acceptance is separate; a deterministic model fixture is never counted as a
successful real model call.

Additional opt-in checks:

```powershell
# Existing native Runtime lifecycle checks, using saved configuration.
$env:KANE_REAL_DSH_TEST = '1'
node scripts/run-python.mjs apps/api -m pytest -q tests/test_kanaloa_real_dsh.py tests/test_kanaloa_runtime_acceptance.py -s

# Three observations of each no-tool startup mode; run without other Tool tests.
$env:KANALOA_PERFORMANCE = '1'
node scripts/run-python.mjs apps/api -m pytest -q ../../packages/kanaloa-tools/test/test_performance.py -s
```

The live private suite also checks real approval rejection, native steer behavior,
parallel native sessions and Branch state isolation without replaying historical
file writes. The container suite checks EOF/child cleanup, forced Worker loss,
typed method composition and the bounded model-call budget. The performance
suite uses real Provider calls, whereas Worker resource observations use fixed
model replies and report that distinction explicitly.

See [ACCEPTANCE.md](ACCEPTANCE.md) for this delivery's evidence, counts and limits.

## Reproducibility And Distribution

The Docker base is pinned by digest as well as Python version. The lock was
generated with uv 0.13.1; installation requires all package hashes. Kanaloa
Runtime peer versions are exact and the repository npm lock retains their
dependency closure.
Do not regenerate dependency locks incidentally during deployment.

The source release contains neither a prebuilt image nor downloaded dependencies,
local virtual environments, model configuration, credentials or test sessions.
Building locally fetches upstream distributions. Keep their LICENSE/NOTICE files
and the Debian image's copyright/license files if redistributing an image.
Transitive dependencies include certifi (MPL-2.0) and tqdm (MPL-2.0 AND MIT);
retain their notices and applicable source-availability information. The installed
NOOA/IPython and these dependencies were not modified. No image is published by
this source-only delivery.

## Known Limits

- The structured-execution dependency is not a native Windows Worker: its POSIX
  `fcntl` dependency is satisfied inside Linux containers, not patched or
  emulated on the host.
- Python state is live-session state, not a durable checkpoint. Parent restart,
  Worker loss, cancel and idle expiry lose it. Native session resume does not
  silently restore Python objects or replay side effects.
- Separate kernels do not make shared workspace files private. Sessions sharing
  an explicitly approved workspace can see the files in that workspace. Use
  separate workspaces for file-level isolation, and do not approve secret-bearing
  workspaces unless that access is intended.
- Only the explicit `ipython` method proxy is exposed to structured subtasks; it
  is not a generic gateway to every Runtime Tool/MCP or to other Agents. Such
  access is not fabricated.
- The resource/timing data is a Windows-host observation, not a Linux-host E2E
  certification or a statistically controlled Provider benchmark. Two Tool
  schemas add 1227 JSON bytes to the enabled tool catalog; extra model calls occur
  only when NOOA is invoked. Exact token cost depends on the selected model.
- Docker/host failure can prevent cleanup; an explicit cleanup error is not
  success. Preserve the affected workspace, inspect only owned containers, and
  never rerun an unknown side effect to recover Python state.

## Stop And Remove

Normal Kanaloa shutdown disposes the plugin and its containers. For an abrupt
host failure, inspect only this plugin's containers using
`docker ps -a --filter name=kane-kanaloa-`; remove identified leftovers explicitly.
Disable the plugin to return to the original Kanaloa path. Removing the optional
Tool image does not delete Conversation history, the database or workspace files.

The structured-execution package is NVIDIA NeMo NOOA 0.0.10 (Apache-2.0,
NVIDIA Corporation and affiliates). IPython 9.6.0 is BSD-3-Clause, the IPython
development team. The Kanaloa Runtime uses pinned DeepSeek Harness packages under
the MIT License. Upstream names here are attribution and implementation facts,
not Kane-Kanaloa product branding. Required licenses and notices are retained in
installed distributions and [the repository notice](../../THIRD_PARTY_NOTICES.md).
