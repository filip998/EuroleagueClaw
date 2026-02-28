import cron from 'node-cron';
import type { SchedulerPort } from '../../ports/scheduler.port.js';
import type { Logger } from '../../shared/logger.js';

type ScheduledEntry =
  | { type: 'cron'; task: cron.ScheduledTask }
  | { type: 'timeout'; timer: ReturnType<typeof setTimeout> };

export class NodeCronAdapter implements SchedulerPort {
  private readonly jobs = new Map<string, ScheduledEntry>();

  constructor(private readonly logger: Logger) {}

  schedule(id: string, cronExpression: string, handler: () => Promise<void>): void {
    this.cancel(id);

    const task = cron.schedule(cronExpression, () => {
      this.logger.info({ jobId: id }, 'Cron job started');
      handler().catch((err) => {
        this.logger.error({ jobId: id, err }, 'Cron job failed');
      });
    });

    this.jobs.set(id, { type: 'cron', task });
    this.logger.info({ jobId: id, cronExpression }, 'Cron job scheduled');
  }

  scheduleOnce(id: string, delayMs: number, handler: () => Promise<void>): void {
    this.cancel(id);

    const timer = setTimeout(() => {
      this.logger.info({ jobId: id }, 'One-shot job started');
      handler()
        .catch((err) => {
          this.logger.error({ jobId: id, err }, 'One-shot job failed');
        })
        .finally(() => {
          this.jobs.delete(id);
        });
    }, delayMs);

    this.jobs.set(id, { type: 'timeout', timer });
    this.logger.info({ jobId: id, delayMs }, 'One-shot job scheduled');
  }

  cancel(id: string): void {
    const entry = this.jobs.get(id);
    if (!entry) return;

    if (entry.type === 'cron') {
      entry.task.stop();
    } else {
      clearTimeout(entry.timer);
    }

    this.jobs.delete(id);
    this.logger.info({ jobId: id }, 'Job cancelled');
  }

  cancelAll(): void {
    for (const [id] of this.jobs) {
      this.cancel(id);
    }
  }

  isScheduled(id: string): boolean {
    return this.jobs.has(id);
  }
}
