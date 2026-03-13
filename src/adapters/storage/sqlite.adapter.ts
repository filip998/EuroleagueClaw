import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoragePort } from '../../ports/storage.port.js';
import type { TrackedGame, ChatSubscription, TriviaQuestion } from '../../domain/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TrackedGameRow {
  id: string;
  game_code: number;
  season_code: string;
  home_team: string;
  away_team: string;
  status: string;
  last_score_home: number;
  last_score_away: number;
  last_quarter: number;
  last_event_id: string | null;
  tracked_by_chat_id: string;
  created_at: string;
  updated_at: string;
}

interface ChatSubscriptionRow {
  chat_id: string;
  chat_platform: string;
  is_active: number;
  muted_until: string | null;
  fantasy_enabled: number;
  trivia_enabled: number;
  created_at: string;
}

interface TriviaRow {
  id: number;
  question: string;
  answer: string;
  category: string | null;
}

function rowToTrackedGame(row: TrackedGameRow): TrackedGame {
  return {
    id: row.id,
    gameCode: row.game_code,
    seasonCode: row.season_code,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
    status: row.status as TrackedGame['status'],
    lastScoreHome: row.last_score_home,
    lastScoreAway: row.last_score_away,
    lastQuarter: row.last_quarter,
    lastEventId: row.last_event_id,
    trackedByChatId: row.tracked_by_chat_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSubscription(row: ChatSubscriptionRow): ChatSubscription {
  return {
    chatId: row.chat_id,
    chatPlatform: row.chat_platform,
    isActive: row.is_active === 1,
    mutedUntil: row.muted_until,
    fantasyEnabled: row.fantasy_enabled === 1,
    triviaEnabled: row.trivia_enabled === 1,
    createdAt: row.created_at,
  };
}

function rowToTrivia(row: TriviaRow): TriviaQuestion {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category ?? '',
  };
}

export class SQLiteAdapter implements StoragePort {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    // Use DELETE journal mode for Azure Files SMB compatibility (WAL requires shared-memory)
    this.db.pragma('journal_mode = DELETE');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    const migrationPath = join(__dirname, 'migrations', '001_initial.sql');
    const migrationSql = readFileSync(migrationPath, 'utf-8');
    this.db.exec(migrationSql);
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private getDb(): Database.Database {
    if (!this.db) throw new Error('Database not initialized. Call initialize() first.');
    return this.db;
  }

  // ─── Tracked Games ──────────────────────────────

  async addTrackedGame(game: Omit<TrackedGame, 'createdAt' | 'updatedAt'>): Promise<void> {
    const db = this.getDb();
    const stmt = db.prepare(`
      INSERT INTO tracked_games (id, game_code, season_code, home_team, away_team, status, last_score_home, last_score_away, last_quarter, last_event_id, tracked_by_chat_id)
      VALUES (@id, @gameCode, @seasonCode, @homeTeam, @awayTeam, @status, @lastScoreHome, @lastScoreAway, @lastQuarter, @lastEventId, @trackedByChatId)
    `);
    stmt.run({
      id: game.id,
      gameCode: game.gameCode,
      seasonCode: game.seasonCode,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      status: game.status,
      lastScoreHome: game.lastScoreHome,
      lastScoreAway: game.lastScoreAway,
      lastQuarter: game.lastQuarter,
      lastEventId: game.lastEventId,
      trackedByChatId: game.trackedByChatId,
    });
  }

  async removeTrackedGame(id: string): Promise<void> {
    const db = this.getDb();
    db.prepare('DELETE FROM tracked_games WHERE id = ?').run(id);
  }

  async getTrackedGame(id: string): Promise<TrackedGame | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM tracked_games WHERE id = ?').get(id) as TrackedGameRow | undefined;
    return row ? rowToTrackedGame(row) : null;
  }

  async getTrackedGamesByChat(chatId: string): Promise<TrackedGame[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM tracked_games WHERE tracked_by_chat_id = ?').all(chatId) as TrackedGameRow[];
    return rows.map(rowToTrackedGame);
  }

  async getAllTrackedGames(): Promise<TrackedGame[]> {
    const db = this.getDb();
    const rows = db.prepare('SELECT * FROM tracked_games').all() as TrackedGameRow[];
    return rows.map(rowToTrackedGame);
  }

  async updateTrackedGame(id: string, updates: Partial<TrackedGame>): Promise<void> {
    const db = this.getDb();
    const fieldMap: Record<string, string> = {
      gameCode: 'game_code',
      seasonCode: 'season_code',
      homeTeam: 'home_team',
      awayTeam: 'away_team',
      status: 'status',
      lastScoreHome: 'last_score_home',
      lastScoreAway: 'last_score_away',
      lastQuarter: 'last_quarter',
      lastEventId: 'last_event_id',
      trackedByChatId: 'tracked_by_chat_id',
    };

    const setClauses: string[] = [];
    const values: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(updates)) {
      const column = fieldMap[key];
      if (column) {
        setClauses.push(`${column} = @${key}`);
        values[key] = value;
      }
    }

    if (setClauses.length === 0) return;

    setClauses.push("updated_at = datetime('now')");
    db.prepare(`UPDATE tracked_games SET ${setClauses.join(', ')} WHERE id = @id`).run(values);
  }

  // ─── Chat Subscriptions ─────────────────────────

  async getOrCreateSubscription(chatId: string, platform: string): Promise<ChatSubscription> {
    const db = this.getDb();
    const existing = db.prepare('SELECT * FROM chat_subscriptions WHERE chat_id = ?').get(chatId) as ChatSubscriptionRow | undefined;
    if (existing) return rowToSubscription(existing);

    db.prepare(`
      INSERT INTO chat_subscriptions (chat_id, chat_platform)
      VALUES (?, ?)
    `).run(chatId, platform);

    const row = db.prepare('SELECT * FROM chat_subscriptions WHERE chat_id = ?').get(chatId) as ChatSubscriptionRow;
    return rowToSubscription(row);
  }

  async updateSubscription(chatId: string, updates: Partial<ChatSubscription>): Promise<void> {
    const db = this.getDb();
    const fieldMap: Record<string, string> = {
      chatPlatform: 'chat_platform',
      isActive: 'is_active',
      mutedUntil: 'muted_until',
      fantasyEnabled: 'fantasy_enabled',
      triviaEnabled: 'trivia_enabled',
    };

    const setClauses: string[] = [];
    const values: Record<string, unknown> = { chatId };

    for (const [key, value] of Object.entries(updates)) {
      const column = fieldMap[key];
      if (column) {
        // Convert booleans to integers for SQLite
        const dbValue = typeof value === 'boolean' ? (value ? 1 : 0) : value;
        setClauses.push(`${column} = @${key}`);
        values[key] = dbValue;
      }
    }

    if (setClauses.length === 0) return;

    db.prepare(`UPDATE chat_subscriptions SET ${setClauses.join(', ')} WHERE chat_id = @chatId`).run(values);
  }

  // ─── Sent Events ────────────────────────────────

  async hasEventBeenSent(chatId: string, eventKey: string): Promise<boolean> {
    const db = this.getDb();
    const row = db.prepare('SELECT 1 FROM sent_events WHERE chat_id = ? AND event_key = ?').get(chatId, eventKey);
    return row !== undefined;
  }

  async markEventSent(
    chatId: string,
    gameId: string | null,
    eventType: string,
    eventKey: string,
    messageText: string,
  ): Promise<void> {
    const db = this.getDb();
    db.prepare(`
      INSERT OR IGNORE INTO sent_events (chat_id, game_id, event_type, event_key, message_text)
      VALUES (?, ?, ?, ?, ?)
    `).run(chatId, gameId, eventType, eventKey, messageText);
  }

  // ─── Trivia ─────────────────────────────────────

  async getRandomTrivia(): Promise<TriviaQuestion | null> {
    const db = this.getDb();
    const row = db.prepare('SELECT id, question, answer, category FROM trivia ORDER BY RANDOM() LIMIT 1').get() as TriviaRow | undefined;
    if (!row) return null;

    db.prepare("UPDATE trivia SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
    return rowToTrivia(row);
  }

  async seedTrivia(items: Array<{ question: string; answer: string; category: string }>): Promise<number> {
    const db = this.getDb();
    const stmt = db.prepare(
      'INSERT OR IGNORE INTO trivia (question, answer, category) VALUES (?, ?, ?)',
    );
    let count = 0;
    const insertMany = db.transaction((rows: typeof items) => {
      for (const item of rows) {
        const result = stmt.run(item.question, item.answer, item.category);
        if (result.changes > 0) count++;
      }
    });
    insertMany(items);
    return count;
  }
}
