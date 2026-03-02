import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InjuryMonitor } from '../../src/domain/injury-monitor.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { NewsPort, NewsEntry } from '../../src/ports/news.port.js';
import type { ChatPort } from '../../src/ports/chat.port.js';
import type { Logger } from '../../src/shared/logger.js';

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
