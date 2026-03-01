import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FantasyTracker } from '../../src/domain/fantasy-tracker.js';
import type { FantasyPort } from '../../src/ports/fantasy.port.js';
import type { FantasyStandings } from '../../src/domain/types.js';

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

function createMockFantasy(standings: FantasyStandings): FantasyPort {
  return {
    getStandings: vi.fn().mockResolvedValue(standings),
    getCurrentRound: vi.fn().mockResolvedValue({ roundNumber: 1, roundName: 'Round 1', isActive: true }),
    getRosters: vi.fn().mockResolvedValue({ matchdayNumber: 0, rosters: [] }),
  };
}

const sampleStandings: FantasyStandings = {
  roundNumber: 12,
  roundName: 'Round 12',
  entries: [
    { rank: 1, teamName: 'Alpha Squad', ownerName: 'Alice', totalPoints: 950, roundPoints: 85 },
    { rank: 2, teamName: 'Beta Team', ownerName: 'Bob', totalPoints: 920, roundPoints: 72 },
    { rank: 3, teamName: 'Gamma Force', ownerName: 'Charlie', totalPoints: 890, roundPoints: 0 },
    { rank: 4, teamName: 'Delta Crew', ownerName: 'Diana', totalPoints: 860, roundPoints: 55 },
  ],
};

describe('FantasyTracker', () => {
  let tracker: FantasyTracker;
  let fantasy: FantasyPort;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    logger = createMockLogger();
    fantasy = createMockFantasy(sampleStandings);
    tracker = new FantasyTracker(fantasy, logger);
  });

  it('should format standings with medals and points', async () => {
    const result = await tracker.getOverview();

    expect(result).toContain('Fantasy Standings');
    expect(result).toContain('Round 12');
    expect(result).toContain('🥇 Alpha Squad — 950 pts (+85)');
    expect(result).toContain('🥈 Beta Team — 920 pts (+72)');
    expect(result).toContain('🥉 Gamma Force — 890 pts');
    expect(result).toContain('4. Delta Crew — 860 pts (+55)');
  });

  it('should not show delta when roundPoints is 0', async () => {
    const result = await tracker.getOverview();
    expect(result).toContain('🥉 Gamma Force — 890 pts');
    expect(result).not.toContain('🥉 Gamma Force — 890 pts (+0)');
  });

  it('should handle empty standings', async () => {
    fantasy = createMockFantasy({ roundNumber: 0, roundName: 'Unknown', entries: [] });
    tracker = new FantasyTracker(fantasy, logger);

    const result = await tracker.getOverview();
    expect(result).toContain('No fantasy standings available');
  });

  it('should return error message when API fails', async () => {
    fantasy = {
      getStandings: vi.fn().mockRejectedValue(new Error('Network error')),
      getCurrentRound: vi.fn(),
    };
    tracker = new FantasyTracker(fantasy, logger);

    const result = await tracker.getOverview();
    expect(result).toContain('Could not load fantasy standings');
    expect(logger.error).toHaveBeenCalled();
  });
});
