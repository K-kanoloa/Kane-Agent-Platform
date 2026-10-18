# Kane-Kanaloa v3.0.1 Beta

Release tag: **v3.0.1-beta**. Early evaluation release: **known and unknown bugs
may exist**. This is not a production-readiness guarantee. Back up your data,
use disposable workspaces for testing, and review Agent side effects.

Kane-Kanaloa is a local-first environment for conversations that continue while
AI work is running. Kane is the thin, model-free **Conversation <-> Agent
Harness**. Kanaloa is the bundled first-party Agent. Intelligence, tools and
execution stay with the Agent; Kane keeps conversations, messages and native
sessions connected.

## What You Get

- **Long-running conversations.** Continue the same Turn across multiple messages
  and native-session reconnects.
- **Concurrent work.** Create explicit parallel Turns, keep one in focus and let
  the others continue in the background.
- **Mid-task guidance.** Redirect a running Turn when its Agent supports native
  steering, or deliver the instruction at the Agent's declared safe boundary.
- **Isolated branches.** Start from a historical message without rewriting the
  original append-only conversation.
- **Persistent Python.** Reuse Python variables within a live Kanaloa session,
  with separate state for parallel Turns and Branches.
- **Structured execution.** Run bounded, validated Python-assisted subtasks with
  explicit approval and container isolation.
- **Honest recovery.** Preserve partial output, check native session truth after
  restart and never replay an unknown side effect automatically.
- **External Agent connections.** Pair Agent-side Connectors through one public
  protocol instead of adding vendor execution logic to Kane Core.

Streaming deltas remain live status. One complete logical Agent reply is stored
as exactly one chat Message.

```text
Web UI -> Kane HTTP/SSE + Store -> Kanaloa
                              -> Generic ConnectorAdapter
                                 <- Agent-side Connector <- External Agent
```

## Current Beta Capabilities

- Conversation, Message, Turn, Focus Turn, Mailbox and Branch persistence.
- Normal Mode and optional Loop Mode (default 5, unlimited or custom limit).
- Streaming, cancellation, approvals, native steering and session rebind where
  the selected Agent declares and implements those capabilities.
- In-page Kanaloa Base URL, Model and API Key configuration. No fixed model is
  silently selected for a new user.
- Live activity, partial output and terminal states over SSE.
- Connector pairing, Connect Skill, bootstrap MCP, shared conformance checks and
  a reference Connector implementation.

Availability does not prove model credentials or successful execution. An
Agent-side Connector must connect and remain running. Skill/MCP assist setup;
**MCP is not the persistent chat transport**.

## Windows Quick Start

Requirements: Node.js 24+, npm, Python 3.11+ and PowerShell. Optional structured
Python tools require Docker Desktop with WSL2/Linux containers on Windows, or a
Linux Docker engine on Linux. They are not part of Kane Core and start only when
Kanaloa invokes them. The bundled Kanaloa Runtime is installed with the project;
no separate Agent application is required.

```powershell
git clone https://github.com/K-kanoloa/Kane-kanoloa.git
cd Kane-kanoloa
npm ci
npm run setup:api
npm run start:stack
```

Open http://127.0.0.1:3000. Web/API start together on ports 3000/8000.
Stop with `npm run stop:stack`. Legacy Local Bridge is optional, not the
unified Connector transport.

## Linux Quick Start

Requirements: Node.js 24+, npm and Python 3.11+. The development launcher is
cross-platform and keeps API/Web output in the current terminal:

```bash
git clone https://github.com/K-kanoloa/Kane-kanoloa.git
cd Kane-kanoloa
npm ci
npm run setup:api
npm run dev:stack
```

Open http://127.0.0.1:3000 and press `Ctrl+C` in the launcher terminal to stop
both services. This beta's Linux host path has not received the same complete
acceptance pass as Windows with Linux containers; see the limits below.

### Configure Kanaloa

