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
      expect(overview).toContain('Matchday 15');
      expect(overview).toContain('Filip');
      expect(overview).toContain('Marko');
      // Player names displayed as formatted names inside code block
      expect(overview).toContain('F. Campazzo');
      expect(overview).toContain('S. Vezenkov');
    });

    it('should return "no rosters loaded" when not loaded', () => {
      const overview = tracker.getOverview();
      expect(overview).toContain('No fantasy rosters loaded');
    });

    it('should show starters/bench/coach sections when court positions present', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', position: 'Guard', courtPosition: 1 },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD', position: 'Center', courtPosition: 2 },
          { playerName: 'HEZONJA, MARIO', teamCode: 'MAD', position: 'Forward', courtPosition: 3 },
          { playerName: 'LLULL, SERGIO', teamCode: 'MAD', position: 'Guard', courtPosition: 4 },
          { playerName: 'ABALDE, ALBERTO', teamCode: 'MAD', position: 'Forward', courtPosition: 5 },
          { playerName: 'POIRIER, VINCENT', teamCode: 'MAD', position: 'Center', courtPosition: 6 },
          { playerName: 'CHUS MATEO', teamCode: 'MAD', position: 'Head Coach', courtPosition: 11 },
        ],
      }], 20);

      const overview = tracker.getOverview();
      expect(overview).toContain('Starting Five');
      expect(overview).toContain('Bench');
      expect(overview).toContain('Coach');
      expect(overview).toContain('Matchday 20');
    });

    it('should show captain © indicator', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', courtPosition: 1, isCaptain: true },
        ],
      }], 5);

      const overview = tracker.getOverview();
      expect(overview).toContain('©');
    });

    it('should show fire 🔥 indicator', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', courtPosition: 1, isOnFire: true },
        ],
      }], 5);

      const overview = tracker.getOverview();
      expect(overview).toContain('🔥');
    });

    it('should show opponent codes when present', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', courtPosition: 1, opponentCode: 'BAR' },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD', courtPosition: 2, opponentCode: 'OLY' },
        ],
      }], 8);

      const overview = tracker.getOverview();
      expect(overview).toContain('BAR');
      expect(overview).toContain('OLY');
    });

    it('should show flat list when no court position data', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD' },
        ],
      }], 10);

      const overview = tracker.getOverview();
      // Without court positions, there should be no Starting Five / Bench sections
      expect(overview).not.toContain('Starting Five');
      expect(overview).not.toContain('Bench');
      // Player names as formatted display names inside code block
      expect(overview).toContain('F. Campazzo');
      expect(overview).toContain('W. Tavares');
    });
  });

  describe('loadRosters', () => {
    it('should load rosters with matchday number', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [{ playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' }],
      }], 25);

      expect(tracker.isLoaded()).toBe(true);
      const overview = tracker.getOverview();
      expect(overview).toContain('Matchday 25');
    });

    it('should default to matchday 0 when no matchday provided', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [{ playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' }],
      }]);

      expect(tracker.isLoaded()).toBe(true);
      const overview = tracker.getOverview();
      expect(overview).toContain('Matchday 0');
    });

    it('should not be loaded when given empty rosters array', () => {
      tracker.loadRosters([], 5);
      expect(tracker.isLoaded()).toBe(false);
    });

    it('should update player index for event matching after loadRosters', () => {
      tracker.loadRosters([{
        ownerName: 'Marko',
        players: [{ playerName: 'VEZENKOV, SASHA', teamCode: 'OLY' }],
      }], 15);

      const owners = tracker.matchEvent(makePbpEvent({
        playerName: 'VEZENKOV, SASHA',
        eventType: 'three_pointer_made',
      }));
      expect(owners).toContain('Marko');
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
