import type { FantasyPort } from '../ports/fantasy.port.js';
import type { Logger } from '../shared/logger.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export class FantasyTracker {
  constructor(
    private readonly fantasy: FantasyPort,
    private readonly logger: Logger,
  ) {}

  async getOverview(): Promise<string> {
    try {
      const standings = await this.fantasy.getStandings();

      if (standings.entries.length === 0) {
        return '🏀 No fantasy standings available right now.';
      }

      const header = `🏀 Fantasy Standings — ${standings.roundName}\n`;
      const separator = '─'.repeat(28) + '\n';

      const rows = standings.entries.map((e) => {
        const medal = e.rank <= MEDALS.length ? MEDALS[e.rank - 1] : `${e.rank}.`;
        const delta = e.roundPoints > 0 ? ` (+${e.roundPoints})` : '';
        return `${medal} ${e.teamName} — ${e.totalPoints} pts${delta}`;
      });

      return header + separator + rows.join('\n');
    } catch (err) {
      this.logger.error({ error: String(err) }, 'Failed to fetch fantasy standings');
      return '❌ Could not load fantasy standings. Please try again later.';
    }
  }
}
