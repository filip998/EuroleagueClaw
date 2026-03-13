import type { GameEvent } from './types.js';
import { getEventPriority } from './types.js';
import type { Logger } from '../shared/logger.js';

interface ThrottleConfig {
  windowSeconds: number;
  maxMessagesPerMinute: number;
}

interface QueuedEvent {
  chatId: string;
  event: GameEvent;
  queuedAt: number;
}

export class ThrottleManager {
  private sentTimestamps = new Map<string, number[]>();
  private eventQueue: QueuedEvent[] = [];
  private mutedChats = new Map<string, number>(); // chatId -> muted until (epoch ms)

  constructor(
    private readonly config: ThrottleConfig,
    private readonly logger: Logger,
  ) {}

  /** Check if a chat is currently muted */
  isMuted(chatId: string): boolean {
    const mutedUntil = this.mutedChats.get(chatId);
    if (!mutedUntil) return false;
    if (Date.now() >= mutedUntil) {
      this.mutedChats.delete(chatId);
      return false;
    }
    return true;
  }

  /** Mute a chat for N minutes */
  mute(chatId: string, minutes: number): void {
    this.mutedChats.set(chatId, Date.now() + minutes * 60 * 1000);
    this.logger.info({ chatId, minutes }, 'Chat muted');
  }

  /** Unmute a chat */
  unmute(chatId: string): void {
    this.mutedChats.delete(chatId);
    this.logger.info({ chatId }, 'Chat unmuted');
  }

  /**
   * Decide whether an event should be sent now, queued, or dropped.
   * Returns true if the event should be sent immediately.
   */
  shouldSend(chatId: string, event: GameEvent): boolean {
    const priority = getEventPriority(event);

    // Critical events always go through (even when muted)
    if (priority === 'critical') return true;

    // If muted, queue non-critical events
    if (this.isMuted(chatId)) {
      this.eventQueue.push({ chatId, event, queuedAt: Date.now() });
      return false;
    }

    // High priority events go through if under rate limit
    if (priority === 'high') {
      return this.isUnderRateLimit(chatId);
    }

    // Normal/low priority: check both rate limit and throttle window
    if (!this.isUnderRateLimit(chatId)) return false;
    if (!this.isOutsideWindow(chatId, event)) {
      this.eventQueue.push({ chatId, event, queuedAt: Date.now() });
      return false;
    }

    return true;
  }

  /** Record that a message was sent to a chat */
  recordSent(chatId: string): void {
    const now = Date.now();
    const timestamps = this.sentTimestamps.get(chatId) ?? [];
    timestamps.push(now);

    // Keep only timestamps from the last minute
    const oneMinuteAgo = now - 60_000;
    const filtered = timestamps.filter((t) => t > oneMinuteAgo);
    this.sentTimestamps.set(chatId, filtered);
  }

  /** Get queued events for a chat (e.g., when unmuted) and clear them */
  drainQueue(chatId: string): QueuedEvent[] {
    const events = this.eventQueue.filter((e) => e.chatId === chatId);
    this.eventQueue = this.eventQueue.filter((e) => e.chatId !== chatId);
    return events;
  }

  /** Flush old events from the queue */
  cleanupQueue(maxAgeMs: number = 300_000): void {
    const cutoff = Date.now() - maxAgeMs;
    this.eventQueue = this.eventQueue.filter((e) => e.queuedAt > cutoff);
  }

  private isUnderRateLimit(chatId: string): boolean {
    const timestamps = this.sentTimestamps.get(chatId) ?? [];
    const oneMinuteAgo = Date.now() - 60_000;
    const recentCount = timestamps.filter((t) => t > oneMinuteAgo).length;
    return recentCount < this.config.maxMessagesPerMinute;
  }

  private isOutsideWindow(chatId: string, _event: GameEvent): boolean {
    const timestamps = this.sentTimestamps.get(chatId) ?? [];
    if (timestamps.length === 0) return true;

    const lastSent = timestamps[timestamps.length - 1]!;
    return Date.now() - lastSent > this.config.windowSeconds * 1000;
  }
}
