import {
  createQueryStore,
  createJobQueue,
  createConversationStore,
} from '@llm-query/queue';
import { createProxyPool } from '@llm-query/proxy';
import { Orchestrator } from '@llm-query/orchestrator';
import { buildStepRegistry } from '@llm-query/worker-runtime';
import { geminiHttpStepMeta } from '@llm-query/adapters-gemini';
import { processOneHttpJob } from './worker';

const POLL_MS = 500;

async function main(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  const store = createQueryStore(redisUrl);
  const jobQueue = createJobQueue(redisUrl);
  const conversationStore = createConversationStore(redisUrl);
  const proxyPool = await createProxyPool(process.env.DATABASE_URL);
  const orchestrator = new Orchestrator({
    queryStore: store,
    proxyPool,
    jobQueue,
    conversationStore,
  });
  const registry = buildStepRegistry([geminiHttpStepMeta], 'http');

  // eslint-disable-next-line no-console
  console.log(
    `worker-http started (redis=${redisUrl ? 'yes' : 'in-memory'}, pg=${process.env.DATABASE_URL ? 'yes' : 'in-memory'})`,
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const handled = await processOneHttpJob({
        jobQueue,
        orchestrator,
        proxyPool,
        store,
        registry,
      });
      if (!handled) {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (err) {
      // Keep the process alive; a single job must not take down the worker.
      // eslint-disable-next-line no-console
      console.error('[worker-http] unexpected loop error:', err);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
