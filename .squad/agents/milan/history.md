# Milan — History

## Project Context
**Project:** EuroleagueClaw — TypeScript/Node.js bot for live EuroLeague basketball game updates to Telegram group chats.
**Stack:** TypeScript (strict, ESM), Node.js ≥22, grammy, better-sqlite3, node-cron, Zod, Pino, vitest
**Architecture:** Hexagonal (Ports & Adapters) with 5 ports: ChatPort, StatsPort, FantasyPort, StoragePort, SchedulerPort
**User:** Filip Tanic

## Learnings

### Joined Team (2026-03-13)
- Owns Azure deployment, GitHub Actions CI/CD, Docker, secrets flow, and runtime operations.
- Primary surfaces are `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, and deployment/config assets.
- Deployment target preference is Azure with GitHub-based automation and minimal ops overhead.
