import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EuroLeagueAdapter } from '../../src/adapters/euroleague/euroleague.adapter.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import { CommandRouter } from '../../src/domain/command-router.js';
import type { BoxScore, BoxScorePlayer, PlayByPlayEvent, TrackedGame } from '../../src/domain/types.js';
import type { StatsPort } from '../../src/ports/stats.port.js';
import type { GameTracker } from '../../src/domain/game-tracker.js';

// ─── Mock Factories ───────────────────────────────────────────

function makeBoxScorePlayer(overrides: Partial<BoxScorePlayer> = {}): BoxScorePlayer {
  return {
    playerName: 'CAMPAZZO, FACUNDO',
    teamCode: 'MAD',
    jerseyNumber: '7',
    minutes: '24:30',
    points: 12,
    rebounds: 4,
    assists: 5,
    steals: 2,
    turnovers: 1,
    blocks: 0,
    foulsCommitted: 2,
    foulsReceived: 3,
    pir: 15,
    plusMinus: 8,
    isStarter: true,
    isPlaying: true,
    ...overrides,
  };
}

function makeBoxScore(overrides: Partial<BoxScore> = {}): BoxScore {
  return {
    gameCode: 1,
    teams: [
      {
        teamCode: 'MAD',
        teamName: 'Real Madrid',
        coach: 'Chus Mateo',
        players: [makeBoxScorePlayer()],
      },
      {
        teamCode: 'OLY',
        teamName: 'Olympiacos',
        coach: 'Georgios Bartzokas',
        players: [makeBoxScorePlayer({
          playerName: 'VEZENKOV, SASHA',
          teamCode: 'OLY',
          jerseyNumber: '8',
          points: 10,
          rebounds: 3,
          assists: 2,
          pir: 12,
        })],
      },
    ],
    ...overrides,
  };
}

function makePbpEvent(overrides: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: 'evt-1',
    gameCode: 1,
    quarter: 1,
    clock: '8:00',
    teamCode: 'MAD',
    playerName: 'CAMPAZZO, FACUNDO',
    eventType: 'two_pointer_made',
    description: 'Campazzo 2PT',
    homeScore: 12,
    awayScore: 10,
    ...overrides,
  };
}

function makeTrackedGame(overrides: Partial<TrackedGame> = {}): TrackedGame {
  return {
    id: 'E2025-1',
    gameCode: 1,
    seasonCode: 'E2025',
    homeTeam: 'Real Madrid',
    awayTeam: 'Olympiacos',
    status: 'live',
    lastScoreHome: 45,
    lastScoreAway: 42,
    lastQuarter: 2,
    lastEventId: 'evt-123',
    trackedByChatId: 'chat1',
    createdAt: '2025-01-01T20:00:00Z',
    updatedAt: '2025-01-01T20:30:00Z',
    ...overrides,
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
    getBoxScore: vi.fn().mockResolvedValue(null),
  };
}

function createMockGameTracker(): GameTracker {
  return {
    startTracking: vi.fn(),
    stopTracking: vi.fn(),
    getTrackedGames: vi.fn().mockResolvedValue([]),
    resumeAll: vi.fn(),
    stopAll: vi.fn(),
  } as any;
}

// ─── EuroLeagueAdapter BoxScore Tests ─────────────────────────

