import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EuroLeagueAdapter } from '../../src/adapters/euroleague/euroleague.adapter.js';

/**
 * Tests for round detection logic in EuroLeagueAdapter.getCurrentRoundGames().
 *
 * findCurrentRound is private, so we test behavior through getCurrentRoundGames()
 * by mocking fetch to return controlled rounds + games data.
 */

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

function makeRound(round: number, name: string, minDate: string, maxDate: string) {
  return { round, name, minGameStartDate: minDate, maxGameStartDate: maxDate };
}

function makeGame(gameCode: number, round: number, played: boolean, utcDate: string) {
  return {
    gameCode,
    round,
    played,
    date: utcDate,
    utcDate,
    local: {
      club: { code: 'MAD', name: 'Real Madrid', abbreviatedName: 'Madrid' },
      score: played ? 89 : 0,
      partials: {},
    },
    road: {
      club: { code: 'OLY', name: 'Olympiacos', abbreviatedName: 'Olympiacos' },
      score: played ? 78 : 0,
      partials: {},
    },
  };
}

function setupFetchMock(rounds: any[], games: any[]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url.includes('/rounds')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: rounds }),
      });
    }
    if (url.includes('/games')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: games }),
      });
    }
    return Promise.resolve({ ok: false, status: 404 });
  }));
}

describe('Round Detection (via getCurrentRoundGames)', () => {
  let adapter: EuroLeagueAdapter;

  beforeEach(() => {
    vi.restoreAllMocks();
    adapter = new EuroLeagueAdapter('https://api-live.euroleague.net', createMockLogger());
  });

  it('should pick the active round when today is within its date range', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    const tomorrow = new Date(now.getTime() + 86400000).toISOString();
    const pastStart = '2025-01-01T00:00:00Z';
    const pastEnd = '2025-01-03T00:00:00Z';

    const rounds = [
      makeRound(1, 'Round 1', pastStart, pastEnd),
      makeRound(2, 'Round 2', yesterday, tomorrow),
      makeRound(3, 'Round 3', '2099-06-01T00:00:00Z', '2099-06-03T00:00:00Z'),
    ];

    const games = [
      makeGame(10, 1, true, pastStart),
      makeGame(20, 2, false, now.toISOString()),
      makeGame(30, 3, false, '2099-06-01T00:00:00Z'),
    ];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.roundNumber).toBe(2);
    expect(result.roundName).toBe('Round 2');
  });

  it('should advance to next round when all games played and last game before today', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const futureStart = new Date(Date.now() + 2 * 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 4 * 86400000).toISOString();

    const rounds = [
      makeRound(10, 'Round 10', threeDaysAgo, twoDaysAgo),
      makeRound(11, 'Round 11', futureStart, futureEnd),
    ];

    const games = [
      makeGame(100, 10, true, threeDaysAgo),
      makeGame(101, 10, true, twoDaysAgo),
      makeGame(200, 11, false, futureStart),
    ];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.roundNumber).toBe(11);
    expect(result.roundName).toBe('Round 11');
  });

  it('should pick last round at end of season when no next round exists', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

    const rounds = [
      makeRound(33, 'Round 33', threeDaysAgo, twoDaysAgo),
    ];

    const games = [
      makeGame(500, 33, true, threeDaysAgo),
      makeGame(501, 33, true, twoDaysAgo),
    ];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    // No next round → stays on round 33
    expect(result.roundNumber).toBe(33);
    expect(result.roundName).toBe('Round 33');
  });

  it('should return empty schedule when no rounds exist', async () => {
    setupFetchMock([], []);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.roundNumber).toBe(0);
    expect(result.roundName).toBe('Unknown');
    expect(result.games).toEqual([]);
  });

  it('should stay on current round when games are still in progress', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    const tomorrow = new Date(now.getTime() + 86400000).toISOString();

    const rounds = [
      makeRound(5, 'Round 5', yesterday, tomorrow),
      makeRound(6, 'Round 6', '2099-06-01T00:00:00Z', '2099-06-03T00:00:00Z'),
    ];

    const games = [
      makeGame(50, 5, true, yesterday),
      makeGame(51, 5, false, tomorrow), // not yet played
      makeGame(60, 6, false, '2099-06-01T00:00:00Z'),
    ];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.roundNumber).toBe(5);
    expect(result.games).toHaveLength(2);
  });

  it('should map game data correctly in round schedule', async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000).toISOString();
    const tomorrow = new Date(now.getTime() + 86400000).toISOString();

    const rounds = [makeRound(1, 'Round 1', yesterday, tomorrow)];
    const games = [makeGame(42, 1, true, yesterday)];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.games).toHaveLength(1);
    const game = result.games[0];
    expect(game.gameCode).toBe(42);
    expect(game.homeTeam.code).toBe('MAD');
    expect(game.awayTeam.code).toBe('OLY');
    expect(game.status).toBe('finished');
    expect(game.homeScore).toBe(89);
    expect(game.awayScore).toBe(78);
  });

  it('should pick next upcoming round when no past rounds exist and today is between rounds', async () => {
    const futureStart = new Date(Date.now() + 2 * 86400000).toISOString();
    const futureEnd = new Date(Date.now() + 4 * 86400000).toISOString();

    const rounds = [
      makeRound(1, 'Round 1', futureStart, futureEnd),
    ];

    const games = [
      makeGame(10, 1, false, futureStart),
    ];

    setupFetchMock(rounds, games);

    const result = await adapter.getCurrentRoundGames('E2025', 'E');
    expect(result.roundNumber).toBe(1);
    expect(result.roundName).toBe('Round 1');
  });
});
