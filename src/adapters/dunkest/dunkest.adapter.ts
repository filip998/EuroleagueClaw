import type { FantasyPort } from '../../ports/fantasy.port.js';
import type { FantasyRoster, FantasyStandings } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

/**
 * Shape of the /leagues/{id}/config response (unverified — only current_matchday.id confirmed).
 */
interface LeagueConfigResponse {
  data?: {
    current_matchday?: { id?: number };
  };
  current_matchday?: { id?: number };
}

/**
 * Roster API response shape is UNVERIFIED.
 * We try multiple plausible field names defensively.
 */
type RosterResponse = Record<string, unknown>;

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

  async getRosters(teamIds: string[]): Promise<FantasyRoster[]> {
    if (teamIds.length === 0) return [];

    const matchdayId = await this.fetchCurrentMatchdayId();
    if (!matchdayId) {
      this.logger.warn('Could not determine current matchday ID, skipping roster fetch');
      return [];
    }

    this.logger.info({ matchdayId, teamCount: teamIds.length }, 'Fetching rosters from Dunkest API');

    const rosters: FantasyRoster[] = [];
    for (const teamId of teamIds) {
      try {
        const roster = await this.fetchTeamRoster(teamId, matchdayId);
        if (roster) rosters.push(roster);
      } catch (err) {
        this.logger.warn({ teamId, error: String(err) }, 'Failed to fetch roster for team');
      }
    }

    return rosters;
  }

  private async fetchCurrentMatchdayId(): Promise<number | null> {
    try {
      const data = await this.fetchJsonPublic<LeagueConfigResponse>(
        `${this.apiBase}/leagues/10/config`,
      );

      // Try multiple response shapes
      const matchdayId = data?.data?.current_matchday?.id
        ?? data?.current_matchday?.id
        ?? (data as Record<string, unknown>)?.currentMatchdayId;

      if (typeof matchdayId === 'number' && matchdayId > 0) {
        this.logger.debug({ matchdayId }, 'Current matchday ID resolved');
        return matchdayId;
      }

      this.logger.warn({ responseKeys: Object.keys(data ?? {}) }, 'Could not extract matchday ID from league config');
      return null;
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Failed to fetch league config for matchday');
      return null;
    }
  }

  private async fetchTeamRoster(teamId: string, matchdayId: number): Promise<FantasyRoster | null> {
    const url = `${this.apiBase}/fantasy-teams/${teamId}/matchdays/${matchdayId}/roster`;
    const data = await this.fetchJson<RosterResponse>(url);

    this.logger.debug(
      { teamId, responseKeys: data ? Object.keys(data) : 'null' },
      'Raw roster response structure',
    );

    return this.parseRosterResponse(data, teamId);
  }

  /**
   * Parse roster response defensively — response shape is UNVERIFIED.
   * Tries multiple plausible field names for players, names, and teams.
   */
  private parseRosterResponse(data: unknown, teamId: string): FantasyRoster | null {
    if (!data || typeof data !== 'object') return null;

    const obj = data as Record<string, unknown>;

    // Try to extract owner/team name
    const ownerName = this.extractString(obj,
      'team_name', 'teamName', 'name', 'owner_name', 'ownerName',
      'fantasy_team_name', 'fantasyTeamName', 'user_name', 'userName',
    ) ?? `Team ${teamId}`;

    // Try to find player array in multiple response shapes
    const playersRaw = this.extractArray(obj,
      'roster', 'players', 'lineup', 'starters', 'squad',
    )
      ?? (obj.data && typeof obj.data === 'object'
        ? this.extractArray(obj.data as Record<string, unknown>,
          'roster', 'players', 'lineup', 'starters', 'squad',
        )
        : null)
      ?? (Array.isArray(data) ? data as unknown[] : null);

    if (!playersRaw || playersRaw.length === 0) {
      this.logger.warn(
        { teamId, keys: Object.keys(obj) },
        'Could not find player array in roster response',
      );
      return null;
    }

    const players = playersRaw
      .map((p) => this.parsePlayer(p))
      .filter((p): p is { playerName: string; teamCode: string } => p !== null);

    if (players.length === 0) {
      this.logger.warn({ teamId }, 'Roster response had entries but no parseable players');
      return null;
    }

    return { ownerName, players };
  }

  private parsePlayer(raw: unknown): { playerName: string; teamCode: string } | null {
    if (!raw || typeof raw !== 'object') return null;
    const p = raw as Record<string, unknown>;

    // Player might be nested under a "player" key
    const playerObj = (p.player && typeof p.player === 'object')
      ? p.player as Record<string, unknown>
      : p;

    const playerName = this.extractString(playerObj,
      'player_name', 'playerName', 'name', 'full_name', 'fullName',
      'display_name', 'displayName',
    )
      // Try "first_name last_name" composition
      ?? this.composeName(playerObj);

    if (!playerName) return null;

    const teamCode = this.extractString(playerObj,
      'team_code', 'teamCode', 'club_code', 'clubCode',
      'team_abbreviation', 'team_short_name',
    )
      // Try nested team object
      ?? (playerObj.team && typeof playerObj.team === 'object'
        ? this.extractString(playerObj.team as Record<string, unknown>,
          'code', 'abbreviation', 'short_name', 'shortName',
        )
        : null)
      ?? (playerObj.club && typeof playerObj.club === 'object'
        ? this.extractString(playerObj.club as Record<string, unknown>,
          'code', 'abbreviation', 'short_name', 'shortName',
        )
        : null)
      ?? '';

    return { playerName, teamCode };
  }

  /** Extract the first non-empty string from an object by trying multiple keys */
  private extractString(obj: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim().length > 0) return val.trim();
    }
    return null;
  }

  /** Try composing "last_name, first_name" from separate fields */
  private composeName(obj: Record<string, unknown>): string | null {
    const last = this.extractString(obj, 'last_name', 'lastName', 'surname');
    const first = this.extractString(obj, 'first_name', 'firstName');
    if (last && first) return `${last}, ${first}`;
    if (last) return last;
    return null;
  }

  /** Extract the first array found from an object by trying multiple keys */
  private extractArray(obj: Record<string, unknown>, ...keys: string[]): unknown[] | null {
    for (const key of keys) {
      if (Array.isArray(obj[key]) && (obj[key] as unknown[]).length > 0) {
        return obj[key] as unknown[];
      }
    }
    return null;
  }

  /** Fetch JSON from a public endpoint (no auth required) */
  private async fetchJsonPublic<T>(url: string): Promise<T> {
    return withRetry(
      async () => {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
        });

        if (!res.ok) {
          throw new ApiError(`Dunkest API error: ${res.status}`, res.status, url);
        }

        return (await res.json()) as T;
      },
      { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 5000, logger: this.logger },
    );
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
