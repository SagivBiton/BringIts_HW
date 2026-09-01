import { JobPayload, WorkerKind } from '@llm-query/types';

export interface StepRegistration {
  id: string;
  worker: WorkerKind;
  source: string;
  run: (ctx: {
    proxyUrl: string;
    prompt: string;
    job: JobPayload;
  }) => Promise<{ artifacts: Record<string, unknown> }>;
}

export function buildStepRegistry(
  steps: StepRegistration[],
  worker?: WorkerKind,
): Map<string, StepRegistration> {
  const filtered = worker ? steps.filter((s) => s.worker === worker) : steps;
  return new Map(filtered.map((s) => [`${s.source}:${s.id}`, s]));
}

export async function runRegisteredStep(
  registry: Map<string, StepRegistration>,
  job: JobPayload,
  proxyUrl: string,
  prompt: string,
): Promise<{ artifacts: Record<string, unknown> }> {
  const key = `${job.source}:${job.step_id}`;
  const step = registry.get(key);
  if (!step) {
    throw new Error(`Step not registered: ${key}`);
  }
  return step.run({ proxyUrl, prompt, job });
}
