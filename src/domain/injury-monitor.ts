import type { NewsPort, NewsEntry } from '../ports/news.port.js';
import type { ChatPort } from '../ports/chat.port.js';
import type { Logger } from '../shared/logger.js';
import type { RoundGame } from './types.js';
import { MessageComposer } from './message-composer.js';

const INTERVAL_5MIN = 5 * 60 * 1000;
const INTERVAL_30MIN = 30 * 60 * 1000;
const INTERVAL_12H = 12 * 60 * 60 * 1000;

export type PollingMode = '5min-critical' | '30min-gameday' | '12h-idle';

export type GetRoundGames = () => Promise<RoundGame[]>;

export class InjuryMonitor {
  private readonly seenKeys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly news: NewsPort,
    private readonly chat: ChatPort,
    private readonly composer: MessageComposer,
    private readonly chatIds: string[],
    private readonly logger: Logger,
    private readonly getRoundGames?: GetRoundGames,
    private readonly nowFn: () => Date = () => new Date(),
  ) {}

  start(): void {
    if (this.timer) return;
    this.logger.info('Injury monitor started');

    // Initial check after a short delay (don't block startup)
    setTimeout(() => void this.checkAndReschedule(), 5000);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.logger.info('Injury monitor stopped');
    }
  }

  private async checkAndReschedule(): Promise<void> {
    await this.check();

    let intervalMs = INTERVAL_30MIN;
    let mode: PollingMode = '30min-gameday';

    if (this.getRoundGames) {
      try {
        const games = await this.getRoundGames();
        const result = this.calculateNextInterval(games);
        intervalMs = result.intervalMs;
        mode = result.mode;
      } catch (err) {
        this.logger.warn({ error: String(err) }, 'Failed to fetch round games for interval calc');
      }
    }

    this.logger.info({ intervalMs, mode }, 'Next injury poll scheduled');
    this.timer = setTimeout(() => void this.checkAndReschedule(), intervalMs);
  }

  /** Determine polling interval based on proximity to game times. */
  calculateNextInterval(games: RoundGame[]): { intervalMs: number; mode: PollingMode } {
    const now = this.nowFn();
    const todayBelgrade = toBelgradeDateString(now);
    const twoHoursMs = 2 * 60 * 60 * 1000;

    // Find the earliest unfinished game TODAY
    let earliestGameToday: Date | null = null;

    for (const game of games) {
      if (game.status === 'finished') continue;
      const gameTime = new Date(game.startTime);
      const gameDateBelgrade = toBelgradeDateString(gameTime);

      if (gameDateBelgrade === todayBelgrade) {
        if (!earliestGameToday || gameTime < earliestGameToday) {
          earliestGameToday = gameTime;
        }
      }
    }

    if (earliestGameToday) {
      const msUntilFirstGame = earliestGameToday.getTime() - now.getTime();
      // Critical: 0–2h before FIRST game only (lineup deadline = first tip-off)
      if (msUntilFirstGame > 0 && msUntilFirstGame <= twoHoursMs) {
        return { intervalMs: INTERVAL_5MIN, mode: '5min-critical' };
      }
      // Game day but either >2h before or games already started
      return { intervalMs: INTERVAL_30MIN, mode: '30min-gameday' };
    }

    return { intervalMs: INTERVAL_12H, mode: '12h-idle' };
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

/** Format a Date as YYYY-MM-DD in Europe/Belgrade timezone. */
function toBelgradeDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });
}
