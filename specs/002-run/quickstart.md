# Quickstart — Foreman Run (P2)

## Verification status

- Automated: `npm run typecheck`, `npm test -- --run`, and `npm run build` pass.
- Desktop live-session acceptance: pending; require a real signed-in provider and manual session execution.

## Build

```powershell
npm run typecheck
npm test -- --run
npm run build
npm run watch
```

Reload OpenCode Desktop after the watch build loads.

## Verify Ready start

1. Create a task with a real project directory and a non-empty description.
2. Drag it to Ready.
3. Confirm exactly one session tab opens or receives focus.
4. Confirm the transcript contains the description, not an empty prompt.
5. Confirm the card is in Doing and shows Working.

## Verify duplicate/drop failures

1. Double-drop the same task quickly.
2. Confirm only one session is created.
3. Drop a task whose project directory no longer exists.
4. Confirm no session is created and the task returns to its previous column with an error.

## Verify live state

1. Watch Working, then Unread after the first turn finishes.
2. Open the card session; confirm the state becomes Reviewed within 5 seconds.
3. Delete or rename the session outside Foreman; confirm Session missing stays recoverable.
4. Restart the sidecar and confirm cards derive state again without manual refresh.

## Verify follow-up and Done

1. Send an empty follow-up and confirm Save remains disabled.
2. Send a follow-up from Reviewed and confirm it uses the existing session.
3. Send one while Working and confirm queue delivery.
4. Drop Reviewed to Done; confirm finishedAt persists.
5. Drop a working card to Done; confirm cancel leaves it in Doing.
6. Move Done back to Todo/Ready; confirm sessionID is retained and finishedAt cleared.

## P2 constraints

- P2 never approves permissions or answers questions.
- P2 never creates another session after sessionID is set.
- P2 never deletes or stops sessions.
