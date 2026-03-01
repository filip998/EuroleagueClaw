import { readFileSync } from 'node:fs';
import type { FantasyRoster, PlayByPlayEvent, PlayByPlayEventType, RosterRound } from './types.js';

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

      this.buildIndex(data.rosters, data.roundNumber ?? 0);
    } catch {
      this.loaded = false;
    }
  }

  loadRosters(rosters: FantasyRoster[]): void {
    this.buildIndex(rosters, 0);
  }

  matchEvent(event: PlayByPlayEvent): string[] {
    if (!this.loaded) return [];
    if (!NOTABLE_EVENT_TYPES.has(event.eventType)) return [];
    if (!event.playerName) return [];

    const key = RosterTracker.normalizeName(event.playerName);
    return this.playerIndex.get(key) ?? [];
  }

  getOverview(): string {
    if (!this.loaded || this.playerIndex.size === 0) {
      return '📋 No fantasy rosters loaded.';
    }

    const ownerPlayers = new Map<string, string[]>();
    for (const [name, owners] of this.playerIndex) {
      for (const owner of owners) {
        const list = ownerPlayers.get(owner) ?? [];
        list.push(name);
        ownerPlayers.set(owner, list);
      }
    }

    const lines = [`🏀 Fantasy Rosters — Round ${this.roundNumber}\n`];
    for (const [owner, players] of ownerPlayers) {
      lines.push(`📋 ${owner}:`);
      for (const p of players) {
        lines.push(`  • ${p}`);
      }
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  isLoaded(): boolean {
    return this.loaded;
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
