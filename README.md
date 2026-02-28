# 🏀 EuroleagueClaw

A bot/service that posts live EuroLeague game updates, fantasy league info, and trivia to group chats.

## Features

- **Live Game Tracking** — Poll EuroLeague API during games and post score changes, quarter transitions, lead changes, and game results
- **Chat Commands** — `/today`, `/game`, `/stop`, `/games`, `/mute`, `/status`, and more
- **Throttle Control** — Intelligent message batching to avoid spam; mute mode for quiet periods
- **Expandable** — Ports & adapters architecture; add Viber, WhatsApp, or other platforms easily

## Quick Start

### Prerequisites

- Node.js ≥ 22
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

### Setup

```bash
# Clone and install
git clone <repo-url>
cd euroleague-claw
npm install

# Configure
cp .env.example .env
# Edit .env with your TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_IDS

# Run in development
npm run dev

# Run tests
npm test

# Build for production
npm run build
npm start
```

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from @BotFather |
| `TELEGRAM_ALLOWED_CHAT_IDS` | No | — | Comma-separated chat IDs to allow (empty = allow all) |
| `EUROLEAGUE_SEASON_CODE` | No | `E2025` | Current season code |
| `EUROLEAGUE_POLL_INTERVAL_MS` | No | `15000` | Polling interval during live games (ms) |
| `LOG_LEVEL` | No | `info` | Log level: debug, info, warn, error |
| `THROTTLE_WINDOW_SECONDS` | No | `120` | Batch window for non-critical events |
| `THROTTLE_MAX_MESSAGES_PER_MINUTE` | No | `5` | Max messages per minute per chat |

## Commands

| Command | Description |
|---|---|
| `/help` | Show available commands |
| `/today` | Today's EuroLeague schedule |
| `/game <code>` | Start tracking a game (get code from `/today`) |
| `/stop <code>` | Stop tracking a game |
| `/games` | List currently tracked games |
| `/mute <minutes>` | Silence non-critical updates |
| `/unmute` | Resume updates |
| `/status` | Bot health check |

## Architecture

Hexagonal (Ports & Adapters):

```
┌──────────────────────────────────┐
│         CORE DOMAIN              │
│  GameTracker · CommandRouter     │
│  MessageComposer · Throttle     │
├──────┬──────┬──────┬─────────────┤
│ Chat │Stats │Fantas│  Storage    │
│ Port │Port  │yPort │  Port       │
├──────┼──────┼──────┼─────────────┤
│Telegr│EuroLg│Dunkes│ InMemory    │
│ am   │ API  │  t   │ (→ SQLite)  │
└──────┴──────┴──────┴─────────────┘
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Zod-validated env config
├── container.ts          # DI wiring
├── ports/                # Port interfaces
├── adapters/             # Adapter implementations
│   ├── telegram/
│   ├── euroleague/
│   ├── dunkest/
│   └── storage/
├── domain/               # Core business logic
│   ├── game-tracker.ts
│   ├── command-router.ts
│   ├── message-composer.ts
│   ├── throttle-manager.ts
│   └── types.ts
└── shared/               # Logger, errors, retry
tests/
├── unit/
└── integration/
```

## Telegram Bot Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the token to `TELEGRAM_BOT_TOKEN`
3. Add the bot to your group chat
4. Get the chat ID (send a message, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
5. Add the chat ID to `TELEGRAM_ALLOWED_CHAT_IDS`

### Privacy Mode

By default, bots only see `/commands` in groups. For this bot, that's sufficient. If you want the bot to see all messages, disable privacy mode in @BotFather → Bot Settings → Group Privacy.

## Development

```bash
npm run dev        # Start with hot-reload
npm test           # Run tests
npm run test:watch # Watch mode
npm run lint       # ESLint
npm run format     # Prettier
npm run build      # Compile TypeScript
```

## License

MIT
