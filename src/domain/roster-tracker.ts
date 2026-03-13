import type { FantasyRoster, PlayByPlayEvent, PlayByPlayEventType, RosteredPlayer } from './types.js';
import { escapeMarkdownV2, bold, italic, SEPARATOR } from '../shared/markdown-v2.js';

const NOTABLE_EVENT_TYPES: ReadonlySet<PlayByPlayEventType> = new Set([
  'two_pointer_made',
  'two_pointer_missed',
  'three_pointer_made',
  'three_pointer_missed',
  'free_throw_made',
  'free_throw_missed',
  'rebound',
  'assist',
  'steal',
  'block',
  'turnover',
  'foul',
  'substitution_in',
  'substitution_out',
]);

export interface RosterStats {
  loaded: boolean;
  playerCount: number;
  teamCount: number;
  roundNumber: number;
  lastLoadedAt: Date | null;
  playerNames: string[];
}

export class RosterTracker {
  private playerIndex = new Map<string, string[]>();
  private roundNumber = 0;
  private loaded = false;
  private rosterData: FantasyRoster[] = [];
  private lastLoadedAt: Date | null = null;

  /** Custom-tracked players: normalized name → set of chatIds */
  private customPlayers = new Map<string, Set<string>>();
  /** All player names seen from PBP events (normalized → original) */
  private knownPlayers = new Map<string, string>();

  private static readonly CUSTOM_LABEL = '⭐ Tracked';

  static normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  loadRosters(rosters: FantasyRoster[], matchdayNumber?: number): void {
    this.rosterData = rosters;
    this.buildIndex(rosters, matchdayNumber ?? 0);
    if (rosters.length > 0) {
      this.lastLoadedAt = new Date();
    }
  }

  matchEvent(event: PlayByPlayEvent, chatId?: string): string[] {
    if (!NOTABLE_EVENT_TYPES.has(event.eventType)) return [];
    if (!event.playerName) return [];

    const key = RosterTracker.normalizeName(event.playerName);
    const owners: string[] = [];

    // Fantasy roster matches
    if (this.loaded) {
      const rosterOwners = this.playerIndex.get(key);
      if (rosterOwners) owners.push(...rosterOwners);
    }

    // Custom-tracked player matches
    const trackers = this.customPlayers.get(key);
    if (trackers && chatId && trackers.has(chatId)) {
      owners.push(RosterTracker.CUSTOM_LABEL);
    }

    return owners;
  }

  getOverview(): string {
    if (!this.loaded || this.rosterData.length === 0) {
      return escapeMarkdownV2('📋 No fantasy rosters loaded.');
    }

    const parts = [`🏀 ${bold('Fantasy Rosters')} — ${escapeMarkdownV2('Matchday ' + this.roundNumber)}\n${SEPARATOR}\n`];

    for (let ri = 0; ri < this.rosterData.length; ri++) {
      const roster = this.rosterData[ri];
      parts.push(`👤 ${bold(roster.ownerName)}\n`);

      const hasPositionData = roster.players.some(p => p.courtPosition != null);

      if (hasPositionData) {
        const sorted = [...roster.players].sort(
          (a, b) => (a.courtPosition ?? 99) - (b.courtPosition ?? 99),
        );
        const starters = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 1 && p.courtPosition <= 5);
        const bench = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 6 && p.courtPosition <= 10);
        const coach = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 11);

        const sections: Array<{ emoji: string; label: string; players: RosteredPlayer[] }> = [];
        if (starters.length > 0) sections.push({ emoji: '🏟', label: 'Starting Five', players: starters });
        if (bench.length > 0) sections.push({ emoji: '📋', label: 'Bench', players: bench });
        if (coach.length > 0) sections.push({ emoji: '🎩', label: 'Coach', players: coach });

