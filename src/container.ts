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
import { RosterTracker } from './domain/roster-tracker.js';
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

export async function createContainer(config: AppConfig): Promise<AppContainer> {
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

  // Roster tracker — prefer API, fall back to file
  const rosterTracker = new RosterTracker();
  if (config.dunkest.bearerToken && config.dunkest.fantasyTeamIds.length > 0) {
    const dunkestForRosters = new DunkestAdapter(config.dunkest.apiBase, config.dunkest.bearerToken, logger);
    try {
      const result = await dunkestForRosters.getRosters(config.dunkest.fantasyTeamIds);
      if (result.rosters.length > 0) {
        rosterTracker.loadRosters(result.rosters, result.matchdayNumber);
        logger.info({ teamCount: result.rosters.length, matchday: result.matchdayNumber }, 'Fantasy rosters loaded from Dunkest API');
      } else {
        rosterTracker.loadFromFile('./data/rosters.json');
        logger.info('API returned no rosters, loaded from file fallback');
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'Dunkest API roster fetch failed, falling back to file');
      rosterTracker.loadFromFile('./data/rosters.json');
    }
  } else {
    rosterTracker.loadFromFile('./data/rosters.json');
    if (rosterTracker.isLoaded()) {
      logger.info('Fantasy rosters loaded from file');
    }
  }

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
    async (chatId, events) => {
      if (!rosterTracker.isLoaded()) return;

      for (const event of events) {
        const owners = rosterTracker.matchEvent(event);
        if (owners.length > 0) {
          const text = messageComposer.composeRosterMatch(event, owners);
          await chat.sendMessage({ chatId, text, parseMode: 'MarkdownV2' });
        }
      }
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
    rosterTracker,
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
