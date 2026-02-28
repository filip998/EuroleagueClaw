import type {
  GameInfo,
  LiveScore,
  PlayByPlayEvent,
} from '../domain/types.js';

/**
 * Port for fetching EuroLeague game statistics.
 * Adapters: EuroLeague Live API, mock provider, etc.
 */
export interface StatsPort {
  /** Get today's schedule of games */
  getTodaySchedule(seasonCode: string, competitionCode: string): Promise<GameInfo[]>;

  /** Get live score for a specific game */
  getLiveScore(gameCode: number, seasonCode: string): Promise<LiveScore>;

  /** Get play-by-play events since a given event ID (or all if null) */
  getPlayByPlay(
    gameCode: number,
    seasonCode: string,
    sinceEventId?: string | null,
  ): Promise<PlayByPlayEvent[]>;

  /** Get the current live scoreboard (all live games) */
  getScoreboard(): Promise<LiveScore[]>;
}
