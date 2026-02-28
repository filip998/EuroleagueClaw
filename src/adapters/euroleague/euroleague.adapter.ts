import type { StatsPort } from '../../ports/stats.port.js';
import type { GameInfo, LiveScore, PlayByPlayEvent, PlayByPlayEventType, TeamInfo } from '../../domain/types.js';
import type { Logger } from '../../shared/logger.js';
import { ApiError } from '../../shared/errors.js';
import { withRetry } from '../../shared/retry.js';

/**
 * EuroLeague Live API adapter.
 * Uses the public (undocumented) endpoints at live.euroleague.net/api/
 */
export class EuroLeagueAdapter implements StatsPort {
  constructor(
    private readonly baseUrl: string,
    private readonly logger: Logger,
  ) {}

  async getTodaySchedule(seasonCode: string, _competitionCode: string): Promise<GameInfo[]> {
    const data = await this.fetchJson<ELScoreboard>('Scoreboard');
    if (!data || !Array.isArray(data.games)) return [];

    return data.games.map((g): GameInfo => ({
      gameCode: g.gameCode,
      seasonCode,
      homeTeam: this.parseTeam(g.homeTeam, g.homeCode, g.homeShortName),
      awayTeam: this.parseTeam(g.awayTeam, g.awayCode, g.awayShortName),
      status: this.mapStatus(g.status),
      startTime: g.startTime ?? g.date ?? '',
      venue: g.arena,
    }));
  }

  async getLiveScore(gameCode: number, seasonCode: string): Promise<LiveScore> {
    const data = await this.fetchJson<ELHeader>(
      `Header?gamecode=${gameCode}&seasoncode=${seasonCode}`,
    );

    if (!data) {
      throw new ApiError('No header data returned', 404, `Header?gamecode=${gameCode}`);
    }

    return {
      gameCode,
      homeScore: data.homeScore ?? data.localScore ?? 0,
      awayScore: data.awayScore ?? data.roadScore ?? 0,
      quarter: data.quarter ?? data.period ?? 0,
      clock: data.clock ?? data.time ?? '',
      status: this.mapStatus(data.status),
    };
  }

  async getPlayByPlay(
    gameCode: number,
    seasonCode: string,
    sinceEventId?: string | null,
  ): Promise<PlayByPlayEvent[]> {
    const data = await this.fetchJson<ELPlayByPlay>(
      `PlaybyPlay?gamecode=${gameCode}&seasoncode=${seasonCode}`,
    );

    if (!data) return [];

    const allEvents: PlayByPlayEvent[] = [];
    const quarters = [
      data.firstQuarter,
      data.secondQuarter,
      data.thirdQuarter,
      data.fourthQuarter,
      data.extraPeriod,
    ].filter(Boolean);

    for (const [qIndex, quarter] of quarters.entries()) {
      if (!Array.isArray(quarter)) continue;
      for (const play of quarter) {
        allEvents.push({
          eventId: `${gameCode}-${qIndex + 1}-${play.numberPlay ?? play.NUMBEROFPLAY ?? allEvents.length}`,
          gameCode,
          quarter: qIndex + 1,
          clock: play.markerTime ?? play.MARKERTIME ?? '',
          teamCode: play.teamCode ?? play.CODETEAM ?? '',
          playerName: play.playerName ?? play.PLAYER ?? '',
          eventType: this.mapEventType(play.playType ?? play.PLAYTYPE ?? ''),
          description: play.comment ?? play.COMMENT ?? play.playInfo ?? play.PLAYINFO ?? '',
          homeScore: play.homeScore ?? play.POINTS_A ?? 0,
          awayScore: play.awayScore ?? play.POINTS_B ?? 0,
        });
      }
    }

    // Filter events since the given event ID
    if (sinceEventId) {
      const idx = allEvents.findIndex((e) => e.eventId === sinceEventId);
      if (idx >= 0) return allEvents.slice(idx + 1);
    }

    return allEvents;
  }

