import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../../src/domain/command-router.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import { ThrottleManager } from '../../src/domain/throttle-manager.js';
import { RosterTracker } from '../../src/domain/roster-tracker.js';
import type { StatsPort } from '../../src/ports/stats.port.js';
import type { FantasyPort } from '../../src/ports/fantasy.port.js';
import type { GameTracker } from '../../src/domain/game-tracker.js';
import type { IncomingCommand, RosterFetchResult } from '../../src/domain/types.js';

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

function createMockStats(): StatsPort {
  return {
    getTodaySchedule: vi.fn().mockResolvedValue([
      {
        gameCode: 1,
        seasonCode: 'E2025',
        homeTeam: { code: 'MAD', name: 'Real Madrid', shortName: 'Madrid' },
        awayTeam: { code: 'OLY', name: 'Olympiacos', shortName: 'Olympiacos' },
        status: 'scheduled',
        startTime: '2025-03-01T20:00:00Z',
      },
    ]),
    getLiveScore: vi.fn(),
    getPlayByPlay: vi.fn(),
    getScoreboard: vi.fn(),
    getCurrentRoundGames: vi.fn().mockResolvedValue({
      roundNumber: 30,
      roundName: 'Round 30',
      games: [
        {
          gameCode: 1,
          homeTeam: { code: 'MAD', name: 'Real Madrid', shortName: 'Madrid' },
          awayTeam: { code: 'OLY', name: 'Olympiacos', shortName: 'Olympiacos' },
          status: 'finished',
          startTime: '2025-03-01T20:00:00Z',
          homeScore: 89,
          awayScore: 78,
        },
      ],
    }),
  };
}

function createMockGameTracker(): GameTracker {
  return {
    startTracking: vi.fn().mockResolvedValue({
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
    }),
    stopTracking: vi.fn().mockResolvedValue(true),
    getTrackedGames: vi.fn().mockResolvedValue([]),
    resumeAll: vi.fn(),
    stopAll: vi.fn(),
  } as any;
}

