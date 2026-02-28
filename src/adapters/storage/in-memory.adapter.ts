import type { StoragePort } from '../../ports/storage.port.js';
import type { TrackedGame, ChatSubscription, TriviaQuestion } from '../../domain/types.js';

/**
 * In-memory storage adapter for Phase 1 development.
 * Will be replaced by SQLite in Phase 2.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private trackedGames = new Map<string, TrackedGame>();
  private subscriptions = new Map<string, ChatSubscription>();
  private sentEvents = new Set<string>(); // "chatId:eventKey"
  private triviaItems: TriviaQuestion[] = [];

  async initialize(): Promise<void> {
    // No-op for in-memory
  }

  async close(): Promise<void> {
    this.trackedGames.clear();
    this.subscriptions.clear();
    this.sentEvents.clear();
  }

  // ─── Tracked Games ──────────────────────────────

  async addTrackedGame(game: Omit<TrackedGame, 'createdAt' | 'updatedAt'>): Promise<void> {
    const now = new Date().toISOString();
    this.trackedGames.set(game.id, { ...game, createdAt: now, updatedAt: now });
  }

  async removeTrackedGame(id: string): Promise<void> {
    this.trackedGames.delete(id);
  }

  async getTrackedGame(id: string): Promise<TrackedGame | null> {
    return this.trackedGames.get(id) ?? null;
  }

  async getTrackedGamesByChat(chatId: string): Promise<TrackedGame[]> {
    return Array.from(this.trackedGames.values()).filter(
      (g) => g.trackedByChatId === chatId,
    );
  }

  async getAllTrackedGames(): Promise<TrackedGame[]> {
    return Array.from(this.trackedGames.values());
  }

  async updateTrackedGame(id: string, updates: Partial<TrackedGame>): Promise<void> {
    const game = this.trackedGames.get(id);
    if (!game) return;
    this.trackedGames.set(id, {
      ...game,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  // ─── Chat Subscriptions ─────────────────────────

  async getOrCreateSubscription(chatId: string, platform: string): Promise<ChatSubscription> {
    let sub = this.subscriptions.get(chatId);
    if (!sub) {
      sub = {
        chatId,
        chatPlatform: platform,
        isActive: true,
        mutedUntil: null,
        fantasyEnabled: false,
        triviaEnabled: true,
        createdAt: new Date().toISOString(),
      };
      this.subscriptions.set(chatId, sub);
    }
    return sub;
  }

  async updateSubscription(chatId: string, updates: Partial<ChatSubscription>): Promise<void> {
    const sub = this.subscriptions.get(chatId);
    if (sub) {
      this.subscriptions.set(chatId, { ...sub, ...updates });
    }
  }

  // ─── Sent Events ────────────────────────────────

  async hasEventBeenSent(chatId: string, eventKey: string): Promise<boolean> {
    return this.sentEvents.has(`${chatId}:${eventKey}`);
  }

  async markEventSent(
    chatId: string,
    _gameId: string | null,
    _eventType: string,
    eventKey: string,
    _messageText: string,
  ): Promise<void> {
    this.sentEvents.add(`${chatId}:${eventKey}`);
  }

  // ─── Trivia ─────────────────────────────────────

  async getRandomTrivia(): Promise<TriviaQuestion | null> {
    if (this.triviaItems.length === 0) return null;
    const idx = Math.floor(Math.random() * this.triviaItems.length);
    return this.triviaItems[idx]!;
  }

  async seedTrivia(items: Array<{ question: string; answer: string; category: string }>): Promise<number> {
    const existing = new Set(this.triviaItems.map((t) => t.question));
    let count = 0;
    for (const item of items) {
      if (!existing.has(item.question)) {
        this.triviaItems.push({
          id: this.triviaItems.length + 1,
          question: item.question,
          answer: item.answer,
          category: item.category,
        });
        existing.add(item.question);
        count++;
      }
    }
    return count;
  }
}
