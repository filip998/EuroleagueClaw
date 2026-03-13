# Decision: Player-Only Chat Notifications

**Date:** 2026-07-14
**Author:** Strahinja (Backend Dev)
**Requested by:** Filip Tanic

## Context

Filip directed that the bot should ONLY post tracked-player (fantasy roster) notifications to Telegram. All game-level events — score updates, quarter transitions, lead changes, big runs, game start/end announcements — should be silenced.

## Decision

Replaced the `onEvent` callback in `container.ts` with a debug-log no-op. The GameTracker still detects events internally (needed for game lifecycle state management: scheduled→live→finished), but they are not forwarded to chat. Only the `onPlayByPlay` roster-match callback sends messages.

## What Changed

- `src/container.ts`: `onEvent` callback now logs at debug level only, does not call `chat.sendMessage`, throttle, or dedup storage.

## What Was Preserved

- GameTracker `detectEvents()` — still runs for internal state tracking
- PBP polling and `onPlayByPlay` roster-match callback — unchanged, still posts player notifications
- `MessageComposer.compose()` and all game event types — retained as dead code for potential future re-enablement

## Impact

- Zero test breakage (233/233 unit tests pass)
- Build and lint clean
- If game-level events are wanted again later, restore the original `onEvent` callback body from git history

## Team Notes

- The `ThrottleManager` is no longer exercised for game events. If player notifications ever need throttling, wire it into the `onPlayByPlay` path.
- `MessageComposer`'s game event formatting methods are now dead code. Consider cleanup if this direction is permanent.
