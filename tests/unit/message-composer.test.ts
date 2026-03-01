import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { GameEvent, RoundSchedule, RoundGame, TeamInfo } from '../../src/domain/types.js';

function makeTeam(code: string, name: string, shortName?: string): TeamInfo {
  return { code, name, shortName: shortName ?? name };
}

function makeRoundGame(overrides: Partial<RoundGame> = {}): RoundGame {
  return {
    gameCode: 1,
    homeTeam: makeTeam('MAD', 'Real Madrid', 'Madrid'),
    awayTeam: makeTeam('OLY', 'Olympiacos', 'Olympiacos'),
    status: 'finished',
    startTime: '2025-03-01T20:00:00Z',
    homeScore: 89,
    awayScore: 78,
    ...overrides,
  };
}

describe('MessageComposer', () => {
  let composer: MessageComposer;

  beforeEach(() => {
    composer = new MessageComposer();
    composer.registerGame(1, 'Real Madrid', 'Olympiacos');
  });

  it('should compose game start message', () => {
    const event: GameEvent = {
      type: 'game_start',
      gameCode: 1,
      homeTeam: { code: 'MAD', name: 'Real Madrid', shortName: 'Madrid' },
      awayTeam: { code: 'OLY', name: 'Olympiacos', shortName: 'Olympiacos' },
    };
    const msg = composer.compose(event);
    expect(msg).toContain('Real Madrid');
    expect(msg).toContain('Olympiacos');
    expect(msg).toContain('🏀');
  });

  it('should compose game end message', () => {
    const event: GameEvent = {
      type: 'game_end',
      gameCode: 1,
      homeScore: 89,
      awayScore: 78,
      winnerCode: 'home',
    };
    const msg = composer.compose(event);
    expect(msg).toContain('FINAL');
    expect(msg).toContain('89');
    expect(msg).toContain('78');
    expect(msg).toContain('Real Madrid wins');
  });

  it('should compose score change message', () => {
    const event: GameEvent = {
      type: 'score_change',
      gameCode: 1,
      homeScore: 45,
      awayScore: 38,
      quarter: 2,
      clock: '5:32',
      scoringTeamCode: 'home',
      playerName: 'Campazzo',
      points: 3,
      description: 'Campazzo 3PT',
    };
    const msg = composer.compose(event);
    expect(msg).toContain('Q2');
    expect(msg).toContain('5:32');
    expect(msg).toContain('45');
    expect(msg).toContain('38');
  });

  it('should compose quarter end message', () => {
    const event: GameEvent = {
      type: 'quarter_end',
      gameCode: 1,
      quarter: 3,
      homeScore: 67,
      awayScore: 58,
    };
    const msg = composer.compose(event);
    expect(msg).toContain('End of Q3');
    expect(msg).toContain('67');
    expect(msg).toContain('58');
  });

  it('should compose lead change message', () => {
    const event: GameEvent = {
      type: 'lead_change',
      gameCode: 1,
      leadingTeamCode: 'away',
      leadMargin: 3,
      homeScore: 48,
      awayScore: 51,
      quarter: 3,
      clock: '2:00',
    };
    const msg = composer.compose(event);
    expect(msg).toContain('Lead Change');
    expect(msg).toContain('Olympiacos');
    expect(msg).toContain('3');
  });

  describe('composeSchedule', () => {
    it('should format schedule with games', () => {
      const games = [
        { homeTeam: 'Real Madrid', awayTeam: 'Olympiacos', startTime: '2025-03-01T20:00:00Z', gameCode: 1 },
        { homeTeam: 'Barcelona', awayTeam: 'Fenerbahce', startTime: '2025-03-01T20:45:00Z', gameCode: 2 },
      ];
      const msg = composer.composeSchedule(games);
      expect(msg).toContain('Today\'s EuroLeague');
      expect(msg).toContain('Real Madrid vs Olympiacos');
      expect(msg).toContain('Barcelona vs Fenerbahce');
    });

    it('should handle empty schedule', () => {
      const msg = composer.composeSchedule([]);
      expect(msg).toContain('No EuroLeague games');
    });
  });

  describe('composeHelp', () => {
    it('should list all commands', () => {
      const msg = composer.composeHelp();
      expect(msg).toContain('/help');
      expect(msg).toContain('/today');
      expect(msg).toContain('/game');
      expect(msg).toContain('/stop');
      expect(msg).toContain('/mute');
    });

    it('should return MarkdownV2 formatted output with bold title', () => {
      const msg = composer.composeHelp();
      expect(msg).toContain('*EuroleagueClaw*');
      // Commands use bold formatting, no code blocks
      expect(msg).not.toContain('```');
      expect(msg).toContain('/help');
      expect(msg).toContain('/games');
      expect(msg).toContain('/roster');
      expect(msg).toContain('/fantasy');
    });

    it('should contain commands with bold names and escaped descriptions', () => {
      const msg = composer.composeHelp();
      // em dash — is not a MarkdownV2 special char, passes through
      expect(msg).toContain('—');
      // Bold command names
      expect(msg).toContain('*/help*');
      expect(msg).toContain('*/games*');
    });
  });

  describe('composeRoundGames', () => {
    it('should show scores for finished games with bold team names', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [makeRoundGame({ status: 'finished', homeScore: 93, awayScore: 70 })],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('Round 30');
      expect(msg).toContain('✅');
      expect(msg).toContain('93');
      expect(msg).toContain('70');
      // Uses bold team shortNames, not codes
      expect(msg).toContain('*Madrid*');
      expect(msg).toContain('*Olympiacos*');
    });

    it('should show time for upcoming games with bold team names', () => {
      const schedule: RoundSchedule = {
        roundNumber: 31,
        roundName: 'Round 31',
        games: [makeRoundGame({
          status: 'scheduled',
          homeScore: 0,
          awayScore: 0,
          startTime: '2025-03-15T19:00:00Z',
        })],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('vs');
      expect(msg).toContain('*Madrid*');
      expect(msg).toContain('*Olympiacos*');
      expect(msg).toContain('🕐');
      // No code blocks for games
      expect(msg).not.toContain('```');
    });

    it('should return no games message for empty games array', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('No games found');
    });

    it('should handle mixed finished and upcoming games', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [
          makeRoundGame({
            gameCode: 1,
            status: 'finished',
            homeScore: 89,
            awayScore: 78,
            startTime: '2025-03-01T18:00:00Z',
          }),
          makeRoundGame({
            gameCode: 2,
            homeTeam: makeTeam('BAR', 'Barcelona', 'Barcelona'),
            awayTeam: makeTeam('FNB', 'Fenerbahce', 'Fenerbahce'),
            status: 'scheduled',
            homeScore: 0,
            awayScore: 0,
            startTime: '2025-03-01T20:00:00Z',
          }),
        ],
      };

      const msg = composer.composeRoundGames(schedule);
      // Finished game
      expect(msg).toContain('✅');
      expect(msg).toContain('89');
      // Upcoming game — full team names, not codes
      expect(msg).toContain('*Barcelona*');
      expect(msg).toContain('*Fenerbahce*');
    });

    it('should use bold team shortNames without code blocks', () => {
      const schedule: RoundSchedule = {
        roundNumber: 1,
        roundName: 'Round 1',
        games: [makeRoundGame()],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('*Round 1*');
      expect(msg).toContain('*Madrid*');
      expect(msg).toContain('*Olympiacos*');
      expect(msg).not.toContain('```');
    });

    it('should group games by date with 📆 headers', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [
          makeRoundGame({ startTime: '2025-03-01T18:00:00Z' }),
          makeRoundGame({
            gameCode: 2,
            homeTeam: makeTeam('BAR', 'Barcelona', 'Barcelona'),
            awayTeam: makeTeam('FNB', 'Fenerbahce', 'Fenerbahce'),
            startTime: '2025-03-02T20:00:00Z',
          }),
        ],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('📆');
      // Should have at least two 📆 sections for two different dates
      const dateHeaders = msg.split('📆').length - 1;
      expect(dateHeaders).toBeGreaterThanOrEqual(2);
    });

    it('should show both teams for finished games regardless of score', () => {
      const schedule: RoundSchedule = {
        roundNumber: 1,
        roundName: 'Round 1',
        games: [makeRoundGame({ homeScore: 70, awayScore: 93 })],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('✅');
      expect(msg).toContain('*Madrid*');
      expect(msg).toContain('*Olympiacos*');
      expect(msg).toContain('70');
      expect(msg).toContain('93');
    });

    it('should render finished game scores with MarkdownV2 formatting', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [makeRoundGame({ status: 'finished', homeScore: 93, awayScore: 70 })],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('✅');
      expect(msg).toContain('93');
      expect(msg).toContain('70');
      // Escaped hyphen between scores
      expect(msg).toContain('\\-');
      expect(msg).toContain('*Madrid*');
    });

    it('should render upcoming game times with bold team names', () => {
      const schedule: RoundSchedule = {
        roundNumber: 31,
        roundName: 'Round 31',
        games: [makeRoundGame({
          status: 'scheduled',
          homeScore: 0,
          awayScore: 0,
          startTime: '2025-03-15T19:00:00Z',
        })],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('⏳');
      expect(msg).toContain('*Madrid*');
      expect(msg).toContain('vs');
      expect(msg).toContain('*Olympiacos*');
      expect(msg).toContain('🕐');
    });

    it('should render round name with MarkdownV2 bold formatting', () => {
      const schedule: RoundSchedule = {
        roundNumber: 30,
        roundName: 'Round 30',
        games: [makeRoundGame()],
      };

      const msg = composer.composeRoundGames(schedule);
      expect(msg).toContain('*Round 30*');
      expect(msg).toContain('📆');
    });
  });

  describe('composeStatus', () => {
    it('should show status info', () => {
      const msg = composer.composeStatus(3, 3600000);
      expect(msg).toContain('Tracking: 3');
      expect(msg).toContain('1h 0m');
    });
  });
});
