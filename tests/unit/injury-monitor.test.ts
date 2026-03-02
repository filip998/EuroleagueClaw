import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InjuryMonitor } from '../../src/domain/injury-monitor.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { NewsPort, NewsEntry } from '../../src/ports/news.port.js';
import type { ChatPort } from '../../src/ports/chat.port.js';
import type { Logger } from '../../src/shared/logger.js';
import type { RoundGame } from '../../src/domain/types.js';

function createMockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function createMockNews(entries: NewsEntry[] = []): NewsPort {
  return {
    getLatestNews: vi.fn().mockResolvedValue(entries),
    getInjuryNews: vi.fn().mockResolvedValue(entries),
  };
}

function createMockChat(): ChatPort {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getPlatformName: vi.fn().mockReturnValue('telegram'),
  } as unknown as ChatPort;
}

function makeInjuryEntry(overrides: Partial<NewsEntry> = {}): NewsEntry {
  return {
    playerName: 'Test Player',
    headline: 'Out with injury',
    date: 'Jul 18, 2025',
    position: 'G',
    injuryType: 'Knee',
    newsText: 'Player is expected to miss several weeks.',
    isInjury: true,
    ...overrides,
  };
}

describe('InjuryMonitor', () => {
  let news: NewsPort;
  let chat: ChatPort;
  let composer: MessageComposer;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    chat = createMockChat();
    composer = new MessageComposer();
  });

  it('should detect new injuries and send alerts', async () => {
    const entries = [
      makeInjuryEntry({ playerName: 'Campazzo', headline: 'Knee sprain' }),
    ];
    news = createMockNews(entries);

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    await monitor.check();

    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    expect(chat.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        parseMode: 'MarkdownV2',
      }),
    );
    const sentText = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain('Campazzo');
  });

  it('should NOT alert for already-seen injuries', async () => {
    const entries = [
      makeInjuryEntry({ playerName: 'Campazzo', headline: 'Knee sprain' }),
    ];
    news = createMockNews(entries);

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);

    // First check sees new injury
    await monitor.check();
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);

    // Second check — same injuries, no new alert
    await monitor.check();
    expect(chat.sendMessage).toHaveBeenCalledTimes(1); // still 1
  });

  it('should detect only new injuries on subsequent checks', async () => {
    const firstEntries = [
      makeInjuryEntry({ playerName: 'Player A', headline: 'Injury A' }),
    ];
    const secondEntries = [
      makeInjuryEntry({ playerName: 'Player A', headline: 'Injury A' }),
      makeInjuryEntry({ playerName: 'Player B', headline: 'Injury B' }),
    ];

    const mockGetInjuryNews = vi.fn()
      .mockResolvedValueOnce(firstEntries)
      .mockResolvedValueOnce(secondEntries);

    news = {
      getLatestNews: vi.fn().mockResolvedValue([]),
      getInjuryNews: mockGetInjuryNews,
    };

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);

    await monitor.check();
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
    const firstText = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(firstText).toContain('Player A');

    await monitor.check();
    expect(chat.sendMessage).toHaveBeenCalledTimes(2);
    const secondText = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[1][0].text;
    expect(secondText).toContain('Player B');
    // Player A was already seen, should not appear in second alert
    expect(secondText).not.toContain('Player A');
  });

  it('should send alerts to multiple chat IDs', async () => {
    const entries = [makeInjuryEntry()];
    news = createMockNews(entries);

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1', 'chat-2', 'chat-3'], logger);
    await monitor.check();

    expect(chat.sendMessage).toHaveBeenCalledTimes(3);
  });

  it('should handle empty news gracefully', async () => {
    news = createMockNews([]);

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    await monitor.check();

    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it('should generate alert text with injury alert title', async () => {
    const entries = [makeInjuryEntry({ playerName: 'Doncic' })];
    news = createMockNews(entries);

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    await monitor.check();

    const sentText = (chat.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].text;
    expect(sentText).toContain('Injury Alerts');
    expect(sentText).toContain('Doncic');
  });

  it('should handle chat.sendMessage failure gracefully', async () => {
    const entries = [makeInjuryEntry()];
    news = createMockNews(entries);
    (chat.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Telegram error'));

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    // Should not throw
    await expect(monitor.check()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should handle news.getInjuryNews failure gracefully', async () => {
    news = {
      getLatestNews: vi.fn().mockResolvedValue([]),
      getInjuryNews: vi.fn().mockRejectedValue(new Error('Network error')),
    };

    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    await expect(monitor.check()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('should limit alerts to 10 entries max', async () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      makeInjuryEntry({ playerName: `Player ${i}`, headline: `Injury ${i}` }),
    );
    news = createMockNews(entries);

    const composeSpy = vi.spyOn(composer, 'composeNews');
    const monitor = new InjuryMonitor(news, chat, composer, ['chat-1'], logger);
    await monitor.check();

    expect(composeSpy).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ playerName: 'Player 0' })]),
      expect.any(String),
    );
    // The slice(0, 10) in check() limits to 10
    const passedEntries = composeSpy.mock.calls[0][0];
    expect(passedEntries).toHaveLength(10);
  });
});

