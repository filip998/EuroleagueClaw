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
    getCurrentRoundGames: vi.fn().mockResolvedValue({ roundNumber: 1, roundName: 'Round 1', games: [] }),
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

  describe('big run detection', () => {
    const liveGame: TrackedGame = {
      id: 'E2025-1',
      gameCode: 1,
      seasonCode: 'E2025',
      homeTeam: 'Real Madrid',
      awayTeam: 'Olympiacos',
      status: 'live',
      lastScoreHome: 0,
      lastScoreAway: 0,
      lastQuarter: 1,
      lastEventId: null,
      trackedByChatId: 'chat1',
      createdAt: '',
      updatedAt: '',
    };

    it('should emit big_run when a team scores 8+ unanswered points', () => {
      // Simulate consecutive home scoring: 3 + 3 + 2 = 8 unanswered
      let game = { ...liveGame, lastScoreHome: 0, lastScoreAway: 0 };
      tracker.detectEvents(game, { gameCode: 1, homeScore: 3, awayScore: 0, quarter: 1, clock: '9:00', status: 'live' });

      game = { ...game, lastScoreHome: 3, lastScoreAway: 0 };
      tracker.detectEvents(game, { gameCode: 1, homeScore: 6, awayScore: 0, quarter: 1, clock: '8:00', status: 'live' });

      game = { ...game, lastScoreHome: 6, lastScoreAway: 0 };
      const evts = tracker.detectEvents(game, { gameCode: 1, homeScore: 8, awayScore: 0, quarter: 1, clock: '7:00', status: 'live' });

      const bigRun = evts.find((e) => e.type === 'big_run');
      expect(bigRun).toBeDefined();
      if (bigRun?.type === 'big_run') {
        expect(bigRun.teamCode).toBe('home');
        expect(bigRun.run).toBe('8-0');
      }
    });

    it('should reset the run when the opponent scores', () => {
      let game = { ...liveGame, lastScoreHome: 0, lastScoreAway: 0 };
      tracker.detectEvents(game, { gameCode: 1, homeScore: 5, awayScore: 0, quarter: 1, clock: '9:00', status: 'live' });

      // Opponent scores, resetting the run
      game = { ...game, lastScoreHome: 5, lastScoreAway: 0 };
      tracker.detectEvents(game, { gameCode: 1, homeScore: 5, awayScore: 2, quarter: 1, clock: '8:30', status: 'live' });

      // Home continues scoring but not enough for big run
      game = { ...game, lastScoreHome: 5, lastScoreAway: 2 };
      const evts = tracker.detectEvents(game, { gameCode: 1, homeScore: 10, awayScore: 2, quarter: 1, clock: '7:00', status: 'live' });

      const bigRun = evts.find((e) => e.type === 'big_run');
      expect(bigRun).toBeUndefined();
    });

    it('should not emit big_run for small runs under 8 points', () => {
      let game = { ...liveGame, lastScoreHome: 10, lastScoreAway: 10 };
      tracker.detectEvents(game, { gameCode: 1, homeScore: 13, awayScore: 10, quarter: 1, clock: '6:00', status: 'live' });

      game = { ...game, lastScoreHome: 13, lastScoreAway: 10 };
      const evts = tracker.detectEvents(game, { gameCode: 1, homeScore: 15, awayScore: 10, quarter: 1, clock: '5:00', status: 'live' });

      const bigRun = evts.find((e) => e.type === 'big_run');
      expect(bigRun).toBeUndefined();
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

  describe('PBP polling — live-only guard', () => {
    let pbpCallback: ReturnType<typeof vi.fn>;
    let trackerWithPbp: GameTracker;

    beforeEach(() => {
      pbpCallback = vi.fn().mockResolvedValue(undefined);
      trackerWithPbp = new GameTracker(
        stats, storage, logger, 15000,
        async (chatId, event) => { events.push({ chatId, event }); },
        pbpCallback,
      );
    });

    it('should call getPlayByPlay when live score status is live', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });
      (stats.getPlayByPlay as any).mockResolvedValue([{
        eventId: '10', gameCode: 1, quarter: 1, clock: '9:30',
        teamCode: 'RMA', playerName: 'Hezonja', eventType: 'two_pointer_made',
        description: '2pt', homeScore: 2, awayScore: 0,
      }]);

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      expect(stats.getPlayByPlay).toHaveBeenCalledWith(1, 'E2025', null);
    });

    it.each(['scheduled', 'finished', 'postponed'] as const)(
      'should NOT call getPlayByPlay when live score status is %s',
      async (status) => {
        (stats.getLiveScore as any).mockResolvedValue({
          gameCode: 1, homeScore: 0, awayScore: 0, quarter: 0, clock: '', status,
        });

        await trackerWithPbp.startTracking('chat1', 1, 'E2025');
        await vi.advanceTimersByTimeAsync(0);

        expect(stats.getPlayByPlay).not.toHaveBeenCalled();
      },
    );

    it('should NOT call getPlayByPlay when onPlayByPlay callback is absent', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });

      // Use the outer `tracker` — created without onPlayByPlay
      await tracker.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      expect(stats.getPlayByPlay).not.toHaveBeenCalled();
    });

    it('should dispatch PBP events via onPlayByPlay callback', async () => {
      const pbpEvent = {
        eventId: '10', gameCode: 1, quarter: 1, clock: '9:30',
        teamCode: 'RMA', playerName: 'Hezonja', eventType: 'two_pointer_made',
        description: '2pt', homeScore: 2, awayScore: 0,
      };
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });
      (stats.getPlayByPlay as any).mockResolvedValue([pbpEvent]);

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      expect(pbpCallback).toHaveBeenCalledWith('chat1', [pbpEvent]);
    });

    it('should update lastEventId to the last PBP event ID', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 5, awayScore: 0, quarter: 1, clock: '9:00', status: 'live',
      });
      (stats.getPlayByPlay as any).mockResolvedValue([
        { eventId: '5', gameCode: 1, quarter: 1, clock: '9:50', teamCode: 'RMA', playerName: 'A', eventType: 'two_pointer_made', description: '', homeScore: 2, awayScore: 0 },
        { eventId: '10', gameCode: 1, quarter: 1, clock: '9:30', teamCode: 'RMA', playerName: 'B', eventType: 'three_pointer_made', description: '', homeScore: 5, awayScore: 0 },
      ]);

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      expect(storage.updateTrackedGame).toHaveBeenCalledWith(
        'E2025-1',
        expect.objectContaining({ lastEventId: '10' }),
      );
    });

    it('should not dispatch or update lastEventId when PBP returns empty', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });
      (stats.getPlayByPlay as any).mockResolvedValue([]);

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      expect(pbpCallback).not.toHaveBeenCalled();
      const calls = (storage.updateTrackedGame as any).mock.calls;
      const lastEventIdUpdates = calls.filter(
        ([, updates]: [string, Record<string, unknown>]) => 'lastEventId' in updates,
      );
      expect(lastEventIdUpdates).toHaveLength(0);
    });

    it('should handle PBP fetch failure without disrupting game events', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });
      (stats.getPlayByPlay as any).mockRejectedValue(new Error('PBP API down'));

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      // Game events still emitted (game_start + quarter_start)
      expect(events.length).toBeGreaterThan(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ gameId: 'E2025-1' }),
        'PBP poll failed',
      );
    });

    it('should pass stored lastEventId on subsequent polls', async () => {
      (stats.getLiveScore as any).mockResolvedValue({
        gameCode: 1, homeScore: 2, awayScore: 0, quarter: 1, clock: '9:30', status: 'live',
      });
      (stats.getPlayByPlay as any)
        .mockResolvedValueOnce([{
          eventId: '10', gameCode: 1, quarter: 1, clock: '9:30',
          teamCode: 'RMA', playerName: 'X', eventType: 'two_pointer_made',
          description: '', homeScore: 2, awayScore: 0,
        }])
        .mockResolvedValueOnce([]);

      await trackerWithPbp.startTracking('chat1', 1, 'E2025');
      await vi.advanceTimersByTimeAsync(0);

      // First poll passes null (no prior lastEventId)
      expect(stats.getPlayByPlay).toHaveBeenCalledWith(1, 'E2025', null);

      // Trigger second poll via interval
      await vi.advanceTimersByTimeAsync(15000);

      // Second poll passes '10' (persisted from first poll)
      expect(stats.getPlayByPlay).toHaveBeenCalledWith(1, 'E2025', '10');
    });
  });
});
