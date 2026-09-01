import Redis from 'ioredis';
import { BullMQJobQueue } from './bullmq-job-queue';
import { runJobQueueContractTests } from './job-queue.contract';
import { sampleJob } from './job-queue.contract';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function isRedisReachable(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1000 });
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    await redis.quit();
  }
}

describe('BullMQJobQueue', () => {
  let redisAvailable = false;
  let queue: BullMQJobQueue;

  beforeAll(async () => {
    redisAvailable = await isRedisReachable();
    if (!redisAvailable) {
      console.warn(`Skipping BullMQ contract tests — Redis not reachable at ${REDIS_URL}`);
    }
  });

  beforeEach(() => {
    if (!redisAvailable) return;
    queue = new BullMQJobQueue({
      url: REDIS_URL,
      prefix: `test-${process.pid}-${Date.now()}`,
    });
  });

  afterEach(async () => {
    if (queue) await queue.close();
  });

  runJobQueueContractTests('BullMQ', () => queue, { enabled: () => redisAvailable });

  it('dequeues a job when Redis is available', async () => {
    if (!redisAvailable) return;
    const job = sampleJob('http');
    await queue.enqueue(job);
    const dequeued = await queue.dequeue('http');
    expect(dequeued?.request_id).toBe(job.request_id);
  });
});
