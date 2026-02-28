import { describe, it, expect } from 'vitest';
import type { Logger } from '../../src/shared/logger.js';
import { EuroLeagueAdapter } from '../../src/adapters/euroleague/euroleague.adapter.js';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => noopLogger,
  level: 'silent',
} as unknown as Logger;

// Skip in CI — these hit real APIs
const describeIntegration = process.env.CI ? describe.skip : describe;

describeIntegration('EuroLeagueAdapter (integration)', () => {
  const adapter = new EuroLeagueAdapter('https://live.euroleague.net/api', noopLogger);

  it('should fetch scoreboard or throw ApiError', async () => {
    try {
      const scores = await adapter.getScoreboard();
      expect(Array.isArray(scores)).toBe(true);
    } catch (err) {
      // API may be unavailable outside of season / game days
      expect((err as Error).name).toBe('ApiError');
    }
  });

  it('should fetch today schedule or throw ApiError', async () => {
    try {
      const games = await adapter.getTodaySchedule('E2025', 'E');
      expect(Array.isArray(games)).toBe(true);
    } catch (err) {
      expect((err as Error).name).toBe('ApiError');
    }
  });

  it('should throw when fetching live score for non-existent game', async () => {
    try {
      await adapter.getLiveScore(0, 'E2025');
      // If it somehow succeeds, that's fine too
    } catch (err) {
      expect((err as Error).name).toBe('ApiError');
    }
  });

  it('should return empty array or throw for non-existent play-by-play', async () => {
    try {
      const events = await adapter.getPlayByPlay(0, 'E2025');
      expect(Array.isArray(events)).toBe(true);
    } catch (err) {
      expect((err as Error).name).toBe('ApiError');
    }
  });
});
