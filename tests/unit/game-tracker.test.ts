import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GameTracker } from '../../src/domain/game-tracker.js';
import type { StatsPort } from '../../src/ports/stats.port.js';
import type { StoragePort } from '../../src/ports/storage.port.js';
import type { GameEvent, TrackedGame, LiveScore } from '../../src/domain/types.js';

function createMockStats(): StatsPort {
  return {
    getTodaySchedule: vi.fn().mockResolvedValue([]),
    getLiveScore: vi.fn().mockResolvedValue({
      gameCode: 1,
      homeScore: 0,
      awayScore: 0,
      quarter: 0,
      clock: '',
      status: 'scheduled',
    }),
    getPlayByPlay: vi.fn().mockResolvedValue([]),
    getScoreboard: vi.fn().mockResolvedValue([]),
  };
}

function createMockStorage(): StoragePort {
  const games = new Map<string, TrackedGame>();
  return {
    addTrackedGame: vi.fn(async (game) => {
      const now = new Date().toISOString();
      games.set(game.id, { ...game, createdAt: now, updatedAt: now });
    }),
    removeTrackedGame: vi.fn(async (id) => { games.delete(id); }),
    getTrackedGame: vi.fn(async (id) => games.get(id) ?? null),
    getTrackedGamesByChat: vi.fn(async (chatId) =>
      Array.from(games.values()).filter((g) => g.trackedByChatId === chatId),
    ),
    getAllTrackedGames: vi.fn(async () => Array.from(games.values())),
    updateTrackedGame: vi.fn(async (id, updates) => {
      const game = games.get(id);
      if (game) games.set(id, { ...game, ...updates, updatedAt: new Date().toISOString() });
    }),
    getOrCreateSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    hasEventBeenSent: vi.fn().mockResolvedValue(false),
    markEventSent: vi.fn(),
    getRandomTrivia: vi.fn().mockResolvedValue(null),
    initialize: vi.fn(),
    close: vi.fn(),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
    fatal: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
    level: 'info',
  } as any;
}

describe('GameTracker', () => {
  let stats: StatsPort;
  let storage: StoragePort;
  let logger: any;
  let events: Array<{ chatId: string; event: GameEvent }>;
  let tracker: GameTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    stats = createMockStats();
    storage = createMockStorage();
    logger = createMockLogger();
    events = [];
    tracker = new GameTracker(stats, storage, logger, 15000, async (chatId, event) => {
      events.push({ chatId, event });
    });
  });

  describe('detectEvents', () => {
    const baseGame: TrackedGame = {
      id: 'E2025-1',
      gameCode: 1,
      seasonCode: 'E2025',
      homeTeam: 'Real Madrid',
      awayTeam: 'Olympiacos',
      status: 'scheduled',
      lastScoreHome: 0,
      lastScoreAway: 0,
      lastQuarter: 0,
      lastEventId: null,
      trackedByChatId: 'chat1',
      createdAt: '',
      updatedAt: '',
    };

    it('should detect game start', () => {
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 0, awayScore: 0, quarter: 1, clock: '10:00', status: 'live',
      };
      const evts = tracker.detectEvents(baseGame, liveScore);
      expect(evts).toHaveLength(2); // game_start + quarter_start
      expect(evts[0]!.type).toBe('game_start');
      expect(evts[1]!.type).toBe('quarter_start');
    });

    it('should detect score change', () => {
      const game: TrackedGame = { ...baseGame, status: 'live', lastQuarter: 1, lastScoreHome: 10, lastScoreAway: 8 };
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 13, awayScore: 8, quarter: 1, clock: '5:00', status: 'live',
      };
      const evts = tracker.detectEvents(game, liveScore);
      expect(evts).toHaveLength(1);
      expect(evts[0]!.type).toBe('score_change');
      if (evts[0]!.type === 'score_change') {
        expect(evts[0]!.points).toBe(3);
        expect(evts[0]!.scoringTeamCode).toBe('home');
      }
    });

    it('should detect quarter transition', () => {
      const game: TrackedGame = { ...baseGame, status: 'live', lastQuarter: 1, lastScoreHome: 22, lastScoreAway: 18 };
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 22, awayScore: 18, quarter: 2, clock: '10:00', status: 'live',
      };
      const evts = tracker.detectEvents(game, liveScore);
      expect(evts.some((e) => e.type === 'quarter_end')).toBe(true);
      expect(evts.some((e) => e.type === 'quarter_start')).toBe(true);
    });

    it('should detect lead change', () => {
      const game: TrackedGame = { ...baseGame, status: 'live', lastQuarter: 3, lastScoreHome: 50, lastScoreAway: 48 };
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 50, awayScore: 52, quarter: 3, clock: '3:00', status: 'live',
      };
      const evts = tracker.detectEvents(game, liveScore);
      const leadChange = evts.find((e) => e.type === 'lead_change');
      expect(leadChange).toBeDefined();
      if (leadChange?.type === 'lead_change') {
        expect(leadChange.leadingTeamCode).toBe('away');
        expect(leadChange.leadMargin).toBe(2);
      }
    });

    it('should detect game end', () => {
      const game: TrackedGame = { ...baseGame, status: 'live', lastQuarter: 4, lastScoreHome: 85, lastScoreAway: 78 };
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 89, awayScore: 78, quarter: 4, clock: '0:00', status: 'finished',
      };
      const evts = tracker.detectEvents(game, liveScore);
      const gameEnd = evts.find((e) => e.type === 'game_end');
      expect(gameEnd).toBeDefined();
      if (gameEnd?.type === 'game_end') {
        expect(gameEnd.homeScore).toBe(89);
        expect(gameEnd.awayScore).toBe(78);
        expect(gameEnd.winnerCode).toBe('home');
      }
    });

    it('should return no events when nothing changes', () => {
      const game: TrackedGame = { ...baseGame, status: 'live', lastQuarter: 2, lastScoreHome: 30, lastScoreAway: 28 };
      const liveScore: LiveScore = {
        gameCode: 1, homeScore: 30, awayScore: 28, quarter: 2, clock: '4:00', status: 'live',
      };
      const evts = tracker.detectEvents(game, liveScore);
      expect(evts).toHaveLength(0);
    });
  });

  describe('startTracking', () => {
    it('should add a game to storage and start polling', async () => {
      const game = await tracker.startTracking('chat1', 123, 'E2025');
      expect(game.gameCode).toBe(123);
      expect(game.trackedByChatId).toBe('chat1');
      expect(storage.addTrackedGame).toHaveBeenCalled();
    });
  });

  describe('stopTracking', () => {
    it('should remove a tracked game', async () => {
      await tracker.startTracking('chat1', 123, 'E2025');
      const stopped = await tracker.stopTracking('chat1', 123, 'E2025');
      expect(stopped).toBe(true);
      expect(storage.removeTrackedGame).toHaveBeenCalledWith('E2025-123');
    });

    it('should return false for non-tracked game', async () => {
      const stopped = await tracker.stopTracking('chat1', 999, 'E2025');
      expect(stopped).toBe(false);
    });
  });
});
