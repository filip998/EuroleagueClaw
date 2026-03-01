import type { FantasyPort } from '../../ports/fantasy.port.js';
import type { FantasyStandings, RosteredPlayer, RosterFetchResult } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

interface LeagueConfigResponse {
  data?: {
    current_matchday?: { id?: number; number?: number };
  };
  current_matchday?: { id?: number; number?: number };
}

interface RosterResponse {
  data?: {
    players?: RosterPlayer[];
  };
}

interface RosterPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position?: { id: number; name: string };
  team?: { id: number; name: string; abbreviation: string; position?: string };
  opponent?: { id: number; name: string; abbreviation: string };
  quotation?: number;
  pts?: number;
  court_position?: number;
  is_captain?: boolean;
  is_on_fire?: boolean;
  jersey?: string;
}

interface FantasyTeamsResponse {
  data?: Array<{
    id: number;
    name: string;
  }>;
}

/**
 * Dunkest/Fantaking API adapter for fantasy league data.
 * API structure verified with real endpoints and responses.
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

  async getRosters(teamIds: string[]): Promise<RosterFetchResult> {
    if (teamIds.length === 0) return { matchdayNumber: 0, rosters: [] };

    const matchday = await this.fetchCurrentMatchday();
    if (!matchday) {
      this.logger.warn('Could not determine current matchday, skipping roster fetch');
      return { matchdayNumber: 0, rosters: [] };
    }

    const teamNames = await this.fetchTeamNames();

    this.logger.info(
      { matchdayId: matchday.id, matchdayNumber: matchday.number, teamCount: teamIds.length },
      'Fetching rosters from Dunkest API',
    );

    const rosters: import('../../domain/types.js').FantasyRoster[] = [];
    for (const teamId of teamIds) {
      try {
        const teamName = teamNames.get(teamId) ?? `Team ${teamId}`;
        const roster = await this.fetchTeamRoster(teamId, matchday.id, teamName);
        if (roster) rosters.push(roster);
      } catch (err) {
        this.logger.warn({ teamId, error: String(err) }, 'Failed to fetch roster for team');
      }
    }

    return { matchdayNumber: matchday.number, rosters };
  }

  private async fetchCurrentMatchday(): Promise<{ id: number; number: number } | null> {
    try {
      const data = await this.fetchJsonPublic<LeagueConfigResponse>(
        `${this.apiBase}/leagues/10/config`,
      );

      const matchday = data?.data?.current_matchday ?? data?.current_matchday;
      const id = matchday?.id;
      const num = matchday?.number;

      if (typeof id === 'number' && id > 0) {
        const matchdayNumber = typeof num === 'number' ? num : 0;
        this.logger.debug({ matchdayId: id, matchdayNumber }, 'Current matchday resolved');
        return { id, number: matchdayNumber };
      }

      this.logger.warn({ responseKeys: Object.keys(data ?? {}) }, 'Could not extract matchday from league config');
      return null;
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Failed to fetch league config for matchday');
      return null;
    }
  }

  private async fetchTeamNames(): Promise<Map<string, string>> {
    try {
      const data = await this.fetchJson<FantasyTeamsResponse>(
        `${this.apiBase}/user/fantasy-teams?league=10&game_mode=1`,
      );
      const map = new Map<string, string>();
      if (data?.data && Array.isArray(data.data)) {
        for (const team of data.data) {
          if (team.id && team.name) {
            map.set(String(team.id), team.name);
          }
        }
      }
      return map;
    } catch (err) {
      this.logger.warn({ error: String(err) }, 'Failed to fetch team names');
      return new Map();
    }
  }

  private async fetchTeamRoster(
    teamId: string,
    matchdayId: number,
    teamName: string,
  ): Promise<import('../../domain/types.js').FantasyRoster | null> {
    const url = `${this.apiBase}/fantasy-teams/${teamId}/matchdays/${matchdayId}/roster`;
    const data = await this.fetchJson<RosterResponse>(url);

    this.logger.debug(
      { teamId, responseKeys: data ? Object.keys(data) : 'null' },
      'Raw roster response structure',
    );

    return this.parseRosterResponse(data, teamName);
  }

  private parseRosterResponse(
    data: unknown,
    teamName: string,
  ): import('../../domain/types.js').FantasyRoster | null {
    if (!data || typeof data !== 'object') return null;

    const response = data as RosterResponse;

    if (!response.data?.players || !Array.isArray(response.data.players)) {
      this.logger.warn(
        { teamName, hasData: !!response.data },
        'Invalid roster response structure',
      );
      return null;
    }

    const players = response.data.players
      .map((p) => this.parsePlayer(p))
      .filter((p): p is RosteredPlayer => p !== null);

    if (players.length === 0) {
      this.logger.warn({ teamName }, 'Roster response had entries but no parseable players');
      return null;
    }

    return { ownerName: teamName, players };
  }

  private parsePlayer(p: RosterPlayer): RosteredPlayer | null {
    if (!p) return null;

    const playerName = `${p.last_name}, ${p.first_name}`.trim();
    if (!playerName || playerName === ',') return null;

    return {
      playerName,
      teamCode: p.team?.abbreviation ?? '',
      position: p.position?.name,
      isCaptain: p.is_captain ?? false,
      isOnFire: p.is_on_fire ?? false,
      opponentCode: p.opponent?.abbreviation,
      courtPosition: p.court_position,
      isHome: p.team?.position === 'home',
    };
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
