# Foreman

A task board for OpenCode Desktop. A card is a **task**, not a chat. Dragging a task
to **Ready** starts an OpenCode session for it; the board follows that run and tells
you when it is working, waiting on you, or broken — until you move it to **Done**.

> **Status: P1 implementation complete.** P2 and P3 are specification only.
> Phases: `specs/001-board/` (P1), `specs/002-run/` (P2), `specs/003-intervene/` (P3).

## The loop

```
TODO  backlog you write
  │ drag                                    (P1: column is set from the task dialog)
  ▼
READY ──► create session + prompt ──► DOING   (P2)
                                       ├─ working          agent is running
                                       ├─ action required  permission / question
                                       │    └─ Approve, Always, Reject / answer ──► DOING
                                       ├─ unread           finished, you have not read it
                                       │    └─ open + follow-up ──► DOING
                                       └─ error            run failed
                                            └─ analyse lesson / retry ──► DOING
DONE ◄── drag after you have read the outcome   (P2)
```

## Docs

| Phase | Spec | Plan | Tasks |
|---|---|---|---|
| P1 — Board and task store | [spec](specs/001-board/spec.md) | [plan](specs/001-board/plan.md) | [tasks](specs/001-board/tasks.md) |
| P2 — Run the task | [spec](specs/002-run/spec.md) | [plan](specs/002-run/plan.md) | [tasks](specs/002-run/tasks.md) |
| P3 — Intervene | [spec](specs/003-intervene/spec.md) | [plan](specs/003-intervene/plan.md) | [tasks](specs/003-intervene/tasks.md) |

Shared entity model: [specs/001-board/data-model.md](specs/001-board/data-model.md).
Project rules: [.specify/memory/constitution.md](.specify/memory/constitution.md).

## P1 local development

```powershell
npm install
npm test -- --run
npm run build
npm run watch
```

Open `/settings?tab=foreman` in OpenCode Desktop or use `foreman.open-board`
from the command palette. The watch build reloads the local GUI plugin.

## P2 run flow

- Drag a Todo/Ready task onto Ready, or save the P1 task dialog with column Ready, to create one OpenCode session and send the prompt.
- Doing cards show working, unread, reviewed, missing, or disconnected state.
- Click a card to open and focus its existing session tab.
- Send follow-ups from the card; they use queue delivery while the run is working.
- Drag reviewed tasks to Done. A working run requires confirmation because the session continues.

## Docker deployment and automatic startup

Foreman runs in Docker Compose. SQLite lives in the named `foreman-data` volume and the
container uses `restart: unless-stopped`. The app listens on port `4318` inside the
container; the Docker port is published only on the current WSL2 Ubuntu VM address. On this Windows setup,
`scripts/start-foreman-docker.ps1` starts Ubuntu/ Docker Engine, starts the Compose app,
then refreshes a small Windows TCP relay and Tailscale Serve target for the current WSL IP.

The existing Tailscale HTTPS endpoint on port 443 is intentionally left unchanged.
Phone access remains tailnet-only at:

`https://desktop-3ta52l8.tail881468.ts.net:8443/`

Build the image, then start the stack through the Windows startup script. The script
creates/preserves the private Host Agent token, refreshes the WSL gateway address,
starts the Windows Host Agent, and then starts Foreman:

```powershell
docker compose build
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/start-foreman-docker.ps1
```

To inspect or stop:

```powershell
docker compose ps
docker compose logs -f foreman
docker compose down       # keeps the named data volume
```

To install Windows startup automation (run once in PowerShell):

```powershell
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$projectRoot = (Get-Location).Path
$script = Join-Path $projectRoot 'scripts\start-foreman-docker.ps1'
$pwsh = (Get-Command pwsh).Source
$action = New-ScheduledTaskAction -Execute $pwsh -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Foreman Docker' -Action $action -Trigger $trigger -Principal $principal -Description 'Start Foreman Docker and refresh its Tailscale route at Windows sign-in.' -Force
```

The WSL Ubuntu distro must retain its `/usr/local/sbin/docker-boot` startup hook. The
phone must be connected to the same Tailscale tailnet. The app container does not bundle
OpenCode. **Managed runtime remains the normal mode:** the Windows Host Agent discovers
the OpenCode Desktop 2.4.x CLI and starts/stops the server on demand. OpenCode itself binds
to Windows loopback; the Host Agent reverse-proxies it through its existing
`host.docker.internal:4320` listener. Each runtime receives a fresh 256-bit bearer token
in the HTTP Authorization header; the token is not placed in the URL and is invalidated
when the runtime stops. The OpenCode password is generated on Windows and never crosses
the Docker/WSL boundary. OpenCode 2.x currently supports Basic Auth for its native server
authentication, so the Host Agent injects that credential only on its loopback request
to `127.0.0.1`; it is never exposed to Docker or the network.
The Host Agent listener binds only to the private Windows↔WSL gateway address, not the LAN
interface. A separate 256-bit bearer token is generated and stored in the ignored `.env`
file; do not commit or share that file.

The Host Agent is started automatically by `scripts/start-foreman-docker.ps1` and should
be running before creating a Managed runtime session. If it is unavailable, restart the
stack with that script. External runtime remains available for explicitly configured
user-owned OpenCode servers.

## Fixed decisions

- **Form factor:** one OpenCode Desktop GUI plugin, package `foreman`, id `foreman`.
- **Surface:** a **dedicated board page** — a `SettingsPage` with id `foreman`, rendered at
  `/settings?tab=foreman` and opened by the command `foreman.open-board`, which calls
  `ctx.layout.settings("foreman")`. The GUI API has no standalone window; a dedicated page
  is the closest surface that belongs to no single session. A compact side-panel mirror is
  a later, optional addition — not part of P1.
- **Store:** `Store.global` in the plugin, one array of tasks. The database is never
  touched directly.
- **Card ↔ session:** one task owns at most one session. Follow-ups and retries stay in
  that session.
- **Board scope:** tasks from every project; each card shows its project.
- **P1 is render + create/edit/delete.** No drag-and-drop and no session work: a column is
  changed from the task's edit dialog. Dragging, and Ready starting a run, arrive in P2.
- **Lessons are files:** P3 writes `docs/lessons/<date>-<slug>.md` inside the task's
  project. ai-memory is not written.

## Constraints

- GUI plugin API is `./gui-experimental`: it may change between OpenCode releases.
- Desktop only; the web app does not load GUI plugins.
- The plugin observes sessions through the OpenCode client and server events; it never
  writes the database.
- `deleted/` renamed sessions, re-auth prompts, and provider quota errors surface as
  task errors rather than being auto-handled.

## Open questions (need owner approval)

1. Concurrent runs: unlimited (proposed) vs. a configurable cap.
2. UI copy language: English first (proposed), Vietnamese locale after.