In Kanaloa settings, save your Provider's **Base URL, Model and API Key**, then
create a new conversation. Use an API compatible with one of the formats shown
in the settings screen. No fixed model fallback is supplied. Settings apply to
new native sessions; existing sessions retain their selection. Keys use the
local Runtime credential store, not Kane's conversation database. Never commit
that store or paste keys into chat history.

For persistent Python and structured execution, build the optional offline Tool
image once:

```powershell
npm run setup:kanaloa-tools
```

See [Kanaloa Structured Python Tools](packages/kanaloa-tools/README.md) for the
approval, isolation, lifecycle and rollback boundaries.

SQLite defaults to `apps/api/kane.db`; `KANE_SQLITE_PATH` overrides it.
Runtime databases, credentials, logs and caches are excluded from Git.
[.env.example](.env.example) is historical guidance with placeholders, not a
complete vNext configuration contract. Set API process variables explicitly.
Do not expose the unauthenticated local default publicly; use
`OCTOPUS_API_TOKEN`, protected transport and deployment network controls.
When API token protection is enabled, the Web UI asks for that access token.
It is held in browser tab session storage and sent with API/SSE requests;
the Web proxy never substitutes its own server-side token for an anonymous caller.

## External Agents

1. Add an external Agent in Kane and obtain endpoint, identity and pairing code.
2. Give it [Connect Skill](skills/kane-connect/SKILL.md) and the
   [canonical Protocol](docs/KANE_CONNECTOR_PROTOCOL.md).
3. Configure its Agent-side Connector and transfer credentials through protected
   input, not source files or public issue reports.
4. Keep it running and use shared conformance checks.

[MCP bootstrap](connectors/kane-mcp/README.md) |
[Codex reference](connectors/codex/README.md) |
[Shared conformance](connectors/conformance/protocol.py).

Connector dependencies are installed separately. Kane does not install,
authenticate or guarantee support for every external Agent.

## Verified In This Beta

The current delivery includes real Runtime evidence for:

- two messages continuing one native Kanaloa session;
- a whole Loop producing one final Message;
- persistent Python state in one session and fresh state across parallel Turns
  and Branches;
- parallel native sessions, branch history isolation and no historical side-
  effect replay;
- native steer changing behavior after a running Tool boundary;
- approval allow/reject, cancellation, partial-output preservation and late-
  completion rejection;
- Tool, foreground child and continuable background child crash handling without
  blind reruns.

See the [Runtime acceptance record](packages/kanaloa-tools/ACCEPTANCE.md) for the
exact evidence classes, session facts and test counts. A test record is not a
production-readiness guarantee.

## Checks And Limitations

```powershell
npm run typecheck:web
npm run test:e2e:smoke
```

Smoke needs a running stack and Playwright Chromium
(`npx playwright install chromium` if absent). It is read-only, not model E2E.
Full suites were not rerun as a release gate; see [release notes](RELEASE_NOTES.md).

- Session/context rebind is not proof that unfinished execution survived.
- Stop/cancel does not roll back external side effects.
- Approval depends on actual Agent/tool behavior.
- External compatibility, tools and Windows environment setup remain variable.
- Current UI model configuration centers on OpenAI-compatible APIs.
- Live Python objects are session state, not a durable checkpoint. Worker loss,
  idle expiry or process restart starts fresh state; code is not replayed.
- Background Turn status is persisted and visible, but detailed live activity is
  followed for the Turn currently open in the UI.
- The optional legacy Local Bridge still reports v2.0.0 and is not the vNext
  Connector transport. Historical v2 tags remain unchanged.

[CHANGELOG](CHANGELOG.md) | [RELEASE_NOTES](RELEASE_NOTES.md) |
[Third-party notices](THIRD_PARTY_NOTICES.md).

Kane-Kanaloa's own code is available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Use, modification and distribution
are permitted for purposes allowed by that license. Commercial use requires
separate permission from the copyright holders. This is a source-available
noncommercial license, not an OSI-approved open-source license.
Third-party dependencies retain their own licenses.
Implementation attribution and required redistribution notices are preserved in
[Third-party notices](THIRD_PARTY_NOTICES.md); upstream project names are not
Kane-Kanaloa product features.
