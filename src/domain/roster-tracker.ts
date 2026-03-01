import { readFileSync } from 'node:fs';
import type { FantasyRoster, PlayByPlayEvent, PlayByPlayEventType, RosteredPlayer, RosterRound } from './types.js';

const NOTABLE_EVENT_TYPES: ReadonlySet<PlayByPlayEventType> = new Set([
  'two_pointer_made',
  'three_pointer_made',
  'free_throw_made',
  'assist',
  'steal',
  'block',
]);

export class RosterTracker {
  private playerIndex = new Map<string, string[]>();
  private roundNumber = 0;
  private loaded = false;
  private rosterData: FantasyRoster[] = [];

  static normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  loadFromFile(path: string): void {
    try {
      const raw = readFileSync(path, 'utf-8');
      const data: RosterRound = JSON.parse(raw);

      if (!data.rosters || !Array.isArray(data.rosters)) {
        throw new Error('Invalid rosters.json: missing rosters array');
      }

      this.rosterData = data.rosters;
      this.buildIndex(data.rosters, data.roundNumber ?? 0);
    } catch {
      this.loaded = false;
    }
  }

  loadRosters(rosters: FantasyRoster[], matchdayNumber?: number): void {
    this.rosterData = rosters;
    this.buildIndex(rosters, matchdayNumber ?? 0);
  }

  matchEvent(event: PlayByPlayEvent): string[] {
    if (!this.loaded) return [];
    if (!NOTABLE_EVENT_TYPES.has(event.eventType)) return [];
    if (!event.playerName) return [];

    const key = RosterTracker.normalizeName(event.playerName);
    return this.playerIndex.get(key) ?? [];
  }

  getOverview(): string {
    if (!this.loaded || this.rosterData.length === 0) {
      return '📋 No fantasy rosters loaded.';
    }

    const lines = [`🏀 Fantasy Rosters — Matchday ${this.roundNumber}\n`];

    for (const roster of this.rosterData) {
      lines.push(`👤 ${roster.ownerName}`);

      const hasPositionData = roster.players.some(p => p.courtPosition != null);

      if (hasPositionData) {
        const sorted = [...roster.players].sort(
          (a, b) => (a.courtPosition ?? 99) - (b.courtPosition ?? 99),
        );
        const starters = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 1 && p.courtPosition <= 5);
        const bench = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 6 && p.courtPosition <= 10);
        const coach = sorted.filter(p => p.courtPosition != null && p.courtPosition >= 11);

        if (starters.length > 0) {
          lines.push('  🏟 Starting Five:');
          for (const p of starters) lines.push(`    ${this.formatPlayerLine(p)}`);
        }

        if (bench.length > 0) {
          lines.push('  📋 Bench:');
          for (const p of bench) lines.push(`    ${this.formatPlayerLine(p)}`);
        }

        if (coach.length > 0) {
          lines.push('  🧑‍💼 Coach:');
          for (const p of coach) lines.push(`    ${this.formatPlayerLine(p)}`);
        }
      } else {
        for (const p of roster.players) {
          lines.push(`  • ${p.playerName} (${p.teamCode})`);
        }
      }

      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  private formatPlayerLine(p: RosteredPlayer): string {
    const pos = p.position ? `${this.positionTag(p.position)} ` : '';
    const name = this.formatDisplayName(p.playerName);
    const matchup = p.opponentCode ? ` vs ${p.opponentCode}` : '';
    const captain = p.isCaptain ? ' ©' : '';
    const fire = p.isOnFire ? ' 🔥' : '';
    return `${pos}${name} (${p.teamCode}${matchup})${captain}${fire}`;
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

  private buildIndex(rosters: FantasyRoster[], roundNumber: number): void {
    this.playerIndex.clear();
    this.roundNumber = roundNumber;

    for (const roster of rosters) {
      for (const player of roster.players) {
        const key = RosterTracker.normalizeName(player.playerName);
        const owners = this.playerIndex.get(key) ?? [];
        owners.push(roster.ownerName);
        this.playerIndex.set(key, owners);
      }
    }

    this.loaded = rosters.length > 0;
  }
}