describe('EuroLeagueAdapter - BoxScore', () => {
  let adapter: EuroLeagueAdapter;
  let logger: any;

  beforeEach(() => {
    logger = createMockLogger();
    adapter = new EuroLeagueAdapter('https://api-live.euroleague.net/v2', logger);
  });

  describe('getBoxScore - API mapping', () => {
    it('should map raw boxscore response to domain BoxScore', async () => {
      const rawResponse = {
        Live: true,
        Stats: [
          {
            Team: 'Real Madrid',
            Coach: 'Chus Mateo',
            PlayersStats: [
              {
                Player_ID: '123',
                IsStarter: 1,
                IsPlaying: 1,
                Team: 'MAD',
                Dorsal: '7',
                Player: 'CAMPAZZO, FACUNDO',
                Minutes: '24:30',
                Points: 12,
                FieldGoalsMade2: 3,
                FieldGoalsAttempted2: 5,
                FieldGoalsMade3: 2,
                FieldGoalsAttempted3: 4,
                FreeThrowsMade: 0,
                FreeThrowsAttempted: 0,
                OffensiveRebounds: 1,
                DefensiveRebounds: 3,
                TotalRebounds: 4,
                Assistances: 5,
                Steals: 2,
                Turnovers: 1,
                BlocksFavour: 0,
                BlocksAgainst: 0,
                FoulsCommited: 2,
                FoulsReceived: 3,
                Valuation: 15,
                Plusminus: 8,
              },
            ],
            tmr: {} as any,
            totr: {},
          },
          {
            Team: 'Olympiacos',
            Coach: 'Georgios Bartzokas',
            PlayersStats: [
              {
                Player_ID: '456',
                IsStarter: 1,
                IsPlaying: 1,
                Team: 'OLY',
                Dorsal: '8',
                Player: 'VEZENKOV, SASHA',
                Minutes: '22:15',
                Points: 10,
                FieldGoalsMade2: 2,
                FieldGoalsAttempted2: 3,
                FieldGoalsMade3: 2,
                FieldGoalsAttempted3: 3,
                FreeThrowsMade: 0,
                FreeThrowsAttempted: 0,
                OffensiveRebounds: 0,
                DefensiveRebounds: 3,
                TotalRebounds: 3,
                Assistances: 2,
                Steals: 1,
                Turnovers: 2,
                BlocksFavour: 0,
                BlocksAgainst: 1,
                FoulsCommited: 1,
                FoulsReceived: 2,
                Valuation: 12,
                Plusminus: -5,
              },
            ],
            tmr: {} as any,
            totr: {},
          },
        ],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => rawResponse,
      }));

      const result = await adapter.getBoxScore(1, 'E2025');

      expect(result).not.toBeNull();
      expect(result?.gameCode).toBe(1);
      expect(result?.teams).toHaveLength(2);

      // Check first team
      const madTeam = result?.teams[0];
      expect(madTeam?.teamCode).toBe('MAD');
      expect(madTeam?.teamName).toBe('Real Madrid');
      expect(madTeam?.coach).toBe('Chus Mateo');
      expect(madTeam?.players).toHaveLength(1);

      // Check player mapping
      const campazzo = madTeam?.players[0];
      expect(campazzo?.playerName).toBe('CAMPAZZO, FACUNDO');
      expect(campazzo?.teamCode).toBe('MAD');
      expect(campazzo?.jerseyNumber).toBe('7');
      expect(campazzo?.minutes).toBe('24:30');
      expect(campazzo?.points).toBe(12);
      expect(campazzo?.rebounds).toBe(4);
      expect(campazzo?.assists).toBe(5);
      expect(campazzo?.steals).toBe(2);
      expect(campazzo?.turnovers).toBe(1);
      expect(campazzo?.blocks).toBe(0);
      expect(campazzo?.foulsCommitted).toBe(2);
      expect(campazzo?.foulsReceived).toBe(3);
      expect(campazzo?.pir).toBe(15);
      expect(campazzo?.plusMinus).toBe(8);
      expect(campazzo?.isStarter).toBe(true);
      expect(campazzo?.isPlaying).toBe(true);

      vi.unstubAllGlobals();
    });

    it('should filter out DNP players', async () => {
      const rawResponse = {
        Live: false,
        Stats: [
          {
            Team: 'Real Madrid',
            Coach: 'Chus Mateo',
            PlayersStats: [
              {
                Player_ID: '123',
                IsStarter: 1,
                IsPlaying: 1,
                Team: 'MAD',
                Dorsal: '7',
                Player: 'CAMPAZZO, FACUNDO',
                Minutes: '24:30',
                Points: 12,
                TotalRebounds: 4,
                Assistances: 5,
                Steals: 2,
                Turnovers: 1,
                BlocksFavour: 0,
                FoulsCommited: 2,
                FoulsReceived: 3,
                Valuation: 15,
                Plusminus: 8,
              } as any,
              {
                Player_ID: '789',
                IsStarter: 0,
                IsPlaying: 0,
                Team: 'MAD',
                Dorsal: '99',
                Player: 'DNP PLAYER',
                Minutes: 'DNP',
                Points: 0,
                TotalRebounds: 0,
                Assistances: 0,
                Steals: 0,
                Turnovers: 0,
                BlocksFavour: 0,
                FoulsCommited: 0,
                FoulsReceived: 0,
                Valuation: 0,
                Plusminus: 0,
              } as any,
            ],
            tmr: {} as any,
            totr: {},
          },
        ],
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => rawResponse,
      }));

      const result = await adapter.getBoxScore(1, 'E2025');

      expect(result?.teams[0].players).toHaveLength(1);
      expect(result?.teams[0].players[0].playerName).toBe('CAMPAZZO, FACUNDO');

      vi.unstubAllGlobals();
    });

    it('should return null when Stats array is empty', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ Live: false, Stats: [] }),
      }));

      const result = await adapter.getBoxScore(1, 'E2025');
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should return null when API returns 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }));

      const result = await adapter.getBoxScore(1, 'E2025');
      expect(result).toBeNull();

      vi.unstubAllGlobals();
    });

    it('should return null on fetch error (graceful degradation)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await adapter.getBoxScore(999, 'E2025');
      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  describe('getBoxScore - no caching', () => {
    it('should fetch fresh boxscore data on every call', async () => {
      const rawResponse = {
        Live: true,
        Stats: [
          {
            Team: 'Real Madrid',
            Coach: 'Chus Mateo',
            PlayersStats: [
              {
                Player_ID: '123',
                Player: 'CAMPAZZO, FACUNDO',
                Team: 'MAD',
                Dorsal: '7',
                Minutes: '24:30',
                Points: 12,
                TotalRebounds: 4,
                Assistances: 5,
                Steals: 2,
                Turnovers: 1,
                BlocksFavour: 0,
                FoulsCommited: 2,
                FoulsReceived: 3,
                Valuation: 15,
                Plusminus: 8,
                IsStarter: 1,
                IsPlaying: 1,
              } as any,
            ],
            tmr: {} as any,
            totr: {},
          },
        ],
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => rawResponse,
      });
      vi.stubGlobal('fetch', fetchMock);

      await adapter.getBoxScore(1, 'E2025');
      await adapter.getBoxScore(1, 'E2025');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });
  });
});

