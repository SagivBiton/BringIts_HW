import { QUERY_TTL_MS } from '@llm-query/types';
import type { QueryStore } from './query-store.interface';

export function runQueryStoreContractTests(
  name: string,
  createStore: (ttlMs?: number) => QueryStore,
): void {
  describe(`${name} QueryStore contract`, () => {
    it('creates a queued record and returns it on get', async () => {
      const store = createStore();
      const record = await store.create({
        source: 'gemini',
        prompt: 'hello',
        parse: true,
      });
      expect(record.status).toBe('queued');
      expect(record.request_id).toMatch(/^q_/);

      const fetched = await store.get(record.request_id);
      expect(fetched?.status).toBe('queued');
      expect(fetched?.prompt).toBe('hello');
    });

    it('returns null for unknown id', async () => {
      const store = createStore();
      expect(await store.get('q_missing')).toBeNull();
    });

    it('updates status to running then ok with result', async () => {
      const store = createStore();
      const record = await store.create({
        source: 'gemini',
        prompt: 'hi',
        parse: true,
      });
      await store.setStatus(record.request_id, 'running');
      await store.completeSuccess(record.request_id, {
        response_text: 'Hello!',
        duration_ms: 100,
        conversation_id: 'conv_test',
      });
      const done = await store.get(record.request_id);
      expect(done?.status).toBe('ok');
      expect(done?.result?.response_text).toBe('Hello!');
      expect(done?.result?.conversation_id).toBe('conv_test');
      expect(done?.duration_ms).toBe(100);
    });

    it('marks record expired after TTL', async () => {
      jest.useFakeTimers();
      const store = createStore(QUERY_TTL_MS);
      const record = await store.create({
        source: 'gemini',
        prompt: 'hi',
        parse: true,
      });
      jest.advanceTimersByTime(QUERY_TTL_MS + 1);
      const expired = await store.get(record.request_id);
      expect(expired?.status).toBe('expired');
      jest.useRealTimers();
    });
  });
}
