import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';

describe('loadConfig — EuroLeague poll interval', () => {
  const baseEnv = { TELEGRAM_BOT_TOKEN: 'test-token' };

  it('should default pollIntervalMs to 10000', () => {
    const config = loadConfig(baseEnv);
    expect(config.euroleague.pollIntervalMs).toBe(10000);
  });

  it('should accept a custom pollIntervalMs', () => {
    const config = loadConfig({ ...baseEnv, EUROLEAGUE_POLL_INTERVAL_MS: '5000' });
    expect(config.euroleague.pollIntervalMs).toBe(5000);
  });

  it('should accept pollIntervalMs at the minimum boundary (5000)', () => {
    const config = loadConfig({ ...baseEnv, EUROLEAGUE_POLL_INTERVAL_MS: '5000' });
    expect(config.euroleague.pollIntervalMs).toBe(5000);
  });

  it('should reject pollIntervalMs below 5000', () => {
    expect(() =>
      loadConfig({ ...baseEnv, EUROLEAGUE_POLL_INTERVAL_MS: '4999' }),
    ).toThrow();
  });
});
