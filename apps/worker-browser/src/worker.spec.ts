import { buildStepRegistry, runRegisteredStep } from '@llm-query/worker-runtime';
import { chatgptBrowserStepMeta } from '@llm-query/adapters-chatgpt';
import { InMemoryJobQueue } from '@llm-query/queue';
import { InMemoryProxyPool } from '@llm-query/proxy';
import { InMemoryQueryStore } from '@llm-query/queue';
import { Orchestrator } from '@llm-query/orchestrator';
import { processOneBrowserJob } from '../src/worker';

describe('processOneBrowserJob', () => {
  it('dequeues, runs the chatgpt step, and completes the query', async () => {
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
          ...chatgptBrowserStepMeta,
          run: async () => ({
            artifacts: {
              htmlPartial: '<div data-message="assistant">Hello from ChatGPT</div>',
            },
          }),
        },
      ],
      'browser',
    );

    const { request_id } = await orchestrator.submit({
      source: 'chatgpt',
      prompt: 'hello',
      parse: true,
    });

    const processed = await processOneBrowserJob({
      jobQueue,
      orchestrator,
      proxyPool,
      store,
      registry,
    });
    expect(processed).toBe(true);

    const record = await store.get(request_id);
    expect(record?.status).toBe('ok');
    expect(record?.result?.response_text).toBe('Hello from ChatGPT');
  });
});
