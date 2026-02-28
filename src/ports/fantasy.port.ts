import type { FantasyStandings } from '../domain/types.js';

/**
 * Port for fetching fantasy league data.
 * Adapters: Dunkest/Fantaking API, mock provider, etc.
 */
export interface FantasyPort {
  /** Get current round standings for a league */
  getStandings(): Promise<FantasyStandings>;

  /** Check if a new round has started since last check */
  getCurrentRound(): Promise<{ roundNumber: number; roundName: string; isActive: boolean }>;
}
