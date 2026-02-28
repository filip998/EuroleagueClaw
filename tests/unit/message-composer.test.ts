import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { GameEvent } from '../../src/domain/types.js';

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
  });

  describe('composeStatus', () => {
    it('should show status info', () => {
      const msg = composer.composeStatus(3, 3600000);
      expect(msg).toContain('Tracking: 3');
      expect(msg).toContain('1h 0m');
    });
  });
});
