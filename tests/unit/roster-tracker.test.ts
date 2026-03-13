import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RosterTracker } from '../../src/domain/roster-tracker.js';
import { MessageComposer } from '../../src/domain/message-composer.js';
import type { PlayByPlayEvent, FantasyRoster } from '../../src/domain/types.js';

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

function makeRosterData(): { roundNumber: number; rosters: FantasyRoster[] } {
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
  };
}

describe('RosterTracker', () => {
  let tracker: RosterTracker;

  beforeEach(() => {
    tracker = new RosterTracker();
  });

  describe('matchEvent', () => {
    beforeEach(() => {
      const data = makeRosterData();
      tracker.loadRosters(data.rosters, data.roundNumber);
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
        'substitution', 'timeout',
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
      tracker.loadRosters(data.rosters, data.roundNumber);

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
      const data = makeRosterData();
      tracker.loadRosters(data.rosters, data.roundNumber);

      const overview = tracker.getOverview();
      expect(overview).toContain('Fantasy Rosters');
      expect(overview).toContain('Matchday 15');
      expect(overview).toContain('Filip');
      expect(overview).toContain('Marko');
      // Player names displayed as formatted names with MarkdownV2 escaping
      expect(overview).toContain('Campazzo');
      expect(overview).toContain('Vezenkov');
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
      // Player names with MarkdownV2 bold formatting and tree chars
      expect(overview).toContain('Campazzo');
      expect(overview).toContain('Tavares');
      expect(overview).toContain('├');
      expect(overview).toContain('└');
    });

    it('should render player data with MarkdownV2 formatting', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' },
          { playerName: 'TAVARES, WALTER', teamCode: 'MAD' },
        ],
      }], 10);

      const overview = tracker.getOverview();
      // No code blocks — uses MarkdownV2 inline formatting
      expect(overview).not.toContain('```');
      // Bold player names with escaped dots
      expect(overview).toContain('*F\\. Campazzo*');
      expect(overview).toContain('*W\\. Tavares*');
    });

    it('should render roster owner header with bold formatting', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' },
        ],
      }], 10);

      const overview = tracker.getOverview();
      // No code blocks anywhere
      expect(overview).not.toContain('```');
      // Bold owner name and Fantasy Rosters header
      expect(overview).toContain('*Filip*');
      expect(overview).toContain('*Fantasy Rosters*');
      expect(overview).toContain('👤');
    });

    it('should render position sections with italic headers when court positions present', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [
          { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD', position: 'Guard', courtPosition: 1 },
          { playerName: 'POIRIER, VINCENT', teamCode: 'MAD', position: 'Center', courtPosition: 6 },
        ],
      }], 20);

      const overview = tracker.getOverview();
      // No code blocks
      expect(overview).not.toContain('```');
      // Italic section headers
      expect(overview).toContain('_Starting Five_');
      expect(overview).toContain('_Bench_');
      // Tree characters and position tags with dot separator
      expect(overview).toContain('└');
      expect(overview).toContain('G · ');
      expect(overview).toContain('Campazzo');
      expect(overview).toContain('Poirier');
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

  describe('getStats', () => {
    it('should return zeros and loaded=false when not loaded', () => {
      const stats = tracker.getStats();
      expect(stats.loaded).toBe(false);
      expect(stats.playerCount).toBe(0);
      expect(stats.teamCount).toBe(0);
      expect(stats.roundNumber).toBe(0);
      expect(stats.lastLoadedAt).toBeNull();
      expect(stats.playerNames).toEqual([]);
    });

    it('should return correct counts after loading rosters', () => {
      const data = makeRosterData();
      tracker.loadRosters(data.rosters, data.roundNumber);

      const stats = tracker.getStats();
      expect(stats.loaded).toBe(true);
      expect(stats.playerCount).toBe(3); // Campazzo, Tavares, Vezenkov
      expect(stats.teamCount).toBe(2);   // MAD, OLY
      expect(stats.roundNumber).toBe(15);
      expect(stats.playerNames).toHaveLength(3);
    });

    it('should return normalized player names', () => {
      tracker.loadRosters([{
        ownerName: 'Filip',
        players: [{ playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' }],
      }], 10);

      const stats = tracker.getStats();
      expect(stats.playerNames).toContain('campazzo, facundo');
    });

    it('should count unique teams across all rosters', () => {
      tracker.loadRosters([
        {
          ownerName: 'Filip',
          players: [
            { playerName: 'CAMPAZZO, FACUNDO', teamCode: 'MAD' },
            { playerName: 'LLULL, SERGIO', teamCode: 'MAD' },
          ],
        },
        {
          ownerName: 'Marko',
          players: [
            { playerName: 'VEZENKOV, SASHA', teamCode: 'OLY' },
            { playerName: 'SLOUKAS, KOSTAS', teamCode: 'OLY' },
          ],
        },
      ], 5);

      const stats = tracker.getStats();
      // Two teams (MAD, OLY) despite 4 players
      expect(stats.teamCount).toBe(2);
      expect(stats.playerCount).toBe(4);
    });

    it('should return zeros after loading empty rosters', () => {
      tracker.loadRosters([], 5);
      const stats = tracker.getStats();
      expect(stats.loaded).toBe(false);
      expect(stats.playerCount).toBe(0);
      expect(stats.teamCount).toBe(0);
    });
  });

  describe('needsReload', () => {
    it('should return true when rosters have never been loaded', () => {
      expect(tracker.needsReload()).toBe(true);
    });

    it('should return false when rosters were recently loaded', () => {
      const data = makeRosterData();
      tracker.loadRosters(data.rosters, data.roundNumber);
      expect(tracker.needsReload()).toBe(false);
    });

    it('should return true when rosters are stale (> 1 hour old)', () => {
      vi.useFakeTimers();
      try {
        const data = makeRosterData();
        tracker.loadRosters(data.rosters, data.roundNumber);
        expect(tracker.needsReload()).toBe(false);

        // Advance 61 minutes
        vi.advanceTimersByTime(61 * 60 * 1000);
        expect(tracker.needsReload()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return false at exactly 1 hour boundary', () => {
      vi.useFakeTimers();
      try {
        const data = makeRosterData();
        tracker.loadRosters(data.rosters, data.roundNumber);

        // Advance exactly 59 minutes — still fresh
        vi.advanceTimersByTime(59 * 60 * 1000);
        expect(tracker.needsReload()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should return true after loading empty rosters', () => {
      tracker.loadRosters([], 5);
      expect(tracker.needsReload()).toBe(true);
    });
  });

  describe('lastLoadedAt', () => {
    it('should be null before any rosters are loaded', () => {
      const stats = tracker.getStats();
      expect(stats.lastLoadedAt).toBeNull();
    });

    it('should be set after loadRosters with non-empty data', () => {
      const before = new Date();
      const data = makeRosterData();
      tracker.loadRosters(data.rosters, data.roundNumber);
      const after = new Date();

      const stats = tracker.getStats();
      expect(stats.lastLoadedAt).toBeInstanceOf(Date);
      expect(stats.lastLoadedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(stats.lastLoadedAt!.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should not be set when loading empty rosters', () => {
      tracker.loadRosters([], 5);
      const stats = tracker.getStats();
      expect(stats.lastLoadedAt).toBeNull();
    });

    it('should update on subsequent loadRosters calls', () => {
      vi.useFakeTimers();
      try {
        const data = makeRosterData();
        tracker.loadRosters(data.rosters, data.roundNumber);
        const firstLoad = tracker.getStats().lastLoadedAt!.getTime();

        vi.advanceTimersByTime(5000);
        tracker.loadRosters(data.rosters, 16);
        const secondLoad = tracker.getStats().lastLoadedAt!.getTime();

        expect(secondLoad).toBeGreaterThan(firstLoad);
      } finally {
        vi.useRealTimers();
      }
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
