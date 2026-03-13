import { z } from 'zod';

const configSchema = z.object({
  telegram: z.object({
    botToken: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
    allowedChatIds: z.array(z.string()).default([]),
  }),
  euroleague: z.object({
    seasonCode: z.string().default('E2025'),
    competitionCode: z.string().default('E'),
    pollIntervalMs: z.coerce.number().int().min(5000).default(10000),
    liveApiBase: z.string().default('https://api-live.euroleague.net'),
  }),
  dunkest: z.object({
    apiBase: z.string().default('https://fantaking-api.dunkest.com/api/v1'),
    bearerToken: z.string().default(''),
    fantasyTeamIds: z.array(z.string()).default([]),
  }),
  app: z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
    databasePath: z.string().default('./data/euroleague-claw.db'),
    healthPort: z.coerce.number().int().min(0).default(8080),
  }),
  throttle: z.object({
    windowSeconds: z.coerce.number().int().min(10).default(120),
    maxMessagesPerMinute: z.coerce.number().int().min(1).default(5),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  return configSchema.parse({
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN ?? '',
      allowedChatIds: env.TELEGRAM_ALLOWED_CHAT_IDS
        ? env.TELEGRAM_ALLOWED_CHAT_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    },
    euroleague: {
      seasonCode: env.EUROLEAGUE_SEASON_CODE,
      competitionCode: env.EUROLEAGUE_COMPETITION_CODE,
      pollIntervalMs: env.EUROLEAGUE_POLL_INTERVAL_MS,
      liveApiBase: env.EUROLEAGUE_LIVE_API_BASE,
    },
    dunkest: {
      apiBase: env.DUNKEST_API_BASE,
      bearerToken: env.DUNKEST_BEARER_TOKEN,
      fantasyTeamIds: env.DUNKEST_FANTASY_TEAM_IDS
        ? env.DUNKEST_FANTASY_TEAM_IDS.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    },
    app: {
      logLevel: env.LOG_LEVEL,
      nodeEnv: env.NODE_ENV,
      databasePath: env.DATABASE_PATH,
      healthPort: env.HEALTH_PORT,
    },
    throttle: {
      windowSeconds: env.THROTTLE_WINDOW_SECONDS,
      maxMessagesPerMinute: env.THROTTLE_MAX_MESSAGES_PER_MINUTE,
    },
  });
}
