import { Agent } from 'undici';
import type { StatsPort } from '../../ports/stats.port.js';
import type { GameInfo, LiveScore, PlayByPlayEvent, PlayByPlayEventType, TeamInfo, RoundSchedule, RoundGame } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

/** Separate base URL for the Play-by-Play API (different service from v2) */
const PBP_API_BASE = 'https://live.euroleague.net/api';

const PLAY_TYPE_MAP: Record<string, PlayByPlayEventType> = {
  '2FGM': 'two_pointer_made',
  '2FGA': 'two_pointer_missed',
  '3FGM': 'three_pointer_made',
  '3FGA': 'three_pointer_missed',
  'FTM': 'free_throw_made',
  'FTA': 'free_throw_missed',
  'D': 'rebound',
  'O': 'rebound',
  'AS': 'assist',
  'ST': 'steal',
  'BLK': 'block',
  'FV': 'block',
  'TO': 'turnover',
  'CM': 'foul',
  'CMU': 'foul',
  'CMT': 'foul',
  'C': 'foul',
  'TOUT': 'timeout',
  'TV': 'timeout',
  'IN': 'substitution',
  'OUT': 'substitution',
  'BP': 'quarter_start',
  'EP': 'quarter_end',
};

function mapPlayType(playType: string | undefined): PlayByPlayEventType {
  if (!playType) return 'unknown';
  return PLAY_TYPE_MAP[playType.trim()] ?? 'unknown';
}

/**
 * EuroLeague API adapter.
 * Uses the public v2 API at api-live.euroleague.net/v2/
 */
/** Keep-alive agent options shared by both API hosts */
const KEEP_ALIVE_OPTS = {
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  connections: 4,
  pipelining: 1,
} as const;

export class EuroLeagueAdapter implements StatsPort {
  private gamesCache: { data: ELGame[]; fetchedAt: number } | null = null;
  private readonly cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  /** Keep-alive agent for the v2 API (api-live.euroleague.net) */
  private readonly v2Agent: Agent;
  /** Keep-alive agent for the PBP API (live.euroleague.net) */
  private readonly pbpAgent: Agent;

  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {
    this.v2Agent = new Agent(KEEP_ALIVE_OPTS);
    this.pbpAgent = new Agent(KEEP_ALIVE_OPTS);
  }