// ─── MessageComposer PIR Tests ────────────────────────────────

describe('MessageComposer - PIR', () => {
  let composer: MessageComposer;

  beforeEach(() => {
    composer = new MessageComposer();
  });

  describe('composeRosterMatch', () => {
    it('should include PIR value when provided', () => {
      const event = makePbpEvent();
      const owners = ['Filip', 'Marko'];
      const pir = 15;

      const msg = composer.composeRosterMatch(event, owners, pir);

      expect(msg).toContain('CAMPAZZO, FACUNDO');
      expect(msg).toContain('PIR: 15'); // Escaped MarkdownV2: \(PIR: 15\)
      expect(msg).toContain('Filip, Marko');
    });

    it('should not include PIR tag when undefined', () => {
      const event = makePbpEvent();
      const owners = ['Filip'];

      const msg = composer.composeRosterMatch(event, owners);

      expect(msg).toContain('CAMPAZZO, FACUNDO');
      expect(msg).not.toContain('PIR');
      expect(msg).toContain('Filip');
    });

    it('should include PIR value of 0', () => {
      const event = makePbpEvent();
      const owners = ['Filip'];
      const pir = 0;

      const msg = composer.composeRosterMatch(event, owners, pir);

      expect(msg).toContain('PIR: 0'); // Escaped MarkdownV2
    });

    it('should handle negative PIR values', () => {
      const event = makePbpEvent();
      const owners = ['Filip'];
      const pir = -3;

      const msg = composer.composeRosterMatch(event, owners, pir);

      expect(msg).toContain('PIR:'); // Check for PIR tag
      expect(msg).toContain('-3'); // Check for negative value
    });
  });

  describe('composeBoxScore', () => {
    it('should return message when boxScore array is empty', () => {
      const msg = composer.composeBoxScore([]);

      expect(msg).toContain('No box score data available');
    });

    it('should format single game boxscore with PIR values', () => {
      const boxScore = makeBoxScore();
      const msg = composer.composeBoxScore([{ boxScore, home: 'Real Madrid', away: 'Olympiacos' }]);

      expect(msg).toContain('Player Performance Index');
      expect(msg).toContain('Real Madrid');
      expect(msg).toContain('Olympiacos');
      expect(msg).toContain('CAMPAZZO, FACUNDO');
      expect(msg).toContain('PIR:'); // Bold PIR label in MarkdownV2
      expect(msg).toContain('15'); // PIR value
      expect(msg).toContain('12pts');
      expect(msg).toContain('5ast');
      expect(msg).toContain('4reb');
      expect(msg).toContain('VEZENKOV, SASHA');
      expect(msg).toContain('12'); // PIR value for Vezenkov
    });

    it('should sort players by PIR (descending) and show top 8', () => {
      const players: BoxScorePlayer[] = [];
      for (let i = 0; i < 12; i++) {
        players.push(makeBoxScorePlayer({
          playerName: `PLAYER ${i}`,
          pir: i,
          points: i,
        }));
      }

      const boxScore: BoxScore = {
        gameCode: 1,
        teams: [
          {
            teamCode: 'MAD',
            teamName: 'Real Madrid',
            coach: 'Coach',
            players,
          },
        ],
      };

      const msg = composer.composeBoxScore([{ boxScore, home: 'Real Madrid', away: 'Olympiacos' }]);

      // Top players should be present (PIR 11, 10, 9...)
      expect(msg).toContain('PLAYER 11');
      expect(msg).toContain('PLAYER 10');
      expect(msg).toContain('PLAYER 4'); // 8th highest

      // Lower PIR players should not appear (only top 8)
      expect(msg).not.toContain('PLAYER 3');
      expect(msg).not.toContain('PLAYER 0');
    });

    it('should format multiple games', () => {
      const boxScore1 = makeBoxScore({ gameCode: 1 });
      const boxScore2 = makeBoxScore({
        gameCode: 2,
        teams: [
          {
            teamCode: 'BAR',
            teamName: 'Barcelona',
            coach: 'Roger Grimau',
            players: [makeBoxScorePlayer({ playerName: 'LAPROVITTOLA, NICOLAS', teamCode: 'BAR', pir: 20 })],
          },
        ],
      });

      const msg = composer.composeBoxScore([
        { boxScore: boxScore1, home: 'Real Madrid', away: 'Olympiacos' },
        { boxScore: boxScore2, home: 'Barcelona', away: 'Fenerbahce' },
      ]);

      expect(msg).toContain('Real Madrid');
      expect(msg).toContain('Barcelona');
      expect(msg).toContain('CAMPAZZO, FACUNDO');
      expect(msg).toContain('LAPROVITTOLA, NICOLAS');
    });

    it('should include quarter and clock info when provided', () => {
      const boxScore = makeBoxScore();
      const msg = composer.composeBoxScore([{
        boxScore,
        home: 'Real Madrid',
        away: 'Olympiacos',
        quarter: 2,
        clock: '5:32',
      }]);

      expect(msg).toContain('Q2');
      expect(msg).toContain('5:32');
    });
  });
});

