import type { JobPayload } from '@llm-query/types';
import type { JobQueue } from './job-queue';

export const sampleJob = (worker: 'http' | 'browser'): JobPayload => ({
  request_id: 'q_test',
  step_id: 'generate',
  source: worker === 'http' ? 'gemini' : 'chatgpt',
  worker,
  lease_id: 'lease_1',
  timeout_ms: 120_000,
  artifacts: {},
});

export function runJobQueueContractTests(
  name: string,
  createQueue: () => JobQueue | Promise<JobQueue>,
  opts?: { enabled?: () => boolean },
): void {
  const it_ = (title: string, fn: () => Promise<void>) => {
    it(title, async () => {
      if (opts?.enabled && !opts.enabled()) return;
      await fn();
    });
  };

  describe(`${name} JobQueue contract`, () => {
    it_('enqueues and dequeues http jobs in FIFO order', async () => {
      const queue = await createQueue();
      await queue.enqueue(sampleJob('http'));
      await queue.enqueue({ ...sampleJob('http'), request_id: 'q_second' });

      const first = await queue.dequeue('http');
      const second = await queue.dequeue('http');
      expect(first?.request_id).toBe('q_test');
      expect(second?.request_id).toBe('q_second');
    });

    it_('keeps http and browser queues separate', async () => {
      const queue = await createQueue();
      await queue.enqueue(sampleJob('http'));
      await queue.enqueue(sampleJob('browser'));

      expect((await queue.dequeue('http'))?.worker).toBe('http');
      expect((await queue.dequeue('browser'))?.worker).toBe('browser');
      expect(await queue.dequeue('http')).toBeNull();
    });

    it_('returns null when queue is empty', async () => {
      const queue = await createQueue();
      expect(await queue.dequeue('browser')).toBeNull();
    });
  });
}
