import type { StatsPort } from '../../ports/stats.port.js';
import type { GameInfo, LiveScore, PlayByPlayEvent, PlayByPlayEventType, TeamInfo } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

/**
 * EuroLeague API adapter.
 * Uses the public v2 API at api-live.euroleague.net/v2/
 */
export class EuroLeagueAdapter implements StatsPort {
  private gamesCache: { data: ELGame[]; fetchedAt: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  async getTodaySchedule(seasonCode: string, competitionCode: string): Promise<GameInfo[]> {
    const games = await this.fetchAllGames(seasonCode, competitionCode || 'E');
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10); // YYYY-MM-DD

    const todayGames = games.filter((g) => {
      const gameDate = (g.utcDate ?? g.date ?? '').slice(0, 10);
      return gameDate === todayStr;
    });

    return todayGames.map((g) => this.mapGameInfo(g, seasonCode));
  }

  async getLiveScore(gameCode: number, seasonCode: string): Promise<LiveScore> {
    const competitionCode = seasonCode.startsWith('U') ? 'U' : 'E';
    const data = await this.fetchJson<ELGameDetail>(
      `v2/competitions/${competitionCode}/seasons/${seasonCode}/games/${gameCode}`,
    );

    if (!data) {
      throw new ApiError('No game data returned', 404, `games/${gameCode}`);
    }

    const game = 'data' in data ? (data as any).data : data;
    const partials = game.local?.partials ?? {};
    const quarter = this.detectQuarter(partials, game.played);

    return {
      gameCode,
      homeScore: game.local?.score ?? 0,
      awayScore: game.road?.score ?? 0,
      quarter,
      clock: '', // v2 API doesn't provide live clock
      status: game.played ? 'finished' : (quarter > 0 ? 'live' : 'scheduled'),
    };
  }

  async getPlayByPlay(
    _gameCode: number,
    _seasonCode: string,
    _sinceEventId?: string | null,
  ): Promise<PlayByPlayEvent[]> {
    // Play-by-play not available in v2 public API
    // Will be implemented when a suitable endpoint is found
    return [];
  }

  async getScoreboard(): Promise<LiveScore[]> {
    // Use the games list and filter to today's games
    const games = await this.fetchAllGames('E2025', 'E');
    const today = new Date().toISOString().slice(0, 10);

    return games
      .filter((g) => (g.utcDate ?? g.date ?? '').slice(0, 10) === today)
      .map((g): LiveScore => ({
        gameCode: g.gameCode,
        homeScore: g.local?.score ?? 0,
        awayScore: g.road?.score ?? 0,
        quarter: this.detectQuarter(g.local?.partials ?? {}, g.played),
        clock: '',
        status: g.played ? 'finished' : 'scheduled',
      }));
  }

  private async fetchAllGames(seasonCode: string, competitionCode: string): Promise<ELGame[]> {
    // Return cached data if fresh enough
    if (this.gamesCache && Date.now() - this.gamesCache.fetchedAt < this.cacheTtlMs) {
      return this.gamesCache.data;
    }

    const data = await this.fetchJson<ELGamesResponse>(
      `v2/competitions/${competitionCode}/seasons/${seasonCode}/games`,
    );

    const games = data?.data ?? [];
    this.gamesCache = { data: games, fetchedAt: Date.now() };
    return games;
  }

  private mapGameInfo(g: ELGame, seasonCode: string): GameInfo {
    return {
      gameCode: g.gameCode,
      seasonCode,
      homeTeam: {
        code: g.local?.club?.code ?? '',
        name: g.local?.club?.name ?? '',
        shortName: g.local?.club?.abbreviatedName ?? g.local?.club?.name ?? '',
      },
      awayTeam: {
        code: g.road?.club?.code ?? '',
        name: g.road?.club?.name ?? '',
        shortName: g.road?.club?.abbreviatedName ?? g.road?.club?.name ?? '',
      },
      status: g.played ? 'finished' : 'scheduled',
      startTime: g.utcDate ?? g.date ?? '',
      venue: g.arena ?? '',
    };
  }

  private detectQuarter(partials: ELPartials, played?: boolean): number {
    if (played) return 4;
    if (partials.partials4) return 4;
    if (partials.partials3) return 3;
    if (partials.partials2) return 2;
    if (partials.partials1) return 1;
    return 0;
  }

  private async fetchJson<T>(endpoint: string): Promise<T | null> {
    const url = `${this.baseUrl}/${endpoint}`;
    this.logger.debug({ url }, 'Fetching EuroLeague API');

    try {
      const response = await withRetry(
        () => fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        }),
        { maxAttempts: 2, baseDelayMs: 1000, logger: this.logger },
      );

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new ApiError(
          `EuroLeague API returned ${response.status}`,
          response.status,
          url,
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.logger.error({ url, error: String(err) }, 'EuroLeague API fetch error');
      throw new ApiError(`Failed to fetch ${endpoint}`, 0, url, err);
    }
  }
}

// ─── EuroLeague v2 API response shapes ───

interface ELClub {
  code: string;
  name: string;
  abbreviatedName?: string;
}

interface ELPartials {
  partials1?: number;
  partials2?: number;
  partials3?: number;
  partials4?: number;
  extraPeriods?: Record<string, number>;
}

interface ELTeamSide {
  club: ELClub;
  score: number;
  partials: ELPartials;
}

interface ELGame {
  gameCode: number;
  played: boolean;
  date: string;
  utcDate?: string;
  local: ELTeamSide;
  road: ELTeamSide;
  arena?: string;
  round?: number;
  roundName?: string;
}

interface ELGamesResponse {
  data: ELGame[];
}

type ELGameDetail = ELGame | { data: ELGame };