  /** Close HTTP keep-alive agents. Call on shutdown to prevent socket leaks. */
  async close(): Promise<void> {
    await Promise.all([this.v2Agent.close(), this.pbpAgent.close()]);
    this.logger.info('EuroLeague HTTP agents closed');
  }

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
    gameCode: number,
    seasonCode: string,
    sinceEventId?: string | null,
  ): Promise<PlayByPlayEvent[]> {
    const url = `${PBP_API_BASE}/PlaybyPlay?gamecode=${gameCode}&seasoncode=${seasonCode}`;
    this.logger.debug({ url }, 'Fetching PBP API');

    let data: PBPResponse | null;
    try {
      const response = await withRetry(
        () => fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
          dispatcher: this.pbpAgent,
        } as RequestInit),
        { maxAttempts: 2, baseDelayMs: 1000, logger: this.logger },
      );

      if (!response.ok) {
        if (response.status === 404) return [];
        throw new ApiError(`PBP API returned ${response.status}`, response.status, url);
      }

      data = (await response.json()) as PBPResponse;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      this.logger.error({ url, error: String(err) }, 'PBP API fetch error');
      throw new ApiError(`Failed to fetch PBP`, 0, url, err);
    }

    if (!data) return [];

    const quarters: [string, PBPRawEvent[]][] = [
      ['FirstQuarter', data.FirstQuarter ?? []],
      ['SecondQuarter', data.SecondQuarter ?? []],
      ['ThirdQuarter', data.ThirdQuarter ?? []],
      ['ForthQuarter', data.ForthQuarter ?? []],
      ['ExtraTime', data.ExtraTime ?? []],
    ];

    const events: PlayByPlayEvent[] = [];
    let lastHomeScore = 0;
    let lastAwayScore = 0;

    for (let qi = 0; qi < quarters.length; qi++) {
      const quarter = qi + 1;
      const rawEvents = quarters[qi][1];

      for (const raw of rawEvents) {
        if (raw.POINTS_A != null) lastHomeScore = raw.POINTS_A;
        if (raw.POINTS_B != null) lastAwayScore = raw.POINTS_B;

        events.push({
          eventId: String(raw.NUMBEROFPLAY),
          gameCode,
          quarter,
          clock: (raw.MARKERTIME ?? '').trim(),
          teamCode: (raw.CODETEAM ?? '').trim(),
          playerName: (raw.PLAYER ?? '').trim(),
          eventType: mapPlayType(raw.PLAYTYPE),
          description: (raw.PLAYINFO ?? '').trim(),
          homeScore: lastHomeScore,
          awayScore: lastAwayScore,
        });
      }
    }

    if (sinceEventId) {
      const sinceId = parseInt(sinceEventId, 10);
      return events.filter((e) => parseInt(e.eventId, 10) > sinceId);
    }

    return events;
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

  async getCurrentRoundGames(seasonCode: string, competitionCode: string): Promise<RoundSchedule> {
    const comp = competitionCode || 'E';
    const rounds = await this.fetchRounds(seasonCode, comp);
    const allGames = await this.fetchAllGames(seasonCode, comp);
    const currentRound = this.findCurrentRound(rounds, allGames);

    if (!currentRound) {
      return { roundNumber: 0, roundName: 'Unknown', games: [] };
    }

    const roundGames = allGames
      .filter((g) => g.round === currentRound.round)
      .sort((a, b) => (a.utcDate ?? a.date ?? '').localeCompare(b.utcDate ?? b.date ?? ''));

    return {
      roundNumber: currentRound.round,
      roundName: currentRound.name,
      games: roundGames.map((g): RoundGame => ({
        gameCode: g.gameCode,
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
        homeScore: g.local?.score ?? 0,
        awayScore: g.road?.score ?? 0,
      })),
    };
  }

  private async fetchRounds(seasonCode: string, competitionCode: string): Promise<ELRound[]> {
    const data = await this.fetchJson<ELRoundsResponse>(
      `v2/competitions/${competitionCode}/seasons/${seasonCode}/rounds`,
    );
    return data?.data ?? [];
  }

  private findCurrentRound(rounds: ELRound[], allGames: ELGame[]): ELRound | undefined {
    if (rounds.length === 0) return undefined;
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const sorted = [...rounds].sort((a, b) => a.round - b.round);

    // Find a round whose date range contains today
    const active = rounds.find((r) => {
      const start = new Date(r.minGameStartDate);
      const end = new Date(r.maxGameStartDate);
      return now >= start && now <= end;
    });

    // Pick a candidate: active round, or most recent past round, or next upcoming
    let candidate = active;
    if (!candidate) {
      const mostRecentPast = [...sorted].reverse().find((r) => new Date(r.maxGameStartDate) < now);
      const nextUpcoming = sorted.find((r) => new Date(r.minGameStartDate) > now);
      candidate = mostRecentPast ?? nextUpcoming ?? sorted[0];
    }

    if (!candidate) return undefined;

    // If ALL games in the candidate round are finished and the last actual
    // game date was before today, advance to the next upcoming round.
    // We check real game dates, not round metadata (which can be wider).
    const candidateGames = allGames.filter((g) => g.round === candidate!.round);
    const allPlayed = candidateGames.length > 0 && candidateGames.every((g) => g.played);
    const lastGameDate = candidateGames.reduce((max, g) => {
      const d = (g.utcDate ?? g.date ?? '').slice(0, 10);
      return d > max ? d : max;
    }, '');

    if (allPlayed && lastGameDate < todayStr) {
      const nextRound = sorted.find((r) => r.round > candidate!.round);
      if (nextRound) return nextRound;
    }

    return candidate;
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
          dispatcher: this.v2Agent,
        } as RequestInit),
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

interface ELRound {
  round: number;
  name: string;
  minGameStartDate: string;
  maxGameStartDate: string;
}

interface ELRoundsResponse {
  data: ELRound[];
}

type ELGameDetail = ELGame | { data: ELGame };

// ─── PBP API response shapes ─────────────────────────

interface PBPRawEvent {
  NUMBEROFPLAY: number;
  CODETEAM: string;
  PLAYER_ID: string;
  PLAYTYPE: string;
  PLAYER: string;
  TEAM: string;
  DORSAL: string;
  MINUTE: number;
  MARKERTIME: string;
  POINTS_A: number | null;
  POINTS_B: number | null;
  PLAYINFO: string;
  COMMENT: string;
}

interface PBPResponse {
  Live: boolean;
  TeamA: string;
  TeamB: string;
  CodeTeamA: string;
  CodeTeamB: string;
  ActualQuarter: number;
  FirstQuarter: PBPRawEvent[];
  SecondQuarter: PBPRawEvent[];
  ThirdQuarter: PBPRawEvent[];
  ForthQuarter: PBPRawEvent[];
  ExtraTime: PBPRawEvent[];
}
