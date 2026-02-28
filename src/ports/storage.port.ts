import type {
  TrackedGame,
  ChatSubscription,
  TriviaQuestion,
} from '../domain/types.js';

/**
 * Port for persistent storage.
 * Adapters: SQLite, in-memory, etc.
 */
export interface StoragePort {
  // ─── Tracked Games ──────────────────────────────
  addTrackedGame(game: Omit<TrackedGame, 'createdAt' | 'updatedAt'>): Promise<void>;
  removeTrackedGame(id: string): Promise<void>;
  getTrackedGame(id: string): Promise<TrackedGame | null>;
  getTrackedGamesByChat(chatId: string): Promise<TrackedGame[]>;
  getAllTrackedGames(): Promise<TrackedGame[]>;
  updateTrackedGame(id: string, updates: Partial<TrackedGame>): Promise<void>;

  // ─── Chat Subscriptions ─────────────────────────
  getOrCreateSubscription(chatId: string, platform: string): Promise<ChatSubscription>;
  updateSubscription(chatId: string, updates: Partial<ChatSubscription>): Promise<void>;

  // ─── Sent Events (dedup) ────────────────────────
  hasEventBeenSent(chatId: string, eventKey: string): Promise<boolean>;
  markEventSent(chatId: string, gameId: string | null, eventType: string, eventKey: string, messageText: string): Promise<void>;

  // ─── Trivia ─────────────────────────────────────
  getRandomTrivia(): Promise<TriviaQuestion | null>;

  // ─── Lifecycle ──────────────────────────────────
  initialize(): Promise<void>;
  close(): Promise<void>;
}
