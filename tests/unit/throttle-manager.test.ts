import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThrottleManager } from '../../src/domain/throttle-manager.js';
import type { GameEvent } from '../../src/domain/types.js';

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as any;
}

describe('ThrottleManager', () => {
  let throttle: ThrottleManager;

  beforeEach(() => {
    vi.useFakeTimers();
    throttle = new ThrottleManager(
      { windowSeconds: 120, maxMessagesPerMinute: 5 },
      createMockLogger(),
    );
  });

  describe('shouldSend', () => {
    it('should always allow critical events', () => {
      const event: GameEvent = {
        type: 'game_end', gameCode: 1, homeScore: 89, awayScore: 78, winnerCode: 'home',
      };
      expect(throttle.shouldSend('chat1', event)).toBe(true);
    });

    it('should allow normal events under rate limit', () => {
      const event: GameEvent = {
        type: 'score_change', gameCode: 1, homeScore: 10, awayScore: 8,
        quarter: 1, clock: '5:00', scoringTeamCode: 'home', playerName: '', points: 2,
        description: 'scores',
      };
      expect(throttle.shouldSend('chat1', event)).toBe(true);
    });

    it('should throttle when rate limit exceeded', () => {
      const event: GameEvent = {
        type: 'score_change', gameCode: 1, homeScore: 10, awayScore: 8,
        quarter: 1, clock: '5:00', scoringTeamCode: 'home', playerName: '', points: 2,
        description: 'scores',
      };
      // Send 5 messages to hit the limit
      for (let i = 0; i < 5; i++) {
        throttle.recordSent('chat1');
      }
      expect(throttle.shouldSend('chat1', event)).toBe(false);
    });

    it('should still allow critical events when rate limited', () => {
      for (let i = 0; i < 10; i++) {
        throttle.recordSent('chat1');
      }
      const event: GameEvent = {
        type: 'game_start', gameCode: 1,
        homeTeam: { code: '', name: 'A', shortName: 'A' },
        awayTeam: { code: '', name: 'B', shortName: 'B' },
      };
      expect(throttle.shouldSend('chat1', event)).toBe(true);
    });
  });

  describe('mute/unmute', () => {
    it('should mute a chat', () => {
      throttle.mute('chat1', 30);
      expect(throttle.isMuted('chat1')).toBe(true);
    });

    it('should unmute a chat', () => {
      throttle.mute('chat1', 30);
      throttle.unmute('chat1');
      expect(throttle.isMuted('chat1')).toBe(false);
    });

    it('should auto-unmute after duration', () => {
      throttle.mute('chat1', 30);
      expect(throttle.isMuted('chat1')).toBe(true);

      vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
      expect(throttle.isMuted('chat1')).toBe(false);
    });

    it('should queue non-critical events when muted', () => {
      throttle.mute('chat1', 30);
      const event: GameEvent = {
        type: 'score_change', gameCode: 1, homeScore: 10, awayScore: 8,
        quarter: 1, clock: '5:00', scoringTeamCode: 'home', playerName: '', points: 2,
        description: 'scores',
      };
      expect(throttle.shouldSend('chat1', event)).toBe(false);

      const queued = throttle.drainQueue('chat1');
      expect(queued).toHaveLength(1);
    });

    it('should still allow critical events when muted', () => {
      throttle.mute('chat1', 30);
      const event: GameEvent = {
        type: 'game_end', gameCode: 1, homeScore: 89, awayScore: 78, winnerCode: 'home',
      };
      expect(throttle.shouldSend('chat1', event)).toBe(true);
    });
  });

  describe('drainQueue', () => {
    it('should return and clear queued events', () => {
      throttle.mute('chat1', 30);
      const event: GameEvent = {
        type: 'score_change', gameCode: 1, homeScore: 10, awayScore: 8,
        quarter: 1, clock: '5:00', scoringTeamCode: 'home', playerName: '', points: 2,
        description: 'scores',
      };
      throttle.shouldSend('chat1', event);
      throttle.shouldSend('chat1', event);

      const first = throttle.drainQueue('chat1');
      expect(first).toHaveLength(2);

      const second = throttle.drainQueue('chat1');
      expect(second).toHaveLength(0);
    });
  });
});
