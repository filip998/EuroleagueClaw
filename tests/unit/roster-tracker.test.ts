import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RosterTracker } from '../../src/domain/roster-tracker.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { PlayByPlayEvent, RosterRound } from '../../src/domain/types.js';

function makePbpEvent(overrides: Partial<PlayByPlayEvent> = {}): PlayByPlayEvent {
  return {
    eventId: 'evt-1',
    gameCode: 1,
    quarter: 1,
    clock: '8:00',
    teamCode: 'MAD',
    playerName: 'CAMPAZZO, FACUNDO',
    eventType: 'two_pointer_made',
    description: 'Campazzo 2PT',
    homeScore: 12,
    awayScore: 10,
    ...overrides,
  };
}

function makeRosterData(overrides: Partial<RosterRound> = {}): RosterRound {
  return {
    roundNumber: 15,
    rosters: [
      {
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD' },
        ],
      },
      {
        ownerName: 'Marko',
        players: [
          { playerName: 'VEZENKOV, SASHA', teamCode: 'OLY' },
        ],
      },
    ],
    ...overrides,
  };
}

describe('RosterTracker', () => {
  let tracker: RosterTracker;
  let tmpDir: string;

  beforeEach(() => {
    tracker = new RosterTracker();
    tmpDir = mkdtempSync(join(tmpdir(), 'roster-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadFromFile', () => {
    it('should load valid rosters.json and build player index', () => {
      const filePath = join(tmpDir, 'rosters.json');
      writeFileSync(filePath, JSON.stringify(makeRosterData()));

      tracker.loadFromFile(filePath);

      expect(tracker.isLoaded()).toBe(true);
    });

    it('should handle missing file gracefully (isLoaded = false)', () => {
      tracker.loadFromFile(join(tmpDir, 'nonexistent.json'));

      expect(tracker.isLoaded()).toBe(false);
    });

    it('should handle invalid JSON gracefully', () => {
      const filePath = join(tmpDir, 'bad.json');
      writeFileSync(filePath, '{ not valid json !!!');

      tracker.loadFromFile(filePath);

      expect(tracker.isLoaded()).toBe(false);
    });
  });

  describe('matchEvent', () => {
    beforeEach(() => {
      const filePath = join(tmpDir, 'rosters.json');
      writeFileSync(filePath, JSON.stringify(makeRosterData()));
      tracker.loadFromFile(filePath);
    });

    it('should return owners for rostered player on notable event (scoring)', () => {
      const owners = tracker.matchEvent(makePbpEvent({ eventType: 'two_pointer_made' }));
      expect(owners).toContain('Filip');
    });

    it('should return owners for rostered player on assist', () => {
      const owners = tracker.matchEvent(makePbpEvent({ eventType: 'assist' }));
      expect(owners).toContain('Filip');
    });

    it('should return owners for rostered player on steal', () => {
      const owners = tracker.matchEvent(makePbpEvent({ eventType: 'steal' }));
      expect(owners).toContain('Filip');
    });

    it('should return owners for rostered player on block', () => {
      const owners = tracker.matchEvent(makePbpEvent({ eventType: 'block' }));
      expect(owners).toContain('Filip');
    });

    it('should return empty array for non-rostered player', () => {
      const owners = tracker.matchEvent(makePbpEvent({ playerName: 'HEURTEL, THOMAS' }));
      expect(owners).toEqual([]);
    });

    it('should return empty array for non-notable event types', () => {
      const nonNotable: Array<PlayByPlayEvent['eventType']> = [
        'foul', 'substitution', 'two_pointer_missed', 'three_pointer_missed',
        'free_throw_missed', 'rebound', 'turnover', 'timeout',
      ];
      for (const eventType of nonNotable) {
        const owners = tracker.matchEvent(makePbpEvent({ eventType }));
        expect(owners).toEqual([]);
      }
    });

    it('should match case-insensitively', () => {
      const owners = tracker.matchEvent(makePbpEvent({ playerName: 'campazzo, facundo' }));
      expect(owners).toContain('Filip');
    });

    it('should return multiple owners if player is on multiple rosters', () => {
      const data = makeRosterData();
      data.rosters.push({
        ownerName: 'Strahinja',
        players: [{ playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' }],
      });
      const filePath = join(tmpDir, 'multi.json');
      writeFileSync(filePath, JSON.stringify(data));
      tracker.loadFromFile(filePath);

      const owners = tracker.matchEvent(makePbpEvent());
      expect(owners).toContain('Filip');
      expect(owners).toContain('Strahinja');
      expect(owners).toHaveLength(2);
    });

    it('should return empty when not loaded', () => {
      const freshTracker = new RosterTracker();
      const owners = freshTracker.matchEvent(makePbpEvent());
      expect(owners).toEqual([]);
    });
  });

  describe('getOverview', () => {
    it('should return formatted roster overview', () => {
      const filePath = join(tmpDir, 'rosters.json');
      writeFileSync(filePath, JSON.stringify(makeRosterData()));
      tracker.loadFromFile(filePath);

      const overview = tracker.getOverview();
      expect(overview).toContain('Fantasy Rosters');
      expect(overview).toContain('Round 15');
      expect(overview).toContain('Filip');
      expect(overview).toContain('Marko');
      expect(overview).toContain('campazzo, facundo');
      expect(overview).toContain('vezenkov, sasha');
    });

    it('should return "no rosters loaded" when not loaded', () => {
      const overview = tracker.getOverview();
      expect(overview).toContain('No fantasy rosters loaded');
    });
  });
});

describe('MessageComposer.composeRosterMatch', () => {
  let composer: MessageComposer;

  beforeEach(() => {
    composer = new MessageComposer();
  });

  it('should format scoring events with 🏀 emoji', () => {
    for (const eventType of ['two_pointer_made', 'three_pointer_made', 'free_throw_made'] as const) {
      const msg = composer.composeRosterMatch(makePbpEvent({ eventType }), ['Filip']);
      expect(msg).toContain('🏀');
      expect(msg).toContain('CAMPAZZO, FACUNDO');
    }
  });

  it('should format assist events with 🎯 emoji', () => {
    const msg = composer.composeRosterMatch(
      makePbpEvent({ eventType: 'assist', description: 'Campazzo assist' }),
      ['Filip'],
    );
    expect(msg).toContain('🎯');
    expect(msg).toContain('Campazzo assist');
  });

  it('should format steal events with 🔥 emoji', () => {
    const msg = composer.composeRosterMatch(
      makePbpEvent({ eventType: 'steal', description: 'Campazzo steal' }),
      ['Filip'],
    );
    expect(msg).toContain('🔥');
  });

  it('should format block events with 🛡️ emoji', () => {
    const msg = composer.composeRosterMatch(
      makePbpEvent({ eventType: 'block', description: 'Tavares block' }),
      ['Filip'],
    );
    expect(msg).toContain('🛡️');
  });

  it('should include all owner names in output', () => {
    const msg = composer.composeRosterMatch(makePbpEvent(), ['Filip', 'Strahinja', 'Marko']);
    expect(msg).toContain('Filip');
    expect(msg).toContain('Strahinja');
    expect(msg).toContain('Marko');
    expect(msg).toContain('On roster');
  });
});
