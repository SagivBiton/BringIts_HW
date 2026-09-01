import { ErrorCode } from '@llm-query/types';
import { JobQueue, QueryStore } from '@llm-query/queue';
import { ProxyPool } from '@llm-query/proxy';
import { Orchestrator } from '@llm-query/orchestrator';
import { runRegisteredStep, StepRegistration } from '@llm-query/worker-runtime';

export interface HttpWorkerDeps {
  jobQueue: JobQueue;
  orchestrator: Orchestrator;
  proxyPool: ProxyPool;
  store: QueryStore;
  registry: Map<string, StepRegistration>;
}

/** Process one http-queue job; returns whether a job was handled. */
export async function processOneHttpJob(deps: HttpWorkerDeps): Promise<boolean> {
  const job = await deps.jobQueue.dequeue('http');
  if (!job) return false;

  try {
    const record = await deps.store.get(job.request_id);
    if (!record) {
      await deps.proxyPool.release(job.lease_id, 'neutral');
      return true;
    }

    const proxyUrl = (await deps.proxyPool.getLeaseProxyUrl(job.lease_id)) ?? '';

    const prompt =
      typeof job.artifacts.effective_prompt === 'string'
        ? job.artifacts.effective_prompt
        : record.prompt;

    const { artifacts } = await runRegisteredStep(
      deps.registry,
      job,
      proxyUrl,
      prompt,
    );
    await deps.orchestrator.processJob(job, artifacts);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker-http] job ${job.request_id} failed:`, err);
    try {
      await deps.proxyPool.release(job.lease_id, 'neutral');
      await deps.store.completeError(
        job.request_id,
        {
          code: ErrorCode.INTERNAL_ERROR,
          message: err instanceof Error ? err.message : 'Internal error',
          http_status: 500,
          retryable: false,
          retry_after_ms: null,
        },
        0,
      );
    } catch (cleanupErr) {
      // eslint-disable-next-line no-console
      console.error(`[worker-http] cleanup failed for ${job.request_id}:`, cleanupErr);
    }
  }
  return true;
}
