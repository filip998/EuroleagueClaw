import type { FantasyRoster, FantasyStandings } from '../domain/types.js';

/**
 * Port for fetching fantasy league data.
 * Adapters: Dunkest/Fantaking API, mock provider, etc.
 */
export interface FantasyPort {
  /** Get current round standings for a league */
  getStandings(): Promise<FantasyStandings>;

  /** Check if a new round has started since last check */
  getCurrentRound(): Promise<{ roundNumber: number; roundName: string; isActive: boolean }>;

  /** Fetch fantasy rosters for the given team IDs for the current matchday */
  getRosters(teamIds: string[]): Promise<FantasyRoster[]>;
}
