# Code Review — Uncommitted src/ Changes

**Author:** Bogdan (Lead)
**Date:** 2026-07-18
**Status:** APPROVED

## Scope

5 modified files from previous sessions, never committed:
- `src/adapters/dunkest/dunkest.adapter.ts`
- `src/container.ts`
- `src/domain/command-router.ts`
- `src/domain/message-composer.ts`
- `src/domain/roster-tracker.ts`

## Verdict: APPROVE

All changes are architecturally consistent, correct, and introduce no regressions. Two non-blocking items flagged for follow-up.

## Findings

### ✅ Approved Changes

1. **Dunkest `/roster/preview` endpoint** — The `/roster` endpoint only works for the authenticated user's teams. Switching to `/preview` makes it accessible for any team. Correct fix.

2. **Container roster file fallback removed** — API is now the single source for rosters. If it fails, rosters aren't loaded (graceful degradation with warning log). Clean simplification.

3. **`/trackall` command** — Tracks all today's games in one shot. Plain text output (correctly not in `MARKDOWN_COMMANDS`). Per-game error handling. Follows existing command patterns perfectly.

4. **Help text updated** — `/trackall` added to help in message-composer.

### ⚠️ Follow-up Items (Non-Blocking)

1. **Dead code in `roster-tracker.ts`** — `loadFromFile()`, `loadFromFileAndMerge()`, `mergeRosters()`, and the `readFileSync` import are all unused now that the container no longer calls them. Should be cleaned up in a follow-up commit.

2. **No tests for `/trackall`** — The new command has zero test coverage. Should be added to `tests/unit/command-router.test.ts`.

## Test Results

- **206/222 tests pass** — all unit tests + EuroLeague integration tests green.
- **16 SQLite failures** — pre-existing environment issue (better-sqlite3 compiled against Node 23, running on Node 22). Unrelated to these changes.
