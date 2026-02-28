import type { FantasyPort } from '../../ports/fantasy.port.js';
import type { FantasyStandings } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

/**
 * Dunkest/Fantaking API adapter for fantasy league data.
 * Designed defensively — unknown API structure is handled gracefully.
 */
export class DunkestAdapter implements FantasyPort {
  constructor(
    private readonly apiBase: string,
    private readonly bearerToken: string,
    private readonly logger: Logger,
  ) {}

  async getStandings(): Promise<FantasyStandings> {
    const endpoints = [
      `${this.apiBase}/rankings`,
      `${this.apiBase}/leagues/me/rankings`,
    ];

    for (const url of endpoints) {
      try {
        const data = await this.fetchJson<unknown>(url);
        const parsed = this.parseStandings(data);
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn({ url, error: String(err) }, 'Dunkest standings endpoint failed');
      }
    }

    this.logger.warn('All Dunkest standings endpoints failed, returning empty standings');
    return { roundNumber: 0, roundName: 'Unknown', entries: [] };
  }

  async getCurrentRound(): Promise<{ roundNumber: number; roundName: string; isActive: boolean }> {
    const endpoints = [
      `${this.apiBase}/rounds/current`,
      `${this.apiBase}/rounds/latest`,
    ];

    for (const url of endpoints) {
      try {
        const data = await this.fetchJson<Record<string, unknown>>(url);
        if (data && typeof data === 'object') {
          return {
            roundNumber: typeof data.round === 'number' ? data.round
              : typeof data.number === 'number' ? data.number
              : typeof data.id === 'number' ? data.id : 0,
            roundName: typeof data.name === 'string' ? data.name
              : typeof data.round_name === 'string' ? data.round_name
              : `Round ${data.round ?? data.number ?? data.id ?? 0}`,
            isActive: data.active === true || data.is_active === true || data.status === 'active',
          };
        }
      } catch (err) {
        this.logger.warn({ url, error: String(err) }, 'Dunkest round endpoint failed');
      }
    }

    return { roundNumber: 0, roundName: 'Unknown', isActive: false };
  }

  private async fetchJson<T>(url: string): Promise<T> {
    return withRetry(
      async () => {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.bearerToken}`,
            Accept: 'application/json',
          },
        });

        if (!res.ok) {
          throw new ApiError(`Dunkest API error: ${res.status}`, res.status, url);
        }

        return (await res.json()) as T;
      },
      { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 5000, logger: this.logger },
    );
  }

  private parseStandings(data: unknown): FantasyStandings | null {
    if (!data || typeof data !== 'object') return null;

    const obj = data as Record<string, unknown>;

    // Try to find an array of entries in common response shapes
    const entriesRaw = Array.isArray(obj.rankings) ? obj.rankings
      : Array.isArray(obj.data) ? obj.data
      : Array.isArray(obj.standings) ? obj.standings
      : Array.isArray(obj.entries) ? obj.entries
      : Array.isArray(data) ? data as unknown[]
      : null;

    if (!entriesRaw) return null;

    const entries = entriesRaw.map((e: unknown, i: number) => {
      const entry = e as Record<string, unknown>;
      return {
        rank: typeof entry.rank === 'number' ? entry.rank
          : typeof entry.position === 'number' ? entry.position
          : i + 1,
        teamName: String(entry.team_name ?? entry.teamName ?? entry.name ?? 'Unknown'),
        ownerName: String(entry.owner_name ?? entry.ownerName ?? entry.user ?? entry.owner ?? 'Unknown'),
        totalPoints: Number(entry.total_points ?? entry.totalPoints ?? entry.points ?? 0),
        roundPoints: Number(entry.round_points ?? entry.roundPoints ?? entry.day_points ?? 0),
      };
    });

    return {
      roundNumber: typeof obj.round === 'number' ? obj.round
        : typeof obj.round_number === 'number' ? obj.round_number : 0,
      roundName: typeof obj.round_name === 'string' ? obj.round_name
        : typeof obj.roundName === 'string' ? obj.roundName
        : `Round ${obj.round ?? obj.round_number ?? 0}`,
      entries,
    };
  }
}
