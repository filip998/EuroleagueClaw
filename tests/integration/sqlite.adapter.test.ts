import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../../src/adapters/storage/sqlite.adapter.js';
import type { TrackedGame } from '../../src/domain/types.js';

describe('SQLiteAdapter', () => {
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    adapter = new SQLiteAdapter(':memory:');
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.close();
  });

  // ─── Tracked Games ──────────────────────────────

  const sampleGame: Omit<TrackedGame, 'createdAt' | 'updatedAt'> = {
    id: 'game-1',
    gameCode: 101,
    seasonCode: 'E2025',
    homeTeam: 'BAR',
    awayTeam: 'RMA',
    status: 'live',
    lastScoreHome: 40,
    lastScoreAway: 38,
    lastQuarter: 2,
    lastEventId: null,
    trackedByChatId: 'chat-1',
  };

  it('should add and retrieve a tracked game', async () => {
    await adapter.addTrackedGame(sampleGame);
    const game = await adapter.getTrackedGame('game-1');

    expect(game).not.toBeNull();
    expect(game!.id).toBe('game-1');
    expect(game!.gameCode).toBe(101);
    expect(game!.homeTeam).toBe('BAR');
    expect(game!.awayTeam).toBe('RMA');
    expect(game!.status).toBe('live');
    expect(game!.lastScoreHome).toBe(40);
    expect(game!.lastScoreAway).toBe(38);
    expect(game!.lastQuarter).toBe(2);
    expect(game!.lastEventId).toBeNull();
    expect(game!.trackedByChatId).toBe('chat-1');
    expect(game!.createdAt).toBeDefined();
    expect(game!.updatedAt).toBeDefined();
  });

  it('should return null for non-existent game', async () => {
    const game = await adapter.getTrackedGame('nope');
    expect(game).toBeNull();
  });

  it('should remove a tracked game', async () => {
    await adapter.addTrackedGame(sampleGame);
    await adapter.removeTrackedGame('game-1');
    const game = await adapter.getTrackedGame('game-1');
    expect(game).toBeNull();
  });

  it('should get tracked games by chat', async () => {
    await adapter.addTrackedGame(sampleGame);
    await adapter.addTrackedGame({
      ...sampleGame,
      id: 'game-2',
      gameCode: 102,
      trackedByChatId: 'chat-2',
    });

    const chat1Games = await adapter.getTrackedGamesByChat('chat-1');
    expect(chat1Games).toHaveLength(1);
    expect(chat1Games[0].id).toBe('game-1');

    const chat2Games = await adapter.getTrackedGamesByChat('chat-2');
    expect(chat2Games).toHaveLength(1);
    expect(chat2Games[0].id).toBe('game-2');
  });

  it('should get all tracked games', async () => {
    await adapter.addTrackedGame(sampleGame);
    await adapter.addTrackedGame({ ...sampleGame, id: 'game-2', gameCode: 102 });

    const all = await adapter.getAllTrackedGames();
    expect(all).toHaveLength(2);
  });

  it('should update tracked game with partial updates', async () => {
    await adapter.addTrackedGame(sampleGame);
    await adapter.updateTrackedGame('game-1', {
      lastScoreHome: 55,
      lastScoreAway: 50,
      lastQuarter: 3,
      status: 'live',
    });

    const game = await adapter.getTrackedGame('game-1');
    expect(game!.lastScoreHome).toBe(55);
    expect(game!.lastScoreAway).toBe(50);
    expect(game!.lastQuarter).toBe(3);
    // Unchanged fields preserved
    expect(game!.homeTeam).toBe('BAR');
    expect(game!.awayTeam).toBe('RMA');
  });

  it('should not throw when updating non-existent game', async () => {
    await expect(
      adapter.updateTrackedGame('nope', { lastScoreHome: 10 }),
    ).resolves.toBeUndefined();
  });

  // ─── Chat Subscriptions ─────────────────────────

  it('should create a subscription on first call', async () => {
    const sub = await adapter.getOrCreateSubscription('chat-1', 'telegram');
    expect(sub.chatId).toBe('chat-1');
    expect(sub.chatPlatform).toBe('telegram');
    expect(sub.isActive).toBe(true);
    expect(sub.mutedUntil).toBeNull();
    expect(sub.fantasyEnabled).toBe(false);
    expect(sub.triviaEnabled).toBe(true);
    expect(sub.createdAt).toBeDefined();
  });

  it('should return existing subscription on second call (idempotent)', async () => {
    const first = await adapter.getOrCreateSubscription('chat-1', 'telegram');
    const second = await adapter.getOrCreateSubscription('chat-1', 'telegram');
    expect(first.chatId).toBe(second.chatId);
    expect(first.createdAt).toBe(second.createdAt);
  });

  it('should update subscription fields', async () => {
    await adapter.getOrCreateSubscription('chat-1', 'telegram');
    await adapter.updateSubscription('chat-1', {
      isActive: false,
      fantasyEnabled: true,
    });

    const sub = await adapter.getOrCreateSubscription('chat-1', 'telegram');
    expect(sub.isActive).toBe(false);
    expect(sub.fantasyEnabled).toBe(true);
    // Unchanged
    expect(sub.triviaEnabled).toBe(true);
  });

  // ─── Sent Events (dedup) ────────────────────────

  it('should track sent events', async () => {
    const sent = await adapter.hasEventBeenSent('chat-1', 'evt-1');
    expect(sent).toBe(false);

    await adapter.markEventSent('chat-1', 'game-1', 'score_change', 'evt-1', 'Score!');

    const sentAfter = await adapter.hasEventBeenSent('chat-1', 'evt-1');
    expect(sentAfter).toBe(true);
  });

  it('should handle duplicate markEventSent gracefully (INSERT OR IGNORE)', async () => {
    await adapter.markEventSent('chat-1', 'game-1', 'score_change', 'evt-1', 'Score!');
    await expect(
      adapter.markEventSent('chat-1', 'game-1', 'score_change', 'evt-1', 'Score again!'),
    ).resolves.toBeUndefined();

    // Still reports as sent
    const sent = await adapter.hasEventBeenSent('chat-1', 'evt-1');
    expect(sent).toBe(true);
  });

  it('should isolate events by chat', async () => {
    await adapter.markEventSent('chat-1', 'game-1', 'score_change', 'evt-1', 'Score!');

    expect(await adapter.hasEventBeenSent('chat-1', 'evt-1')).toBe(true);
    expect(await adapter.hasEventBeenSent('chat-2', 'evt-1')).toBe(false);
  });

  it('should handle null gameId', async () => {
    await expect(
      adapter.markEventSent('chat-1', null, 'system', 'sys-1', 'System msg'),
    ).resolves.toBeUndefined();

    expect(await adapter.hasEventBeenSent('chat-1', 'sys-1')).toBe(true);
  });

  // ─── Trivia ─────────────────────────────────────

  it('should return null when no trivia exists', async () => {
    const trivia = await adapter.getRandomTrivia();
    expect(trivia).toBeNull();
  });

  // ─── Lifecycle ──────────────────────────────────

  it('should throw when using db before initialize', async () => {
    const uninitAdapter = new SQLiteAdapter(':memory:');
    await expect(uninitAdapter.getTrackedGame('x')).rejects.toThrow('Database not initialized');
    // No need to close since it was never initialized
  });
});