  async getScoreboard(): Promise<LiveScore[]> {
    const data = await this.fetchJson<ELScoreboard>('Scoreboard');
    if (!data || !Array.isArray(data.games)) return [];

    return data.games.map((g): LiveScore => ({
      gameCode: g.gameCode,
      homeScore: g.homeScore ?? 0,
      awayScore: g.awayScore ?? 0,
      quarter: g.quarter ?? 0,
      clock: g.clock ?? '',
      status: this.mapStatus(g.status),
    }));
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

  private parseTeam(name: string, code: string, shortName?: string): TeamInfo {
    return {
      code: code ?? '',
      name: name ?? '',
      shortName: shortName ?? name ?? '',
    };
  }

  private mapStatus(status: string | number | undefined): 'scheduled' | 'live' | 'finished' | 'postponed' {
    if (!status) return 'scheduled';
    const s = String(status).toLowerCase();
    if (s === 'live' || s === '2' || s === 'playing') return 'live';
    if (s === 'result' || s === '4' || s === 'finished' || s === 'end') return 'finished';
    if (s === 'postponed' || s === '5') return 'postponed';
    return 'scheduled';
  }

  private mapEventType(playType: string): PlayByPlayEventType {
    const t = playType.toLowerCase();
    if (t.includes('2fg') && t.includes('in')) return 'two_pointer_made';
    if (t.includes('2fg') && t.includes('out')) return 'two_pointer_missed';
    if (t.includes('3fg') && t.includes('in')) return 'three_pointer_made';
    if (t.includes('3fg') && t.includes('out')) return 'three_pointer_missed';
    if (t.includes('ft') && t.includes('in')) return 'free_throw_made';
    if (t.includes('ft') && t.includes('out')) return 'free_throw_missed';
    if (t.includes('reb') || t.includes('d ') || t.includes('o ')) return 'rebound';
    if (t.includes('as')) return 'assist';
    if (t.includes('st')) return 'steal';
    if (t.includes('block') || t.includes('bl')) return 'block';
    if (t.includes('to') || t.includes('turnover')) return 'turnover';
    if (t.includes('foul') || t.includes('cm') || t.includes('rv')) return 'foul';
    if (t.includes('timeout')) return 'timeout';
    if (t.includes('sub') || t.includes('in') || t.includes('out')) return 'substitution';
    if (t.includes('begin') || t.includes('start')) return 'quarter_start';
    if (t.includes('end')) return 'quarter_end';
    return 'unknown';
  }
}

// ─── EuroLeague API response shapes (loose, since undocumented) ───

interface ELScoreboard {
  games: Array<{
    gameCode: number;
    homeTeam: string;
    homeCode: string;
    homeShortName?: string;
    homeScore?: number;
    awayTeam: string;
    awayCode: string;
    awayShortName?: string;
    awayScore?: number;
    status: string;
    quarter?: number;
    clock?: string;
    startTime?: string;
    date?: string;
    arena?: string;
  }>;
}

interface ELHeader {
  homeScore?: number;
  awayScore?: number;
  localScore?: number;
  roadScore?: number;
  quarter?: number;
  period?: number;
  clock?: string;
  time?: string;
  status: string;
}

interface ELPlay {
  numberPlay?: number;
  NUMBEROFPLAY?: number;
  markerTime?: string;
  MARKERTIME?: string;
  teamCode?: string;
  CODETEAM?: string;
  playerName?: string;
  PLAYER?: string;
  playType?: string;
  PLAYTYPE?: string;
  comment?: string;
  COMMENT?: string;
  playInfo?: string;
  PLAYINFO?: string;
  homeScore?: number;
  awayScore?: number;
  POINTS_A?: number;
  POINTS_B?: number;
}

interface ELPlayByPlay {
  firstQuarter?: ELPlay[];
  secondQuarter?: ELPlay[];
  thirdQuarter?: ELPlay[];
  fourthQuarter?: ELPlay[];
  extraPeriod?: ELPlay[];
}
