import Redis from 'ioredis';
import { createQueryStore, createJobQueue } from '@llm-query/queue';
import { InMemoryProxyPool } from '@llm-query/proxy';
import { Orchestrator } from '@llm-query/orchestrator';
import { buildStepRegistry } from '@llm-query/worker-runtime';
import { geminiHttpStepMeta } from '@llm-query/adapters-gemini';
import { processOneHttpJob } from '../src/worker';

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

describe('async pipeline (Redis + BullMQ)', () => {
  let redisAvailable = false;

  beforeAll(async () => {
    redisAvailable = await isRedisReachable();
  });

  it('submit → worker dequeue → ok result', async () => {
    if (!redisAvailable) return;

    const store = createQueryStore(REDIS_URL);
    const jobQueue = createJobQueue(REDIS_URL);
    const proxyPool = new InMemoryProxyPool([
      {
        id: 'local',
        url: 'http://127.0.0.1:8080',
        geo: 'US',
        kind: 'local-test',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orchestrator = new Orchestrator({ queryStore: store, proxyPool, jobQueue });
    const registry = buildStepRegistry(
      [
        {
          ...geminiHttpStepMeta,
          run: async () => ({ artifacts: { streamBody: '"Async pipeline works"' } }),
        },
      ],
      'http',
    );

    const { request_id } = await orchestrator.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });

    const handled = await processOneHttpJob({
      jobQueue,
      orchestrator,
      proxyPool,
      store,
      registry,
    });
    expect(handled).toBe(true);

    const record = await store.get(request_id);
    expect(record?.status).toBe('ok');
    expect(record?.result?.response_text).toBe('Async pipeline works');

    if (jobQueue instanceof (await import('@llm-query/queue')).BullMQJobQueue) {
      await jobQueue.close();
    }
  });
});
