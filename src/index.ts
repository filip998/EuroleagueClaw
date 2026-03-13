import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { startHealthCheck } from './shared/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const config = loadConfig();
  const container = await createContainer(config);
  const { logger, chat, storage, commandRouter, gameTracker, triviaService, injuryMonitor, stats, messageComposer } = container;

  // Initialize storage
  await storage.initialize();
  logger.info('Storage initialized');

  // Seed trivia data
  const triviaPath = join(__dirname, '..', 'data', 'trivia.json');
  await triviaService.seedTrivia(triviaPath);


  // Resume tracking any previously tracked games
  try {
    const resumedGames = await gameTracker.resumeAll();
    for (const game of resumedGames) {
      messageComposer.registerGame(game.gameCode, game.homeTeam, game.awayTeam);
    }
    if (resumedGames.length > 0) {
      logger.info({ count: resumedGames.length }, 'Registered team names for resumed games');
    }
  } catch (err) {
    logger.error({ error: String(err) }, 'Failed to resume tracked games — will require manual /trackall');
  }

  // Start listening for chat commands
  await chat.start(async (cmd) => {
    const response = await commandRouter.handle(cmd);
    if (response) {
      await chat.sendMessage(response);
    }
  });

  // Start health check endpoint
  const startTime = Date.now();
  startHealthCheck(config.app.healthPort, () => ({
    uptime: Math.floor((Date.now() - startTime) / 1000),
    trackedGames: gameTracker.trackedGameCount,
  }));
  logger.info({ port: config.app.healthPort }, 'Health check endpoint started');

  logger.info('🏀 EuroleagueClaw is running!');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    injuryMonitor?.stop();
    gameTracker.stopAll();
    await chat.stop();
    if ('close' in stats && typeof stats.close === 'function') {
      await stats.close();
    }
    await storage.close();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
