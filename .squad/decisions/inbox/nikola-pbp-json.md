# Decision: Raw PBP API Capture Approach for Data Analysis

**Date:** 2026-03-13  
**Agent:** Nikola (Data / Integrations)  
**Status:** IMPLEMENTED

## Context

Filip requested a full raw EuroLeague play-by-play API response for the PAO (Panathinaikos) vs Zalgiris game, captured in JSON format for inspection.

## Decision

**Preserve the raw API response without transformation.** Fetch from the live PBP endpoint and save both minified and pretty-printed JSON, exactly as returned by the API, without field name normalization, filtering, or restructuring.

## Rationale

1. **Raw inspection value:** Filip's intent is to audit the upstream schema directly. Transforming or normalizing would obscure the actual API contract.
2. **No downstream impact:** The raw payload serves analysis/research, not domain model mapping (which happens separately in `PlayByPlayEvent` adapter logic in `euroleague.adapter.ts:mapPlayByPlay()`).
3. **Audit trail:** Preserving the exact response structure ensures we can trace upstream API schema changes over time.
4. **Storage efficiency:** Both minified (~157 KB) and pretty (~237 KB) formats are acceptable for inspection; pretty format aids manual review.

## Implementation

- **Endpoint:** `https://live.euroleague.net/api/PlaybyPlay?gamecode={gameCode}&seasoncode={seasonCode}`
- **Data location:** Session state files directory (user provided)
  - `pao-zalgiris-pbp-raw.json` (minified)
  - `pao-zalgiris-pbp-pretty.json` (pretty-printed)
- **Game matched:** Panathinaikos AKTOR Athens vs Zalgiris Kaunas, Game Code `305`, Season `E2025`
- **Payload structure:** Top-level keys: `Live`, `TeamA`, `TeamB`, `CodeTeamA`, `CodeTeamB`, `ActualQuarter`, `FirstQuarter`, `SecondQuarter`, `ThirdQuarter`, `ForthQuarter`, `ExtraTime`
- **Total events:** 578 play-by-play events across 4 quarters

## No Follow-up Changes Required

The `EuroLeagueAdapter` `getPlayByPlay()` method already maps raw PBP events correctly. This capture is for upstream API inspection only.

---

**Tags:** #data-capture #raw-api #pbp-analysis