describe('InjuryMonitor.calculateNextInterval', () => {
  let news: NewsPort;
  let chat: ChatPort;
  let composer: MessageComposer;
  let logger: Logger;

  beforeEach(() => {
    logger = createMockLogger();
    chat = createMockChat();
    composer = new MessageComposer();
    news = createMockNews([]);
  });

  function makeGame(startTime: string, status: 'scheduled' | 'live' | 'finished' = 'scheduled'): RoundGame {
    return {
      gameCode: 1,
      homeTeam: { code: 'TEA', name: 'Team A', shortName: 'TEA' },
      awayTeam: { code: 'TEB', name: 'Team B', shortName: 'TEB' },
      status,
      startTime,
      homeScore: 0,
      awayScore: 0,
    };
  }

  it('should return 12h-idle when no games exist', () => {
    const now = new Date('2025-07-18T10:00:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([]);
    expect(result).toEqual({ intervalMs: 12 * 60 * 60 * 1000, mode: '12h-idle' });
  });

  it('should return 12h-idle when all games are finished', () => {
    const now = new Date('2025-07-18T22:00:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-18T18:00:00Z', 'finished'),
    ]);
    expect(result).toEqual({ intervalMs: 12 * 60 * 60 * 1000, mode: '12h-idle' });
  });

  it('should return 5min-critical when a game is within 2 hours', () => {
    const now = new Date('2025-07-18T17:30:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-18T19:00:00Z', 'scheduled'),
    ]);
    expect(result).toEqual({ intervalMs: 5 * 60 * 1000, mode: '5min-critical' });
  });

  it('should return 30min-gameday when game today but >2h away', () => {
    const now = new Date('2025-07-18T10:00:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-18T19:00:00Z', 'scheduled'),
    ]);
    expect(result).toEqual({ intervalMs: 30 * 60 * 1000, mode: '30min-gameday' });
  });

  it('should return 12h-idle when games are on a different day', () => {
    const now = new Date('2025-07-17T10:00:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-18T19:00:00Z', 'scheduled'),
    ]);
    expect(result).toEqual({ intervalMs: 12 * 60 * 60 * 1000, mode: '12h-idle' });
  });

  it('should pick 5min-critical if ANY game in round is within 2 hours', () => {
    const now = new Date('2025-07-18T17:30:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-19T19:00:00Z', 'scheduled'), // tomorrow
      makeGame('2025-07-18T19:00:00Z', 'scheduled'), // today, within 2h
    ]);
    expect(result).toEqual({ intervalMs: 5 * 60 * 1000, mode: '5min-critical' });
  });

  it('should use Belgrade timezone for today check', () => {
    // 23:30 UTC = 01:30 Belgrade (next day) — game at 00:30 UTC = 02:30 Belgrade (same day as "now" in Belgrade)
    const now = new Date('2025-07-18T23:30:00Z');
    const monitor = new InjuryMonitor(news, chat, composer, [], logger, undefined, () => now);
    const result = monitor.calculateNextInterval([
      makeGame('2025-07-19T00:30:00Z', 'scheduled'), // same Belgrade date (Jul 19), within 2h
    ]);
    expect(result).toEqual({ intervalMs: 5 * 60 * 1000, mode: '5min-critical' });
  });
});
