# Quickstart — Foreman Board (P1)

**Audience**: the person building and verifying P1 locally on Windows.
**Goal**: a working board page in OpenCode Desktop, with tasks that survive a restart.

## Prerequisites

- OpenCode Desktop 2.x installed (this repo was written against the V2 GUI plugin API).
- Node.js 20+ and `npm` on PATH.
- `C:\Users\ADMIN\.opencode\bin\opencode.exe` available if you want to cross-check sessions
  from the CLI (not required for P1).

## 1. Build the plugin

```powershell
cd C:\Users\ADMIN\Documents\working\Foreman
npm install
npm run build          # produces dist/gui-experimental.cjs
npm run watch          # or: rebuild on save, the app hot-reloads a local plugin
```

Expected: `dist/gui-experimental.cjs` exists and imports no bundled copy of `solid-js`,
`effect` or `@opencode/*`.

## 2. Register it

Edit `C:\Users\ADMIN\.config\opencode\opencode.json` and add the absolute path to the plugin
list:

```json
{
  "plugins": [
    "superpowers@git+https://github.com/obra/superpowers.git",
    "C:\\Users\\ADMIN\\Documents\\working\\Foreman"
  ]
}
```

A local directory is loaded as a GUI plugin when its `package.json` exports
`./gui-experimental`; the package name `foreman` gives the plugin id `foreman`.

## 3. Open the board

1. Restart OpenCode Desktop (or reload the window) so the plugin loads.
2. Press `Ctrl+Shift+B`, or run **Foreman: Open board** from the command palette.
3. Settings opens on the Foreman page (`/settings?tab=foreman`).

## 4. Verify P1

| Check | Expected |
|---|---|
| Empty state | Four columns, each with a count of 0 and a "New task" action |
| Create | Title + project → card appears at the top of Todo |
| Validation | Empty title or project disables submit and names the reason |
| Edit | Change title, project, agent, model, column → card updates immediately |
| Column | Set a task to Done → `finishedAt` set; back to Todo → cleared |
| Delete | Confirmation dialog, then the card disappears |
| Persistence | Restart the app → every task and column is unchanged |
| Narrow window | Columns scroll horizontally, cards stay readable |
| Filter/search | Project filter and title search combine correctly |

## 5. Cross-check from the CLI (optional)

```powershell
& "C:\Users\ADMIN\.opencode\bin\opencode.exe" plugin list
& "C:\Users\ADMIN\.opencode\bin\opencode.exe" api get "/api/session?limit=5"
```

P1 must not create or modify any session: the session list should be unchanged after you
use the board.

## 6. Remove it

Delete the `Foreman` entry from `plugins` in `opencode.json` and restart the app. The
plugin's stored tasks live under its own key in the app's plugin store and are simply not
read while it is unloaded.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No Foreman page in Settings | Bundle missing or wrong export | Check `exports["./gui-experimental"]` and `npm run build` |
| Page renders but is empty forever | Store failed to load | Open devtools, look for a schema error; the board should show a warning instead |
| Command does nothing | App is on the web build | GUI plugins are desktop-only |
| Edits vanish after restart | Store key changed between builds | Keep the store key stable; P1 has no migration |
| Hot reload not applying | Watcher not running | `npm run watch`, then reload the window |
