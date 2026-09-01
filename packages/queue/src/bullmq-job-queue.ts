import { Queue, type QueueOptions } from 'bullmq';
import { JobPayload, WorkerKind } from '@llm-query/types';
import type { JobQueue } from './job-queue';
import { InMemoryJobQueue } from './job-queue';

const QUEUE_NAMES: Record<WorkerKind, string> = {
  http: 'llm-queue-http',
  browser: 'llm-queue-browser',
};

export interface BullMQConnection {
  url?: string;
  host?: string;
  port?: number;
  prefix?: string;
}

export class BullMQJobQueue implements JobQueue {
  private readonly queues: Record<WorkerKind, Queue>;

  constructor(connection: BullMQConnection) {
    const { prefix, ...conn } = connection;
    const opts: QueueOptions = {
      connection: conn.url
        ? { url: conn.url, maxRetriesPerRequest: null }
        : { host: conn.host ?? '127.0.0.1', port: conn.port ?? 6379, maxRetriesPerRequest: null },
      ...(prefix ? { prefix } : {}),
    };
    this.queues = {
      http: new Queue(QUEUE_NAMES.http, opts),
      browser: new Queue(QUEUE_NAMES.browser, opts),
    };
  }

  async enqueue(job: JobPayload): Promise<void> {
    const queue = this.queues[job.worker];
    await queue.add(job.step_id, job, {
      jobId: `${job.request_id}-${job.step_id}`,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async dequeue(worker: WorkerKind): Promise<JobPayload | null> {
    const queue = this.queues[worker];
    const jobs = await queue.getWaiting(0, 0);
    const job = jobs[0];
    if (!job) return null;
    const payload = job.data as JobPayload;
    await job.remove();
    return payload;
  }

  async close(): Promise<void> {
    await Promise.all([
      this.queues.http.close(),
      this.queues.browser.close(),
    ]);
  }
}

export function createJobQueue(redisUrl?: string): JobQueue {
  if (redisUrl) {
    return new BullMQJobQueue({ url: redisUrl });
  }
  return new InMemoryJobQueue();
}
