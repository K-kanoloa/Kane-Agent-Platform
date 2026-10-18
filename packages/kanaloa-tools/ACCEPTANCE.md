# Kanaloa NOOA Tool Acceptance

Date: 2026-10-17 UTC. Status: READY for the scoped source-code delivery; push
requires Owner confirmation. This is not an assertion of bug-free software or
independent Linux-host certification. The commit containing this report is the
delivery commit; its exact hash is included in the final handoff.

## Scope And Baseline

- Publishing target: `https://github.com/K-kanoloa/Kane-kanoloa.git`, `main`.
- Target main / delivery parent: `3bf06b3ab1ddb76de85854e533ec3c6e6d2e1a1f`.
- Local preparation branch: `codex/kanaloa-nooa-tool`.
- Original local main `6c8a46859f5a54f561fed325f982bd4b48491b3e` is preserved.
  Its source matches target main; only README/site repository links differ.
- No push, force push, tag, reset, Core rewrite or unrelated feature change.
- No changes to Kane domain, BaseAdapter, public HTTP/UI, external Connectors,
  Connector Protocol, Store, Mailbox or main Agent loop.
- DSH remains the owner of model calls, sessions, native tools, approval,
  subagents, resume, steering and the top-level execution loop.

Modified existing files: `package.json`, `package-lock.json`,
`THIRD_PARTY_NOTICES.md`, `apps/api/app/adapters/kanaloa-persona.patch.yml`.
New private package files: `.dockerignore`, `Dockerfile`, `package.json`,
`index.mjs`, `worker.py`, `setup.mjs`, `requirements.in`, `requirements.lock`,
`README.md`, this report, `test/tools.test.mjs`, `test/container.test.mjs`,
`test/test_live_runtime.py`, `test/test_performance.py`.

## Confirmed Fixes

1. The overlay initially addressed a nonexistent `kanaloa-tools` row, which DSH
   warned about and skipped. The real model then truthfully reported no IPython
   tool. The overlay now uses DSH's native `insert` with a patch-relative module
   path. A composed-profile regression and the real HTTP Tool path pass.
2. Docker `--rm` and explicit cleanup raced: Docker returned "removal ... already
   in progress" although the container was going away. Cleanup now makes bounded
   confirmation attempts for that exact status only, and still fails on other
   errors. This never retries task code.
3. An uncertain CLI exit observation previously skipped container removal.
   Cleanup now attempts exact owned-container removal even when the first
   observation fails, then requires a final process-exit observation. The real
   Worker test with an injected first-observation failure passes.
4. The Python base image is pinned by digest; requirements pin all transitive
   versions/hashes. Disabled/no-call paths never import NOOA or start workers.
5. Approval text explicitly discloses that an approved workspace can contain
   secrets. Neither approval nor documentation pretends a bind mount filters
   workspace files. Host homes, environment credentials and Docker sockets are
   not forwarded into containers.

## Docker Recovery

Observed Docker Desktop 4.61.0 failed before Engine startup at two Windows
AF_UNIX endpoints. The backend reported Windows error 1920 (cannot access file),
followed by invalid-name listener failure. Exact file rename/query also failed.
This establishes the stale-endpoint startup failure, not a particular Windows
kernel corruption mechanism or a proven socket-specific ACL root cause.

The run-directory owner had FullControl. The backend log explicitly said all
local engines were stopped. Only the failed installed Desktop/backend and hung
metadata-probe processes were stopped. After verifying directory contents, these
socket-only directories were renamed in place and preserved:

- `%LOCALAPPDATA%/Docker/run.kanaloa-preserved-20261017-223636`
- `%LOCALAPPDATA%/Docker/run.kanaloa-preserved-20261017-224121`
- `%LOCALAPPDATA%/docker-secrets-engine.kanaloa-preserved-20261017-224121`

Docker recreated fresh runtime directories and started Linux Engine 29.2.1,
kernel `6.6.87.2-microsoft-standard-WSL2`, context `desktop-linux`. No data disks,
images, containers, volumes, WSL registrations, user settings or ACLs were reset
or removed. No factory reset, prune, isolation bypass or upgrade was used.
The Linux image was built and rebuilt successfully. The platform image config
is `sha256:c6928e2ca3d57cb2b047c3f302da71b04bd10056e8e8424e3e9d0cbd7eebe49c`;
Docker inspect reported 163048251 bytes. Build attestations can change while
the locked platform config/layers remain unchanged.

Related upstream report, used as supporting context rather than proof of this
machine's root cause: https://github.com/docker/desktop-feedback/issues/554.
Microsoft documents AF_UNIX endpoints as reparse points:
https://devblogs.microsoft.com/commandline/af_unix-comes-to-windows/.

## Test Results

Counts below are consolidated final suites, not accumulated reruns. Failed
development attempts were corrected and are not added to passing-case counts.

