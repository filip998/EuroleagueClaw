import type { AppConfig } from './config.js';
import type { ChatPort } from './ports/chat.port.js';
import type { StatsPort } from './ports/stats.port.js';
import type { StoragePort } from './ports/storage.port.js';
import type { TvSchedulePort } from './ports/tv-schedule.port.js'; // eslint-disable-line @typescript-eslint/no-unused-vars
import type { NewsPort } from './ports/news.port.js';
import { TelegramAdapter } from './adapters/telegram/telegram.adapter.js';
import { EuroLeagueAdapter } from './adapters/euroleague/euroleague.adapter.js';
import { DunkestAdapter } from './adapters/dunkest/dunkest.adapter.js';
import { ArenaSportAdapter } from './adapters/tv-schedule/arena-sport.adapter.js';
import { RotoWireAdapter } from './adapters/rotowire/rotowire.adapter.js';
import { InMemoryStorageAdapter } from './adapters/storage/in-memory.adapter.js';
import { SQLiteAdapter } from './adapters/storage/sqlite.adapter.js';
import { GameTracker } from './domain/game-tracker.js';
import { FantasyTracker } from './domain/fantasy-tracker.js';
import { CommandRouter } from './domain/command-router.js';
import { MessageComposer } from './domain/message-composer.js';
import { ThrottleManager } from './domain/throttle-manager.js';
import { TriviaService } from './domain/trivia-service.js';
import { RosterTracker } from './domain/roster-tracker.js';
import { InjuryMonitor } from './domain/injury-monitor.js';
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
  injuryMonitor?: InjuryMonitor;
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

  // Roster tracker — load from Dunkest API
  const rosterTracker = new RosterTracker();
  const rosterDunkestConfig = {
    bearerToken: config.dunkest.bearerToken,
    apiBase: config.dunkest.apiBase,
    fantasyTeamIds: config.dunkest.fantasyTeamIds,
  };

  if (rosterDunkestConfig.bearerToken && rosterDunkestConfig.fantasyTeamIds.length > 0) {
    const dunkestForRosters = new DunkestAdapter(rosterDunkestConfig.apiBase, rosterDunkestConfig.bearerToken, logger);
    try {
      const result = await dunkestForRosters.getRosters(rosterDunkestConfig.fantasyTeamIds);
      if (result.rosters.length > 0) {
        rosterTracker.loadRosters(result.rosters, result.matchdayNumber);
        logger.info({ teamCount: result.rosters.length, matchday: result.matchdayNumber }, 'Fantasy rosters loaded from Dunkest API');
      }
    } catch (err) {
      logger.warn({ error: String(err) }, 'Dunkest API roster fetch failed at startup — will retry lazily on first PBP events');
    }
  }

  // Lazy roster loading state — tracks last attempt to avoid hammering Dunkest API
  let lastRosterLoadAttempt = 0;
  const ROSTER_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

  async function tryLazyRosterLoad(): Promise<boolean> {
    if (!rosterDunkestConfig.bearerToken || rosterDunkestConfig.fantasyTeamIds.length === 0) {
      return false;
    }

    const now = Date.now();
    if (now - lastRosterLoadAttempt < ROSTER_RETRY_COOLDOWN_MS) {
      logger.debug('Roster lazy-load skipped — cooldown active');
      return false;
    }

    lastRosterLoadAttempt = now;
    logger.info('Attempting lazy roster load from Dunkest API');

    try {
      const dunkest = new DunkestAdapter(rosterDunkestConfig.apiBase, rosterDunkestConfig.bearerToken, logger);
      const result = await dunkest.getRosters(rosterDunkestConfig.fantasyTeamIds);
      if (result.rosters.length > 0) {
        rosterTracker.loadRosters(result.rosters, result.matchdayNumber);
        logger.info({ teamCount: result.rosters.length, matchday: result.matchdayNumber }, 'Lazy roster load succeeded');
        return true;
      }
      logger.warn('Lazy roster load returned empty rosters');
      return false;
    } catch (err) {
      logger.warn({ error: String(err) }, 'Lazy roster load failed — will retry after cooldown');
      return false;
    }
  }

  const gameTracker = new GameTracker(
    stats,
    storage,
    logger,
    config.euroleague.pollIntervalMs,
    async (_chatId, event) => {
      // Game-level events (score changes, quarter transitions, lead changes, big runs,
      // game start/end) are detected for internal state tracking only.
      // Only tracked-player notifications (via onPlayByPlay roster matching) are sent to chat.
      logger.debug({ eventType: event.type, gameCode: event.gameCode }, 'Game event detected (not sent to chat)');
    },
    async (chatId, events) => {
      // Lazy-load rosters if not loaded yet (e.g., startup fetch failed)
      if (!rosterTracker.isLoaded()) {
        logger.warn({ chatId, eventCount: events.length }, 'PBP events arrived but rosters not loaded — attempting lazy load');
        const loaded = await tryLazyRosterLoad();
        if (!loaded) {
          logger.debug({ chatId }, 'Roster not loaded — checking custom-tracked players only');
        }
      }

      for (const event of events) {
        rosterTracker.registerKnownPlayer(event.playerName);
        const owners = rosterTracker.matchEvent(event, chatId);
        if (owners.length > 0) {
          logger.debug({ chatId, player: event.playerName, owners, eventType: event.eventType }, 'PBP roster match found');
          const text = messageComposer.composeRosterMatch(event, owners);
          await chat.sendMessage({ chatId, text, parseMode: 'MarkdownV2' });
        }
      }
    },
  );

  // Fantasy (optional — only if bearer token is configured)
  let fantasyTracker: FantasyTracker | undefined;
  let fantasyPort: DunkestAdapter | undefined;
  if (config.dunkest.bearerToken) {
    const dunkest = new DunkestAdapter(config.dunkest.apiBase, config.dunkest.bearerToken, logger);
    fantasyPort = dunkest;
    fantasyTracker = new FantasyTracker(dunkest, logger);
    logger.info('Fantasy tracking enabled (Dunkest adapter)');
  }

  const triviaService = new TriviaService(storage, logger);

  // TV Schedule (optional — Arena Sport, graceful degradation)
  const tvSchedule = new ArenaSportAdapter(logger);

  // News (RotoWire — graceful degradation)
  const news: NewsPort = new RotoWireAdapter(logger);

  // Injury Monitor — proactive alerts to all allowed chats
  const alertChatIds = config.telegram.allowedChatIds.length > 0
    ? config.telegram.allowedChatIds
    : [];
  let injuryMonitor: InjuryMonitor | undefined;
  if (alertChatIds.length > 0) {
    injuryMonitor = new InjuryMonitor(
      news, chat, messageComposer, alertChatIds, logger,
      () => stats.getCurrentRoundGames(config.euroleague.seasonCode, config.euroleague.competitionCode)
        .then(schedule => schedule.games),
    );
    injuryMonitor.start();
    logger.info({ chatCount: alertChatIds.length }, 'Injury monitor enabled');
  }

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
    fantasyPort,
    fantasyTeamIds: config.dunkest.fantasyTeamIds,
    tvSchedule,
    news,
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
    injuryMonitor,
  };
}
