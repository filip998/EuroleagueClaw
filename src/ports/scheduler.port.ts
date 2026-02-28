/**
 * Port for scheduling recurring and one-shot jobs.
 * Adapters: node-cron, in-memory timer, etc.
 */
export interface SchedulerPort {
  /** Schedule a recurring job with a cron expression */
  schedule(id: string, cronExpression: string, handler: () => Promise<void>): void;

  /** Schedule a one-shot job after a delay in milliseconds */
  scheduleOnce(id: string, delayMs: number, handler: () => Promise<void>): void;

  /** Cancel a scheduled job */
  cancel(id: string): void;

  /** Cancel all scheduled jobs */
  cancelAll(): void;

  /** Check if a job is scheduled */
  isScheduled(id: string): boolean;
}