// ─── CommandRouter /pir Command Tests ─────────────────────────

describe('CommandRouter - /pir command', () => {
  let router: CommandRouter;
  let stats: StatsPort;
  let gameTracker: ReturnType<typeof createMockGameTracker>;
  let messageComposer: MessageComposer;
  let logger: any;

  beforeEach(() => {
    stats = createMockStats();
    gameTracker = createMockGameTracker();
    messageComposer = new MessageComposer();
    logger = createMockLogger();

    router = new CommandRouter({
      stats,
      gameTracker,
      messageComposer,
      logger,
      throttle: { canSend: () => true } as any,
      seasonCode: 'E2025',
      competitionCode: 'E',
      startTime: Date.now(),
    });
  });

  it('should return message when no games are tracked', async () => {
    gameTracker.getTrackedGames.mockResolvedValue([]);

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No active games');
  });

  it('should return message when all tracked games are finished', async () => {
    gameTracker.getTrackedGames.mockResolvedValue([
      makeTrackedGame({ status: 'finished' }),
    ]);

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No active games');
  });

  it('should return message when boxscore data is not available', async () => {
    gameTracker.getTrackedGames.mockResolvedValue([
      makeTrackedGame({ status: 'live' }),
    ]);
    stats.getBoxScore = vi.fn().mockResolvedValue(null);

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No box score data available');
  });

  it('should return formatted boxscore when data is available', async () => {
    const game = makeTrackedGame({ status: 'live' });
    gameTracker.getTrackedGames.mockResolvedValue([game]);
    stats.getBoxScore = vi.fn().mockResolvedValue(makeBoxScore());

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(stats.getBoxScore).toHaveBeenCalledWith(1, 'E2025');
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Player Performance Index');
    expect(result!.text).toContain('CAMPAZZO, FACUNDO');
    expect(result!.text).toContain('15'); // PIR value
  });

  it('should filter by player name when args are provided', async () => {
    const game = makeTrackedGame({ status: 'live' });
    gameTracker.getTrackedGames.mockResolvedValue([game]);
    stats.getBoxScore = vi.fn().mockResolvedValue(makeBoxScore());

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: ['campazzo'],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('CAMPAZZO, FACUNDO');
    expect(result!.text).not.toContain('VEZENKOV, SASHA');
  });

  it('should return message when player filter has no matches', async () => {
    const game = makeTrackedGame({ status: 'live' });
    gameTracker.getTrackedGames.mockResolvedValue([game]);
    stats.getBoxScore = vi.fn().mockResolvedValue(makeBoxScore());

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: ['nonexistent'],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No player matching');
    expect(result!.text).toContain('nonexistent');
  });

  it('should handle multiple tracked games', async () => {
    const game1 = makeTrackedGame({ gameCode: 1, status: 'live' });
    const game2 = makeTrackedGame({ gameCode: 2, status: 'live', homeTeam: 'Barcelona', awayTeam: 'Fenerbahce' });
    gameTracker.getTrackedGames.mockResolvedValue([game1, game2]);

    const boxScore1 = makeBoxScore({ gameCode: 1 });
    const boxScore2 = makeBoxScore({
      gameCode: 2,
      teams: [
        {
          teamCode: 'BAR',
          teamName: 'Barcelona',
          coach: 'Roger Grimau',
          players: [makeBoxScorePlayer({ playerName: 'LAPROVITTOLA, NICOLAS', teamCode: 'BAR', pir: 20 })],
        },
      ],
    });

    stats.getBoxScore = vi.fn()
      .mockResolvedValueOnce(boxScore1)
      .mockResolvedValueOnce(boxScore2);

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(stats.getBoxScore).toHaveBeenCalledTimes(2);
    expect(result).not.toBeNull();
    expect(result!.text).toContain('CAMPAZZO, FACUNDO');
    expect(result!.text).toContain('LAPROVITTOLA, NICOLAS');
  });

  it('should gracefully handle boxscore fetch errors', async () => {
    const game = makeTrackedGame({ status: 'live' });
    gameTracker.getTrackedGames.mockResolvedValue([game]);
    stats.getBoxScore = vi.fn().mockRejectedValue(new Error('API error'));

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No box score data available');
  });

  it('should only process active games (skip finished ones)', async () => {
    const game1 = makeTrackedGame({ gameCode: 1, status: 'live' });
    const game2 = makeTrackedGame({ gameCode: 2, status: 'finished' });
    gameTracker.getTrackedGames.mockResolvedValue([game1, game2]);
    stats.getBoxScore = vi.fn().mockResolvedValue(makeBoxScore());

    await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    // Should only call getBoxScore for the live game
    expect(stats.getBoxScore).toHaveBeenCalledTimes(1);
    expect(stats.getBoxScore).toHaveBeenCalledWith(1, 'E2025');
  });
});

