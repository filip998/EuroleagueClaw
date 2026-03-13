# PBP API Investigation Session — 2026-03-13

**Scope:** Parallel agent investigation into EuroLeague PlayByPlay API limitations and optimization strategies  
**Agents:** Nikola (Data/Integrations), Bogdan (Lead)  
**Inputs:** euroleague.adapter.ts, game-tracker.ts, pao-zalgiris-pbp-raw-opus.json  
**Time:** 2026-03-13T14:33:47Z

## Session Summary

Two-pronged investigation:

1. **Nikola (agent-16)** — Probe API for incremental fetching support
2. **Bogdan (agent-17)** — Evaluate product-level alternatives to reduce PBP traffic

Both agents completed successfully with critical findings.

## Findings

### API Capabilities (Nikola)

✅ **Gzip compression active** (10.7 KB wire → 157 KB payload)  
❌ **No incremental support** (tested: query params, conditional headers, /Period endpoint)  
🔍 **Lightweight alternatives discovered:** `/api/Header` (475B) and `/api/Points` (4.5KB)

### Product Optimization (Bogdan)

**PBP only used for: Roster matching**

Other features use `getLiveScore()`:
- Score detection
- Quarter transitions  
- Lead changes
- Big runs

**Quick wins (no API changes needed):**
1. Skip PBP fetch when rosters not loaded (saves 154 KB per poll)
2. Reduce poll frequency to 30–45s (roster notifications are less time-critical)

**Combined impact:** 90%+ traffic reduction

## Key Insight

The current implementation fetches full PBP data every 15 seconds even when no rosters are loaded — pure waste. Gating PBP polling on roster presence + reducing frequency are the fastest paths to optimization.

## Recommendations for Next Phase

1. **Immediate action:** Implement roster presence check before PBP poll
2. **Quick follow-up:** Reduce PBP poll interval from 15s to 30s
3. **Future optimization:** If Header/Points endpoints exist, use for lightweight preliminary checks

## Files

- Nikola findings: `.squad/decisions/inbox/nikola-pbp-api-investigation.md`
- Bogdan findings: `.squad/decisions/inbox/bogdan-pbp-alternatives.md`
- Raw PBP sample: PAO vs Zalgiris (E2025, game 305) in session-state/

---

**Decision Status:** Awaiting merge into decisions.md and implementation by Strahinja.
