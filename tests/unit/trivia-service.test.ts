import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriviaService } from '../../src/domain/trivia-service.js';
import type { StoragePort } from '../../src/ports/storage.port.js';
import type { TriviaQuestion } from '../../src/domain/types.js';

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

function createMockStorage(trivia: TriviaQuestion | null = null): StoragePort {
  return {
    getRandomTrivia: vi.fn().mockResolvedValue(trivia),
    seedTrivia: vi.fn().mockResolvedValue(0),
    initialize: vi.fn(),
    close: vi.fn(),
    addTrackedGame: vi.fn(),
    removeTrackedGame: vi.fn(),
    getTrackedGame: vi.fn(),
    getTrackedGamesByChat: vi.fn(),
    getAllTrackedGames: vi.fn(),
    updateTrackedGame: vi.fn(),
    getOrCreateSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    hasEventBeenSent: vi.fn(),
    markEventSent: vi.fn(),
  };
}

describe('TriviaService', () => {
  let service: TriviaService;
  let storage: StoragePort;
  let logger: ReturnType<typeof createMockLogger>;

  describe('getRandomTrivia', () => {
    it('should format trivia as a message', async () => {
      const trivia: TriviaQuestion = {
        id: 1,
        question: 'Which team has won the most EuroLeague titles?',
        answer: 'Real Madrid with 11 titles',
        category: 'records',
      };
      storage = createMockStorage(trivia);
      logger = createMockLogger();
      service = new TriviaService(storage, logger);

      const result = await service.getRandomTrivia();

      expect(result).toContain('EuroLeague Trivia');
      expect(result).toContain(trivia.question);
      expect(result).toContain(trivia.answer);
      expect(result).toContain('records');
    });

    it('should return fallback message when no trivia available', async () => {
      storage = createMockStorage(null);
      logger = createMockLogger();
      service = new TriviaService(storage, logger);

      const result = await service.getRandomTrivia();

      expect(result).toContain('No trivia available');
    });
  });

  describe('seedTrivia', () => {
    beforeEach(() => {
      storage = createMockStorage();
      logger = createMockLogger();
      service = new TriviaService(storage, logger);
    });

    it('should seed trivia from a JSON file', async () => {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const os = await import('node:os');

      const tmpDir = os.tmpdir();
      const filePath = join(tmpDir, `trivia-test-${Date.now()}.json`);
      const data = [
        { question: 'Q1?', answer: 'A1', category: 'records' },
        { question: 'Q2?', answer: 'A2', category: 'history' },
      ];
      writeFileSync(filePath, JSON.stringify(data));

      vi.mocked(storage.seedTrivia).mockResolvedValue(2);
      const count = await service.seedTrivia(filePath);

      expect(count).toBe(2);
      expect(storage.seedTrivia).toHaveBeenCalledWith(data);

      // Cleanup
      const { unlinkSync } = await import('node:fs');
      unlinkSync(filePath);
    });

    it('should return 0 and log error for invalid path', async () => {
      const count = await service.seedTrivia('/nonexistent/trivia.json');

      expect(count).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