| Suite | PASS | FAIL | SKIP | Evidence class |
| --- | ---: | ---: | ---: | --- |
| API default regression | 184 | 0 | 9 | Existing contract/unit/integration suite |
| API real Runtime opt-in cases | 9 | 0 | 0 | Real DSH process and saved Provider |
| Bridge | 4 | 0 | 0 | Existing regression |
| Private Tool suite | 18 | 0 | 0 | Real NOOA/IPython/Linux containers; model responses are fixtures |
| Private live HTTP Tool acceptance | 4 | 0 | 0 | Real DSH, saved Provider and container Tool |
| Private performance comparison | 1 | 0 | 0 | Nine real saved-Provider PONG observations |
| Shared Connector conformance | 7 | 0 | 0 | Existing trace conformance, not new Agent E2E |
| Codex Golden Connector unit tests | 6 | 0 | 0 | Existing unit tests, not new Codex E2E |
| MCP service tests | 4 | 0 | 0 | Existing service unit tests |
| UI regression | 26 | 0 | 0 | Real browser/HTTP with the existing test Agent peer |

There are 263 distinct passing test cases across the consolidated suites.
The default API command's nine skips are exactly the nine separately executed
real Runtime cases, not unexecuted acceptance tests:

- PONG/completion truth (1), unconfigured-model refusal (1), identity (1).
- Tool, foreground Subagent and background Subagent crash/checkpoint cases (3).
- HTTP Normal/continuity/whole Loop (1), real Tool success (1), cancel with late
  native completion (1).

Additional checks: Web TypeScript PASS; actual MCP stdio initialize/list-tools/
canonical-spec call PASS (7 tools); API health, Bridge health and browser smoke
PASS, HTTP 200, zero browser console errors and bad responses. The optional
runtime flags must be set when reproducing opt-in tests; an unconfigured test
run still intentionally skips them.

The original four container-blocked tests all actually ran and passed:

| Previously skipped check | Current result |
| --- | --- |
| NOOA Predict / typed output / current DSH model route | PASS |
| NOOA CodeAct / persistent IPython bridge | PASS |
| Invalid typed output / missing explicit model finish | PASS, rejected |
| Real container OS containment / resource policy | PASS |

## Real Runtime Evidence

Only session IDs and lifecycle facts are retained here, not prompts, raw tool
results, stderr or credentials. The selected saved route was
`kane-kanaloa / sensenova-6.8-flash-lite`; no user model settings were changed.

| Scenario | Native session / Turn | Observed result |
| --- | --- | --- |
| Plain PONG | `ac5eaca0-0bd9-4f4d-a2dd-57d1bead7c14` | completed, one Message, finished, process alive, graceful exit 0 |
| HTTP PONG and second round | `e15aecb2-0104-469e-b04c-f3ffe4cf4eb3`, `turn_1434ff55373a` | one native session; one Message per round |
| Whole Loop, custom 2 | `7086354f-40d0-4ffd-a9ee-e0de79d3cf69`, `turn_eab86e56c7c9` | two native prompts; one completion and one Message for whole Loop |
| Tool crash | `e11a37ad-053b-4120-9559-f4b18d1247a8` | interrupted, checkpoint unknown outcome, rebind without prompt/rerun |
| Foreground Subagent crash | `25f0d9de-2558-4afe-a09e-662e66345a12` | interrupted, one-shot child proven in checkpoint, no rerun |
| Continuable background crash | `a5d956de-da3f-4a1e-8a97-81b1b61a5403` | parent remained finished; continuable child proven; no work replay |
| Cancel, then late completed | `2598a6fa-40b0-4ee4-9470-b947b8940b77`, `turn_a91d7a54b198` | stayed interrupted, partial retained, no formal Message |
| IPython then real NOOA CodeAct | `91aabfa9-37f9-40dc-b7a8-35ecc10c35e2`, `turn_eb1f787a9e2e` | same native session, approved Tool calls, value reused, one Message per reply, finished |
| Branch/parallel isolation | `74072e3e-8a68-49a3-a343-de9026a8079e`, `8c6e9db0-45a7-4538-b531-394abf91f89d`, `e7ce95a6-9b79-425e-ab47-2597f45bac7f` | three isolated native sessions; Python state fresh in branch/parallel; original file write occurred once |
| Real approval reject | `368a87fc-dfbd-480e-8de7-7ca4332642ca`, `turn_c036a3bcd5fa` | waiting_user then rejection, no file side effect, one refusal Message |
| Real native steer | `d3d3da37-ab60-41b3-a4f4-bf3810e7784e`, `turn_f318cef7ee7f` | same Turn/session, session/steer observed, A absent/B present, one final Message |

Native shell success did not naturally request approval (NOT_TRIGGERED in that
case); explicit IPython/NOOA Tool approval and reject paths were actually
triggered separately. No fake approval was substituted. Loop default 5 and
Unlimited are covered by the unchanged API/runtime and UI contract tests; real
whole-loop inference was exercised with 2 iterations, not an unbounded run.

## Containment, Lifecycle And Audit

