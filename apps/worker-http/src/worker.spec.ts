import { buildStepRegistry, runRegisteredStep } from '@llm-query/worker-runtime';
import { geminiHttpStepMeta } from '@llm-query/adapters-gemini';
import { InMemoryJobQueue } from '@llm-query/queue';
import { InMemoryProxyPool } from '@llm-query/proxy';
import { InMemoryQueryStore } from '@llm-query/queue';
import { Orchestrator } from '@llm-query/orchestrator';
import { processOneHttpJob } from '../src/worker';

describe('processOneHttpJob', () => {
  it('dequeues, runs the gemini step, and completes the query', async () => {
    const store = new InMemoryQueryStore();
    const jobQueue = new InMemoryJobQueue();
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
          run: async () => ({ artifacts: { streamBody: '"Worker says hi"' } }),
        },
      ],
      'http',
    );

    const { request_id } = await orchestrator.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });

    const processed = await processOneHttpJob({
      jobQueue,
      orchestrator,
      proxyPool,
      store,
      registry,
    });
    expect(processed).toBe(true);

    const record = await store.get(request_id);
    expect(record?.status).toBe('ok');
    expect(record?.result?.response_text).toBe('Worker says hi');
  });

  it('returns false when no job is waiting', async () => {
    const processed = await processOneHttpJob({
      jobQueue: new InMemoryJobQueue(),
      orchestrator: new Orchestrator({
        queryStore: new InMemoryQueryStore(),
        proxyPool: new InMemoryProxyPool([]),
      }),
      proxyPool: new InMemoryProxyPool([]),
      store: new InMemoryQueryStore(),
      registry: buildStepRegistry([], 'http'),
    });
    expect(processed).toBe(false);
  });

  it('marks error and releases lease when the step throws', async () => {
    const store = new InMemoryQueryStore();
    const jobQueue = new InMemoryJobQueue();
    const proxyPool = new InMemoryProxyPool([
      {
        id: 'local',
        url: 'direct',
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
          run: async () => {
            throw new Error('Headers Overflow Error');
          },
        },
      ],
      'http',
    );

    const { request_id } = await orchestrator.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });

    const processed = await processOneHttpJob({
      jobQueue,
      orchestrator,
      proxyPool,
      store,
      registry,
    });
    expect(processed).toBe(true);

    const record = await store.get(request_id);
    expect(record?.status).toBe('error');
    expect(record?.error?.message).toContain('Headers Overflow');

    const again = await proxyPool.acquire({
      request_id: 'next',
      target: 'gemini',
    });
    expect(again).not.toBeNull();
  });
});
