import { readFileSync } from 'node:fs';
import type { StoragePort } from '../ports/storage.port.js';
import type { Logger } from '../shared/logger.js';

export class TriviaService {
  constructor(
    private readonly storage: StoragePort,
    private readonly logger: Logger,
  ) {}

  async getRandomTrivia(): Promise<string> {
    const trivia = await this.storage.getRandomTrivia();
    if (!trivia) {
      return '🤷 No trivia available yet. Try again later!';
    }

    return [
      '🏀 *EuroLeague Trivia*',
      '',
      `❓ ${trivia.question}`,
      '',
      `💡 ${trivia.answer}`,
      '',
      `📂 Category: ${trivia.category}`,
    ].join('\n');
  }

  async seedTrivia(dataPath: string): Promise<number> {
    try {
      const raw = readFileSync(dataPath, 'utf-8');
      const items: Array<{ question: string; answer: string; category: string }> = JSON.parse(raw);
      const count = await this.storage.seedTrivia(items);
      this.logger.info({ count, total: items.length }, 'Trivia seeded');
      return count;
    } catch (err) {
      this.logger.error({ error: String(err), dataPath }, 'Failed to seed trivia');
      return 0;
    }
  }
}
