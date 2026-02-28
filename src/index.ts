import { loadConfig } from './config.js';
import { createContainer } from './container.js';

async function main() {
  const config = loadConfig();
  const container = createContainer(config);
  const { logger, chat, storage, commandRouter, gameTracker } = container;

  // Initialize storage
  await storage.initialize();
  logger.info('Storage initialized');

  // Resume tracking any previously tracked games
  await gameTracker.resumeAll();

  // Start listening for chat commands
  await chat.start(async (cmd) => {
    const response = await commandRouter.handle(cmd);
    if (response) {
      await chat.sendMessage(response);
    }
  });

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
  console.error('Fatal error:', err);
  process.exit(1);
});
