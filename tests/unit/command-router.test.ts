import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../../src/domain/command-router.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import { ThrottleManager } from '../../src/domain/throttle-manager.js';
import type { StatsPort } from '../../src/ports/stats.port.js';
import type { GameTracker } from '../../src/domain/game-tracker.js';
import type { IncomingCommand } from '../../src/domain/types.js';

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
