# /games Repurposed — Round Schedule & Results

**Author:** Strahinja (Backend Dev)
**Date:** 2026-07-18
**Status:** IMPLEMENTED

## Decision

`/games` now shows all games from the current EuroLeague round instead of listing tracked games.

## Rationale

Filip requested round-level visibility. The old `/games` (tracked games) was redundant with `/status` which shows tracking count. Round schedule is more useful — users see finished scores and upcoming kickoff times in one view.

## Impact

- `/games` handler no longer calls `gameTracker.getTrackedGames()` — calls `stats.getCurrentRoundGames()` instead
- `composeTrackedGames()` in `MessageComposer` is now unused (kept for potential future use)
- Serbian time (Europe/Belgrade) used for upcoming game times — `Intl.DateTimeFormat`, no deps added
- EuroLeague rounds API (`/v2/.../rounds`) discovered and integrated; round detection is date-range based
