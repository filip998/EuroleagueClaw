import type { NewsPort, NewsEntry } from '../ports/news.port.js';
import type { ChatPort } from '../ports/chat.port.js';
import type { Logger } from '../shared/logger.js';
import { MessageComposer } from './message-composer.js';

const DEFAULT_POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export class InjuryMonitor {
  private readonly seenKeys = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly news: NewsPort,
    private readonly chat: ChatPort,
    private readonly composer: MessageComposer,
    private readonly chatIds: string[],
    private readonly logger: Logger,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.info({ intervalMs: this.pollIntervalMs }, 'Injury monitor started');

    // Initial check after a short delay (don't block startup)
    setTimeout(() => void this.check(), 5000);
    this.timer = setInterval(() => void this.check(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Injury monitor stopped');
    }
  }

  /** Check for new injuries and notify subscribed chats. */
  async check(): Promise<void> {
    try {
      const injuries = await this.news.getInjuryNews();
      const newEntries: NewsEntry[] = [];

      for (const entry of injuries) {
        const key = `${entry.playerName}-${entry.headline}`;
        if (!this.seenKeys.has(key)) {
          this.seenKeys.add(key);
          newEntries.push(entry);
        }
      }

      if (newEntries.length === 0) return;

      this.logger.info({ count: newEntries.length }, 'New injuries detected');
      const text = this.composer.composeNews(newEntries.slice(0, 10), '🚨 New Injury Alerts');

      for (const chatId of this.chatIds) {
        try {
          await this.chat.sendMessage({ chatId, text, parseMode: 'MarkdownV2' });
        } catch (err) {
          this.logger.warn({ chatId, error: String(err) }, 'Failed to send injury alert');
        }
      }
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Injury monitor check failed');
    }
  }
}
