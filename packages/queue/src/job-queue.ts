import { JobPayload, WorkerKind } from '@llm-query/types';

export interface JobQueue {
  enqueue(job: JobPayload): Promise<void>;
  dequeue(worker: WorkerKind): Promise<JobPayload | null>;
}

/** In-memory stand-in for BullMQ; same contract as production Redis queues. */
export class InMemoryJobQueue implements JobQueue {
  private readonly queues: Record<WorkerKind, JobPayload[]> = {
    http: [],
    browser: [],
  };

  async enqueue(job: JobPayload): Promise<void> {
    this.queues[job.worker].push(job);
  }

  async dequeue(worker: WorkerKind): Promise<JobPayload | null> {
    return this.queues[worker].shift() ?? null;
  }
}
