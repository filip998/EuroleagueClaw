import type { AppConfig } from './config.js';
import type { ChatPort } from './ports/chat.port.js';
import type { StatsPort } from './ports/stats.port.js';
import type { StoragePort } from './ports/storage.port.js';
import { TelegramAdapter } from './adapters/telegram/telegram.adapter.js';
import { EuroLeagueAdapter } from './adapters/euroleague/euroleague.adapter.js';
import { DunkestAdapter } from './adapters/dunkest/dunkest.adapter.js';
import { InMemoryStorageAdapter } from './adapters/storage/in-memory.adapter.js';
import { SQLiteAdapter } from './adapters/storage/sqlite.adapter.js';
import { GameTracker } from './domain/game-tracker.js';
import { FantasyTracker } from './domain/fantasy-tracker.js';
import { CommandRouter } from './domain/command-router.js';
import { MessageComposer } from './domain/message-composer.js';
import { ThrottleManager } from './domain/throttle-manager.js';
import { TriviaService } from './domain/trivia-service.js';
import { createLogger, type Logger } from './shared/logger.js';

export interface AppContainer {
  config: AppConfig;
  logger: Logger;
  chat: ChatPort;
  stats: StatsPort;
  storage: StoragePort;
  gameTracker: GameTracker;
  commandRouter: CommandRouter;
  messageComposer: MessageComposer;
  throttle: ThrottleManager;
  triviaService: TriviaService;
}

export function createContainer(config: AppConfig): AppContainer {
  const logger = createLogger(config.app.logLevel);

  // Adapters
  const chat = new TelegramAdapter(
    config.telegram.botToken,
    config.telegram.allowedChatIds,
    logger,
  );

  const stats = new EuroLeagueAdapter(
    config.euroleague.liveApiBase,
    logger,
  );

  const storage: StoragePort = config.app.nodeEnv === 'test'
    ? new InMemoryStorageAdapter()
    : new SQLiteAdapter(config.app.databasePath);

  // Domain services
  const messageComposer = new MessageComposer();

  const throttle = new ThrottleManager(
    {
      windowSeconds: config.throttle.windowSeconds,
      maxMessagesPerMinute: config.throttle.maxMessagesPerMinute,
    },
    logger,
  );

  const gameTracker = new GameTracker(
    stats,
    storage,
    logger,
    config.euroleague.pollIntervalMs,
    async (chatId, event) => {
      const shouldSend = throttle.shouldSend(chatId, event);
      if (!shouldSend) {
        logger.debug({ chatId, eventType: event.type }, 'Event throttled');
        return;
      }

      const text = messageComposer.compose(event);
      const eventKey = `${event.type}-${event.gameCode}-${JSON.stringify(event)}`;
      const alreadySent = await storage.hasEventBeenSent(chatId, eventKey);
      if (alreadySent) return;

      await chat.sendMessage({ chatId, text });
      throttle.recordSent(chatId);
      await storage.markEventSent(chatId, String(event.gameCode), event.type, eventKey, text);
    },
  );

  // Fantasy (optional — only if bearer token is configured)
  let fantasyTracker: FantasyTracker | undefined;
  if (config.dunkest.bearerToken) {
    const dunkest = new DunkestAdapter(config.dunkest.apiBase, config.dunkest.bearerToken, logger);
    fantasyTracker = new FantasyTracker(dunkest, logger);
    logger.info('Fantasy tracking enabled (Dunkest adapter)');
  }

  const triviaService = new TriviaService(storage, logger);

  const commandRouter = new CommandRouter({
    gameTracker,
    messageComposer,
    stats,
    throttle,
    logger,
    seasonCode: config.euroleague.seasonCode,
    competitionCode: config.euroleague.competitionCode,
    startTime: Date.now(),
    fantasyTracker,
    triviaService,
  });

  return {
    config,
    logger,
    chat,
    stats,
    storage,
    gameTracker,
    commandRouter,
    messageComposer,
    throttle,
    triviaService,
  };
}
