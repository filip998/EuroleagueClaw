import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import cron from 'node-cron';
import { NodeCronAdapter } from '../../src/adapters/scheduler/node-cron.adapter.js';

vi.mock('node-cron', () => {
  return {
    default: {
      schedule: vi.fn(),
    },
  };
});

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  } as any;
}

function createMockTask() {
  return { stop: vi.fn() };
}

describe('NodeCronAdapter', () => {
  let adapter: NodeCronAdapter;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = createMockLogger();
    adapter = new NodeCronAdapter(logger);
    vi.mocked(cron.schedule).mockReset();
  });

  afterEach(() => {
    adapter.cancelAll();
    vi.useRealTimers();
  });

  describe('schedule', () => {
    it('should register a cron job', () => {
      const mockTask = createMockTask();
      vi.mocked(cron.schedule).mockReturnValue(mockTask as any);

      adapter.schedule('job-1', '* * * * *', async () => {});

      expect(cron.schedule).toHaveBeenCalledWith('* * * * *', expect.any(Function));
      expect(adapter.isScheduled('job-1')).toBe(true);
    });

    it('should cancel existing job before scheduling with same id', () => {
      const mockTask1 = createMockTask();
      const mockTask2 = createMockTask();
      vi.mocked(cron.schedule)
        .mockReturnValueOnce(mockTask1 as any)
        .mockReturnValueOnce(mockTask2 as any);

      adapter.schedule('job-1', '* * * * *', async () => {});
      adapter.schedule('job-1', '*/5 * * * *', async () => {});

      expect(mockTask1.stop).toHaveBeenCalled();
      expect(adapter.isScheduled('job-1')).toBe(true);
    });

    it('should catch handler errors without crashing', async () => {
      const mockTask = createMockTask();
      let capturedCallback: () => void;
      vi.mocked(cron.schedule).mockImplementation((_expr, cb) => {
        capturedCallback = cb as () => void;
        return mockTask as any;
      });

      const error = new Error('handler failed');
      adapter.schedule('job-1', '* * * * *', async () => { throw error; });

      capturedCallback!();
      await vi.advanceTimersByTimeAsync(0);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1', err: error }),
        'Cron job failed',
      );
    });
  });

  describe('scheduleOnce', () => {
    it('should fire after the specified delay', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      adapter.scheduleOnce('once-1', 5000, handler);
      expect(adapter.isScheduled('once-1')).toBe(true);
      expect(handler).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should remove itself after firing', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      adapter.scheduleOnce('once-1', 1000, handler);
      await vi.advanceTimersByTimeAsync(1000);

      expect(adapter.isScheduled('once-1')).toBe(false);
    });

    it('should catch handler errors without crashing', async () => {
      const error = new Error('once handler failed');
      adapter.scheduleOnce('once-1', 1000, async () => { throw error; });

      await vi.advanceTimersByTimeAsync(1000);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'once-1', err: error }),
        'One-shot job failed',
      );
    });
  });

  describe('cancel', () => {
    it('should stop a cron job', () => {
      const mockTask = createMockTask();
      vi.mocked(cron.schedule).mockReturnValue(mockTask as any);

      adapter.schedule('job-1', '* * * * *', async () => {});
      adapter.cancel('job-1');

      expect(mockTask.stop).toHaveBeenCalled();
      expect(adapter.isScheduled('job-1')).toBe(false);
    });

    it('should clear a timeout job', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);

      adapter.scheduleOnce('once-1', 5000, handler);
      adapter.cancel('once-1');

      await vi.advanceTimersByTimeAsync(5000);

      expect(handler).not.toHaveBeenCalled();
      expect(adapter.isScheduled('once-1')).toBe(false);
    });

    it('should be a no-op for unknown ids', () => {
      expect(() => adapter.cancel('unknown')).not.toThrow();
    });
  });

  describe('cancelAll', () => {
    it('should cancel all scheduled jobs', () => {
      const mockTask1 = createMockTask();
      const mockTask2 = createMockTask();
      vi.mocked(cron.schedule)
        .mockReturnValueOnce(mockTask1 as any)
        .mockReturnValueOnce(mockTask2 as any);

      adapter.schedule('cron-1', '* * * * *', async () => {});
      adapter.schedule('cron-2', '*/5 * * * *', async () => {});
      adapter.scheduleOnce('once-1', 5000, async () => {});

      adapter.cancelAll();

      expect(mockTask1.stop).toHaveBeenCalled();
      expect(mockTask2.stop).toHaveBeenCalled();
      expect(adapter.isScheduled('cron-1')).toBe(false);
      expect(adapter.isScheduled('cron-2')).toBe(false);
      expect(adapter.isScheduled('once-1')).toBe(false);
    });
  });

  describe('isScheduled', () => {
    it('should return false for unknown ids', () => {
      expect(adapter.isScheduled('nope')).toBe(false);
    });

    it('should return true for scheduled jobs', () => {
      const mockTask = createMockTask();
      vi.mocked(cron.schedule).mockReturnValue(mockTask as any);

      adapter.schedule('job-1', '* * * * *', async () => {});
      expect(adapter.isScheduled('job-1')).toBe(true);
    });
  });
});