describe('CommandRouter', () => {
  let router: CommandRouter;
  let stats: StatsPort;
  let gameTracker: ReturnType<typeof createMockGameTracker>;

  beforeEach(() => {
    stats = createMockStats();
    gameTracker = createMockGameTracker();
    const logger = createMockLogger();
    const composer = new MessageComposer();
    const throttle = new ThrottleManager({ windowSeconds: 120, maxMessagesPerMinute: 5 }, logger);

    router = new CommandRouter({
      gameTracker,
      messageComposer: composer,
      stats,
      throttle,
      logger,
      seasonCode: 'E2025',
      competitionCode: 'E',
      startTime: Date.now(),
    });
  });

  const makeCmd = (command: string, args: string[] = []): IncomingCommand => ({
    chatId: 'chat1',
    command,
    args,
    senderName: 'TestUser',
  });

  it('should handle /help', async () => {
    const result = await router.handle(makeCmd('help'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('/help');
    expect(result!.text).toContain('/today');
  });

  it('should handle /today', async () => {
    const result = await router.handle(makeCmd('today'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Real Madrid vs Olympiacos');
  });

  it('should handle /game with code', async () => {
    const result = await router.handle(makeCmd('game', ['1']));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Now tracking');
    expect(gameTracker.startTracking).toHaveBeenCalledWith('chat1', 1, 'E2025');
  });

  it('should handle /game without code', async () => {
    const result = await router.handle(makeCmd('game'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Usage');
  });

  it('should handle /stop', async () => {
    const result = await router.handle(makeCmd('stop', ['1']));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Stopped tracking');
  });

  it('should handle /games', async () => {
    const result = await router.handle(makeCmd('games'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Round 30');
    expect(result!.text).toContain('*Madrid*');
  });

  it('should enrich /games with TV channel info', async () => {
    const mockTvSchedule = {
      getEuroLeagueSchedule: vi.fn().mockResolvedValue([
        { channelName: 'Arena Premium 1', channelShort: 'ASP1', date: '2025-03-06', time: '20:00', title: 'Evroliga: Madrid - Olympiacos', isLive: true },
      ]),
    };

    (stats.getCurrentRoundGames as any).mockResolvedValue({
      roundNumber: 30,
      roundName: 'Round 30',
      games: [
        {
          gameCode: 1,
          homeTeam: { code: 'MAD', name: 'Real Madrid', shortName: 'Madrid' },
          awayTeam: { code: 'OLY', name: 'Olympiacos', shortName: 'Olympiacos' },
          status: 'scheduled',
          startTime: '2025-03-06T19:00:00Z',
          homeScore: 0,
          awayScore: 0,
        },
      ],
    });

    const routerWithTv = new CommandRouter({
      gameTracker,
      messageComposer: new MessageComposer(),
      stats,
      throttle: new ThrottleManager({ windowSeconds: 120, maxMessagesPerMinute: 5 }, createMockLogger()),
      logger: createMockLogger(),
      seasonCode: 'E2025',
      competitionCode: 'E',
      startTime: Date.now(),
      tvSchedule: mockTvSchedule,
    });

    const result = await routerWithTv.handle(makeCmd('games'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('📺');
    expect(result!.text).toContain('ASP1');
  });

  it('should handle /status', async () => {
    const result = await router.handle(makeCmd('status'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('Uptime');
  });

  it('should handle /mute', async () => {
    const result = await router.handle(makeCmd('mute', ['30']));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('muted');
  });

  it('should handle /unmute', async () => {
    const result = await router.handle(makeCmd('unmute'));
    expect(result).not.toBeNull();
    expect(result!.text).toContain('resumed');
  });

  it('should return null for unknown commands', async () => {
    const result = await router.handle(makeCmd('unknown'));
    expect(result).toBeNull();
  });
});

// ─── /roster live fetch tests ─────────────────────────────

function createMockFantasyPort(): FantasyPort {
  return {
    getStandings: vi.fn(),
    getCurrentRound: vi.fn(),
    getRosters: vi.fn(),
  };
}

function makeRosterFetchResult(overrides: Partial<RosterFetchResult> = {}): RosterFetchResult {
  return {
    matchdayNumber: 28,
    rosters: [
      {
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', isCaptain: false, isOnFire: false, isHome: true },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD', isCaptain: true, isOnFire: false, isHome: true },
        ],
      },
      {
        ownerName: 'Marko',
        players: [
          { playerName: 'VEZENKOV, SASHA', teamCode: 'OLY', isCaptain: false, isOnFire: true, isHome: false },
        ],
      },
    ],
    ...overrides,
  };
}

describe('CommandRouter — /roster live fetch', () => {
  const makeCmd = (command: string, args: string[] = []): IncomingCommand => ({
    chatId: 'chat1',
    command,
    args,
    senderName: 'TestUser',
  });

  function buildRouter(overrides: {
    fantasyPort?: FantasyPort;
    fantasyTeamIds?: string[];
    rosterTracker?: RosterTracker;
  } = {}) {
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    } as any;

    return new CommandRouter({
      gameTracker: {
        startTracking: vi.fn(),
        stopTracking: vi.fn(),
        getTrackedGames: vi.fn().mockResolvedValue([]),
        resumeAll: vi.fn(),
        stopAll: vi.fn(),
      } as any,
      messageComposer: new MessageComposer(),
      stats: {
        getTodaySchedule: vi.fn().mockResolvedValue([]),
        getLiveScore: vi.fn(),
        getPlayByPlay: vi.fn(),
        getScoreboard: vi.fn(),
        getCurrentRoundGames: vi.fn().mockResolvedValue({ roundNumber: 1, roundName: 'R1', games: [] }),
      },
      throttle: new ThrottleManager({ windowSeconds: 120, maxMessagesPerMinute: 5 }, logger),
      logger,
      seasonCode: 'E2025',
      competitionCode: 'E',
      startTime: Date.now(),
      rosterTracker: overrides.rosterTracker ?? new RosterTracker(),
      fantasyPort: overrides.fantasyPort,
      fantasyTeamIds: overrides.fantasyTeamIds,
    });
  }

  it('should fetch live rosters and return formatted overview', async () => {
    const fantasyPort = createMockFantasyPort();
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockResolvedValue(makeRosterFetchResult());

    const router = buildRouter({
      fantasyPort,
      fantasyTeamIds: ['team-1', 'team-2'],
    });

    const result = await router.handle(makeCmd('roster'));

    expect(result).not.toBeNull();
    expect(fantasyPort.getRosters).toHaveBeenCalledWith(['team-1', 'team-2']);
    expect(result!.text).toContain('Fantasy Rosters');
    expect(result!.text).toContain('Matchday 28');
    expect(result!.text).toContain('Filip');
    expect(result!.text).toContain('Marko');
    expect(result!.parseMode).toBe('MarkdownV2');
  });

  it('should return not-configured message when fantasyPort is absent', async () => {
    const router = buildRouter({
      fantasyPort: undefined,
      fantasyTeamIds: undefined,
    });

    const result = await router.handle(makeCmd('roster'));

    expect(result).not.toBeNull();
    expect(result!.text).toMatch(/not configured|no fantasy/i);
  });

  it('should return no-rosters message when API returns empty rosters', async () => {
    const fantasyPort = createMockFantasyPort();
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeRosterFetchResult({ rosters: [], matchdayNumber: 28 }),
    );

    const router = buildRouter({
      fantasyPort,
      fantasyTeamIds: ['team-1'],
    });

    const result = await router.handle(makeCmd('roster'));

    expect(result).not.toBeNull();
    expect(fantasyPort.getRosters).toHaveBeenCalled();
    expect(result!.text).toMatch(/no.*roster/i);
  });

  it('should handle API errors gracefully and fall back to cached data', async () => {
    const fantasyPort = createMockFantasyPort();
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Dunkest API 503: Service Unavailable'),
    );

    const rosterTracker = new RosterTracker();
    const router = buildRouter({
      fantasyPort,
      fantasyTeamIds: ['team-1'],
      rosterTracker,
    });

    const result = await router.handle(makeCmd('roster'));

    expect(result).not.toBeNull();
    // API error is caught gracefully — no crash, returns fallback message
    expect(result!.text).toMatch(/no.*roster/i);
  });

  it('should use cached roster data when API fails but rosters were previously loaded', async () => {
    const fantasyPort = createMockFantasyPort();
    const rosterTracker = new RosterTracker();
    // Pre-load some data so isLoaded() is true
    rosterTracker.loadRosters(makeRosterFetchResult().rosters, 27);

    // First call succeeds
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockResolvedValueOnce(makeRosterFetchResult());
    // Second call fails
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Network timeout'),
    );

    const router = buildRouter({
      fantasyPort,
      fantasyTeamIds: ['team-1'],
      rosterTracker,
    });

    await router.handle(makeCmd('roster'));
    const result = await router.handle(makeCmd('roster'));

    expect(result).not.toBeNull();
    // Falls back to previously-loaded data instead of crashing
    expect(result!.text).toContain('Fantasy Rosters');
    expect(result!.text).toContain('Filip');
  });

  it('should always fetch fresh data on each /roster call', async () => {
    const fantasyPort = createMockFantasyPort();
    (fantasyPort.getRosters as ReturnType<typeof vi.fn>).mockResolvedValue(makeRosterFetchResult());

    const router = buildRouter({
      fantasyPort,
      fantasyTeamIds: ['team-1', 'team-2'],
    });

    await router.handle(makeCmd('roster'));
    await router.handle(makeCmd('roster'));
    await router.handle(makeCmd('roster'));

    expect(fantasyPort.getRosters).toHaveBeenCalledTimes(3);
  });
});
