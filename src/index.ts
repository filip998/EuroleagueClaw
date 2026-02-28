import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { startHealthCheck } from './shared/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const config = loadConfig();
  const container = createContainer(config);
  const { logger, chat, storage, commandRouter, gameTracker, triviaService } = container;

  // Initialize storage
  await storage.initialize();
  logger.info('Storage initialized');

  // Seed trivia data
  const triviaPath = join(__dirname, '..', 'data', 'trivia.json');
  await triviaService.seedTrivia(triviaPath);


  // Resume tracking any previously tracked games
  await gameTracker.resumeAll();

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
    gameTracker.stopAll();
    await chat.stop();
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