        for (let si = 0; si < sections.length; si++) {
          const section = sections[si];
          parts.push(`${section.emoji} ${italic(section.label)}`);
          for (let pi = 0; pi < section.players.length; pi++) {
            const prefix = pi === section.players.length - 1 ? '└' : '├';
            parts.push(`  ${prefix} ${this.formatPlayerLineMd(section.players[pi])}`);
          }
          if (si < sections.length - 1) parts.push('');
        }
      } else {
        for (let pi = 0; pi < roster.players.length; pi++) {
          const prefix = pi === roster.players.length - 1 ? '└' : '├';
          parts.push(`  ${prefix} ${this.formatPlayerLineMd(roster.players[pi])}`);
        }
      }

      if (ri < this.rosterData.length - 1) {
        parts.push(`\n${SEPARATOR}\n`);
      }
    }

    return parts.join('\n').trimEnd();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** Returns true if rosters have never been loaded or are stale (> 1 hour old). */
  needsReload(): boolean {
    if (!this.loaded) return true;
    if (!this.lastLoadedAt) return true;
    const staleMs = 60 * 60 * 1000; // 1 hour
    return Date.now() - this.lastLoadedAt.getTime() > staleMs;
  }

  getStats(): RosterStats {
    const uniqueTeams = new Set<string>();
    for (const roster of this.rosterData) {
      for (const player of roster.players) {
        uniqueTeams.add(player.teamCode);
      }
    }

    return {
      loaded: this.loaded,
      playerCount: this.playerIndex.size,
      teamCount: uniqueTeams.size,
      roundNumber: this.roundNumber,
      lastLoadedAt: this.lastLoadedAt,
      playerNames: [...this.playerIndex.keys()],
    };
  }

  /** Register a player name from PBP events so it's available for fuzzy matching. */
  registerKnownPlayer(name: string): void {
    if (!name) return;
    const key = RosterTracker.normalizeName(name);
    if (!this.knownPlayers.has(key)) {
      this.knownPlayers.set(key, name.trim());
    }
  }

  /** Add a custom-tracked player by fuzzy-matching against known PBP names. */
  addCustomPlayer(chatId: string, query: string): { matched: string } | { suggestions: string[] } | { notFound: true } {
    const normalizedQuery = RosterTracker.normalizeName(query);

    // Collect all known names (from rosters + PBP events)
    const allNames = new Map<string, string>();
    for (const [key] of this.playerIndex) {
      allNames.set(key, key);
    }
    for (const [key, original] of this.knownPlayers) {
      allNames.set(key, original);
    }

    // Try exact match first
    if (allNames.has(normalizedQuery)) {
      this.addCustomTracking(normalizedQuery, chatId);
      return { matched: allNames.get(normalizedQuery)! };
    }

    // Fuzzy: find names containing all query words
    const queryWords = normalizedQuery.split(/[\s,]+/).filter(Boolean);
    const matches: string[] = [];
    for (const [key, original] of allNames) {
      if (queryWords.every(w => key.includes(w))) {
        matches.push(original);
      }
    }

    if (matches.length === 1) {
      const key = RosterTracker.normalizeName(matches[0]);
      this.addCustomTracking(key, chatId);
      return { matched: matches[0] };
    }

    if (matches.length > 1) {
      return { suggestions: matches.slice(0, 5) };
    }

    return { notFound: true };
  }

  removeCustomPlayer(chatId: string, query: string): string | null {
    const normalizedQuery = RosterTracker.normalizeName(query);
    const queryWords = normalizedQuery.split(/[\s,]+/).filter(Boolean);

    for (const [key, chatIds] of this.customPlayers) {
      if (!chatIds.has(chatId)) continue;
      if (queryWords.every(w => key.includes(w))) {
        chatIds.delete(chatId);
        if (chatIds.size === 0) this.customPlayers.delete(key);
        return this.knownPlayers.get(key) ?? key;
      }
    }
    return null;
  }

  getCustomPlayers(chatId: string): string[] {
    const result: string[] = [];
    for (const [key, chatIds] of this.customPlayers) {
      if (chatIds.has(chatId)) {
        result.push(this.knownPlayers.get(key) ?? key);
      }
    }
    return result;
  }

  private addCustomTracking(normalizedName: string, chatId: string): void {
    const existing = this.customPlayers.get(normalizedName) ?? new Set();
    existing.add(chatId);
    this.customPlayers.set(normalizedName, existing);
  }

  private formatPlayerLine(p: RosteredPlayer): string {
    const pos = p.position ? `${this.positionTag(p.position)} ` : '';
    const name = this.formatDisplayName(p.playerName);
    const matchup = p.opponentCode
      ? (p.isHome ? ` vs ${p.opponentCode}` : ` @ ${p.opponentCode}`)
      : '';
    const captain = p.isCaptain ? ' ©' : '';
    const fire = p.isOnFire ? ' 🔥' : '';
    return `${pos}${name}${matchup}${captain}${fire}`;
  }

  private formatDisplayName(name: string): string {
    const parts = name.split(',').map(s => s.trim());
    if (parts.length === 2 && parts[1]) {
      const first = parts[1][0].toUpperCase() + '.';
      const last = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
      return `${first} ${last}`;
    }
    return name;
  }

  private positionTag(position: string): string {
    switch (position) {
      case 'Guard': return 'G ';
      case 'Forward': return 'F ';
      case 'Center': return 'C ';
      case 'Head Coach': return 'HC';
      default: return '';
    }
  }

  private formatPlayerLineMd(p: RosteredPlayer): string {
    const e = escapeMarkdownV2;
    const pos = p.position ? `${e(this.positionTag(p.position).trim())} · ` : '';
    const name = bold(this.formatDisplayName(p.playerName));
    const matchup = p.opponentCode
      ? (p.isHome ? ` vs ${e(p.opponentCode)}` : ` @ ${e(p.opponentCode)}`)
      : '';
    const captain = p.isCaptain ? ' ©' : '';
    const fire = p.isOnFire ? ' 🔥' : '';
    return `${pos}${name}${matchup}${captain}${fire}`;
  }

  /** Format a player line for use inside a code block (no MarkdownV2 escaping). */
  private formatPlayerCodeBlock(p: RosteredPlayer): string {
    const pos = p.position ? this.positionTag(p.position).padEnd(3) : '   ';
    const name = this.formatDisplayName(p.playerName).padEnd(14);
    const matchup = p.opponentCode
      ? (p.isHome ? `vs ${p.opponentCode}` : `@ ${p.opponentCode}`)
      : '';
    const captain = p.isCaptain ? ' ©' : '';
    const fire = p.isOnFire ? ' 🔥' : '';
    return `${pos}${name} ${matchup}${captain}${fire}`;
  }

  private buildIndex(rosters: FantasyRoster[], roundNumber: number): void {
    this.playerIndex.clear();
    this.roundNumber = roundNumber;

    for (const roster of rosters) {
      for (const player of roster.players) {
        const key = RosterTracker.normalizeName(player.playerName);
        const owners = this.playerIndex.get(key) ?? [];
        owners.push(roster.ownerName);
        this.playerIndex.set(key, owners);
        // Also register roster players as known for fuzzy matching
        if (!this.knownPlayers.has(key)) {
          this.knownPlayers.set(key, player.playerName);
        }
      }
    }

    this.loaded = rosters.length > 0;
  }
}