// ─── Graceful Degradation Tests ───────────────────────────────

describe('PIR Feature - Graceful Degradation', () => {
  it('should not throw when boxscore API is unavailable', async () => {
    const logger = createMockLogger();
    const adapter = new EuroLeagueAdapter('https://api-live.euroleague.net/v2', logger);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Service unavailable')));

    const result = await adapter.getBoxScore(1, 'E2025');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('MessageComposer should work without PIR values', () => {
    const composer = new MessageComposer();
    const event = makePbpEvent();
    const owners = ['Filip'];

    const msg = composer.composeRosterMatch(event, owners);

    expect(msg).toBeTruthy();
    expect(msg).toContain('CAMPAZZO, FACUNDO');
    expect(msg).toContain('Filip');
    expect(msg).not.toContain('PIR');
  });

  it('/pir command should show fallback when no data available', async () => {
    const stats = createMockStats();
    const gameTracker = createMockGameTracker();
    const messageComposer = new MessageComposer();
    const logger = createMockLogger();

    const router = new CommandRouter({
      stats,
      gameTracker,
      messageComposer,
      logger,
      throttle: { canSend: () => true } as any,
      seasonCode: 'E2025',
      competitionCode: 'E',
      startTime: Date.now(),
    });

    gameTracker.getTrackedGames.mockResolvedValue([makeTrackedGame({ status: 'live' })]);
    stats.getBoxScore = vi.fn().mockResolvedValue(null);

    const result = await router.handle({
      chatId: 'chat1',
      command: 'pir',
      args: [],
      senderName: 'Filip',
    });

    expect(result).not.toBeNull();
    expect(result!.text).toContain('No box score data available');
  });
});