- Both Worker types use non-root UID 1000, network=none, read-only rootfs,
  cap-drop ALL, no-new-privileges, 64 PID / 768 MiB / one CPU limits and a bounded
  tmpfs. Only the trusted approved workspace is bind-mounted.
- Actual negative execution checked outbound network denial, host credential
  environment absence, no Docker socket and denied root/read-only workspace
  writes. Same container policy applies to CodeAct and persistent IPython.
- Missing/forged session binding, invalid typed input, denied approval and
  disabled tools never launch a Worker. Ephemeral mode rejects self.ipython.
- CodeAct actually combined the deterministic `ipython` proxy and typed AI
  `predict` method. Invalid output and missing explicit model finish fail closed.
- Concurrent native sessions and separate Kanaloa plugin instances retain
  separate Python states. Branch execution did not replay historical code.
- Real cancel, timeout, forced Worker loss and parent EOF remove owned processes;
  EOF also kills a spawned child through container PID-namespace teardown.
- A model-call budget test proved no second request beyond a one-call budget.
- Final inspection found no remaining `kane-kanaloa-*` containers or test server
  listeners. Docker Engine/image remain available; preserved broken sockets
  were deliberately not deleted.
- No new Manager, Engine, FSM, queue, public protocol, credential format,
  checkpoint subsystem or plugin system was introduced. Only DSH's existing
  services are consumed by the private Tool package.

## Performance And Cost

Windows host: Node 24.13.0, API/Bridge Python 3.11.9, Tool Python 3.12.15.
Three samples per mode, same saved Provider, ordinary no-tool PONG:

| Mode | Median startup ms | Median Runtime RSS MiB | Median PONG ms |
| --- | ---: | ---: | ---: |
| Tool plugin disabled | 3943 | 167.2 | 22731 |
| IPython only | 3737 | 172.5 | 25143 |
| NOOA + IPython available | 3677 | 166.6 | 25722 |

Each request had zero Tool calls; none created a NOOA Worker or IPython Kernel.
Provider latency varied widely (7103-36665 ms), so these samples do not establish
a causal latency difference. No startup/RSS regression was demonstrated.

Real Worker observation with fixed model responses: IPython cold 1587 ms,
warm samples 5/5/4/4/4 ms, memory 44.77 MiB; NOOA memory 181 MiB, total observed
Predict time 7796 ms including a Docker stats sample. These are not Provider
inference timings. Two enabled Tool schemas add 1227 JSON bytes to the catalog;
they are not zero-token overhead. IPython makes zero model requests; NOOA's
additional requests use the existing route, are bounded and billed normally.

## Release Hygiene And Limits

- DSH/ACP/tools/LLM 0.1.5-rc.3; NOOA 0.0.10; IPython 9.6.0; Python 3.12.15.
  Linux base digest and transitive hashes are locked. No upstream source patch
  for Windows `fcntl`, no fake NOOA replacement, no host-Python fallback.
- The built image contains 85 installed distributions. Actual NOOA Apache-2.0,
  IPython BSD-3-Clause, LiteLLM MIT, OpenAI Apache-2.0 and Pydantic MIT license
  files were verified present. certifi/tqdm MPL notices and base-image notices
  must remain when distributing an image. This release ships source only.
- Source/commit candidates were scanned for provider keys, GitHub/cloud tokens
  and private-key material, with a positive scanner self-check: no matches.
  Only `.env.example` is tracked; env files, virtual environments, runtime DBs,
  credentials, caches, sessions and logs are excluded. This is not a guarantee
  that every conceivable secret encoding can be detected.
- Temporary host Python/uv environments, download caches, smoke database,
  generated UI output and build/test caches were removed. A real NOOA container
  Predict test passed again after deleting the host test venv; production does
  not depend on it. The optional Tool image is intentionally retained for use.
- Temporary acceptance configuration used copied saved credentials only in the
  existing isolated crash fixture, which unlinks them on teardown. Saved user
  configuration/provider were not replaced. Native Runtime session evidence is
  left with DSH's own persistence; no user's session index is manually edited.
- No kernel/object checkpoint restoration or blind replay is promised. Approved
  shared workspace files remain shared and may contain secrets; use separate
  workspaces if that is not intended. Ordinary Linux-host deployment was not
  tested independently from the real Linux containers on Windows/WSL2.
- Initial test-only failures (wrong MCP SDK attribute in a temporary probe and
  missing temporary SQLite parent directory during smoke setup) were fixed in
  the probes/environment, not by changing MCP or Kane Core. Final checks pass.

## Owner-Approved Push Only

Read-only GitHub checks confirmed account `K-kanoloa`, repository
`K-kanoloa/Kane-kanoloa`, default branch `main`, and current push permission.
No credential was returned or changed.

Prepared fast-forward command, not executed:

```powershell
git push https://github.com/K-kanoloa/Kane-kanoloa.git codex/kanaloa-nooa-tool:main
```

Recheck remote main before publishing. If it has advanced, stop and integrate
normally; never force push. The configured `origin` still points to the old
account, so this command deliberately uses the verified explicit destination.
