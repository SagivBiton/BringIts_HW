import { Orchestrator } from '../src/orchestrator';
import { InMemoryProxyPool } from '@llm-query/proxy';
import {
  InMemoryQueryStore,
  InMemoryJobQueue,
  InMemoryConversationStore,
} from '@llm-query/queue';
import { geminiAdapter } from '@llm-query/adapters-gemini';

describe('Orchestrator', () => {
  const proxyPool = () =>
    new InMemoryProxyPool([
      {
        id: 'local',
        url: 'http://127.0.0.1:8080',
        geo: 'US',
        kind: 'local-test',
        mode: 'stateless',
        enabled: true,
      },
    ]);

  it('submits a query and returns queued status', async () => {
    const store = new InMemoryQueryStore();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
    });
    const res = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    expect(res.status).toBe('queued');
    expect(res.request_id).toMatch(/^q_/);
  });

  it('fails with GEO_UNAVAILABLE when explicit geo has no proxy', async () => {
    const store = new InMemoryQueryStore();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
    });
    await expect(
      orch.submit({
        source: 'gemini',
        prompt: 'hello',
        parse: true,
        geo_location: 'DE',
      }),
    ).rejects.toMatchObject({ code: 'GEO_UNAVAILABLE' });
  });

  it('enqueues gemini jobs on the http queue', async () => {
    const store = new InMemoryQueryStore();
    const jobQueue = new InMemoryJobQueue();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      jobQueue,
    });
    await orch.submit({ source: 'gemini', prompt: 'hello', parse: true });
    const job = await jobQueue.dequeue('http');
    expect(job?.worker).toBe('http');
    expect(job?.source).toBe('gemini');
  });

  it('runs gemini job end-to-end with injected step runner', async () => {
    const store = new InMemoryQueryStore();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      stepRunner: async () => ({
        artifacts: { streamBody: '"Hello from gemini"' },
      }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    const record = await store.get(request_id);
    expect(record?.status).toBe('ok');
    expect(record?.result?.response_text).toBe('Hello from gemini');
    expect(record?.result?.conversation_id).toMatch(/^conv_/);
  });

  it('continues a conversation with prior turns in the effective prompt', async () => {
    const store = new InMemoryQueryStore();
    const jobQueue = new InMemoryJobQueue();
    const conversations = new InMemoryConversationStore();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      jobQueue,
      conversationStore: conversations,
      stepRunner: async () => ({
        artifacts: { streamBody: '"First answer"' },
      }),
    });

    const first = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    const firstRecord = await store.get(first.request_id);
    const conversation_id = firstRecord?.result?.conversation_id;
    expect(conversation_id).toBeDefined();

    const orch2 = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      jobQueue,
      conversationStore: conversations,
      stepRunner: async () => ({
        artifacts: { streamBody: '"Follow-up answer"' },
      }),
    });
    const second = await orch2.submit({
      source: 'gemini',
      prompt: 'again',
      parse: true,
      conversation_id,
    });
    const job = await jobQueue.dequeue('http');
    expect(String(job?.artifacts.effective_prompt)).toContain('User: hello');
    expect(String(job?.artifacts.effective_prompt)).toContain('Assistant: First answer');
    expect(String(job?.artifacts.effective_prompt)).toContain('User: again');

    await orch2.processJob(job!);
    const secondRecord = await store.get(second.request_id);
    expect(secondRecord?.result?.conversation_id).toBe(conversation_id);
    expect(secondRecord?.result?.response_text).toBe('Follow-up answer');
  });

  it('fails with CONVERSATION_NOT_FOUND for unknown id', async () => {
    const orch = new Orchestrator({
      queryStore: new InMemoryQueryStore(),
      proxyPool: proxyPool(),
    });
    await expect(
      orch.submit({
        source: 'gemini',
        prompt: 'hi',
        parse: true,
        conversation_id: 'conv_missing',
      }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it('resolves adapter by source', () => {
    const orch = new Orchestrator({
      queryStore: new InMemoryQueryStore(),
      proxyPool: proxyPool(),
    });
    expect(orch.getAdapter('gemini').id).toBe(geminiAdapter.id);
  });

  it('completes TARGET_RATE_LIMITED on HTTP 429 and cools down the proxy', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => ({
        artifacts: {
          streamBody: 'Too Many Requests',
          httpStatus: 429,
          retryAfterMs: 12_000,
        },
      }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    const record = await store.get(request_id);
    expect(record?.status).toBe('error');
    expect(record?.error).toMatchObject({
      code: 'TARGET_RATE_LIMITED',
      http_status: 429,
      retryable: true,
      retry_after_ms: 12_000,
    });

    // Cooldown should make the only proxy ineligible for gemini.
    const next = await pool.acquire({ target: 'gemini' });
    expect(next).toBeNull();
  });

  it('uses same_lease retry policy for 429 when affinity is session', async () => {
    const store = new InMemoryQueryStore();
    const jobQueue = new InMemoryJobQueue();
    const conversations = new InMemoryConversationStore();
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      jobQueue,
      conversationStore: conversations,
      stepRunner: async () => ({
        artifacts: { streamBody: '"ok"', httpStatus: 200 },
      }),
    });
    const first = await orch.submit({ source: 'gemini', prompt: 'hi', parse: true });
    await orch.processNextJob('http');
    const conversation_id = (await store.get(first.request_id))?.result?.conversation_id;

    const orch2 = new Orchestrator({
      queryStore: store,
      proxyPool: proxyPool(),
      jobQueue,
      conversationStore: conversations,
      stepRunner: async () => ({
        artifacts: { streamBody: '', httpStatus: 429, retryAfterMs: 3000 },
      }),
    });
    const second = await orch2.submit({
      source: 'gemini',
      prompt: 'again',
      parse: true,
      conversation_id,
    });
    const job = await jobQueue.dequeue('http');
    expect(job?.artifacts.affinity).toBe('session');
    await orch2.processJob(job!);
    const record = await store.get(second.request_id);
    expect(record?.error).toMatchObject({
      code: 'TARGET_RATE_LIMITED',
      http_status: 429,
      retry_after_ms: 3000,
    });
  });

  it('completes TARGET_BLOCKED on HTTP 403 and cools down the proxy', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => ({
        artifacts: { streamBody: 'forbidden', httpStatus: 403 },
      }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    const record = await store.get(request_id);
    expect(record?.error).toMatchObject({
      code: 'TARGET_BLOCKED',
      http_status: 403,
    });
    expect(await pool.acquire({ target: 'gemini' })).toBeNull();
  });

  it('completes TARGET_UNAVAILABLE on HTTP 503 without cooling down proxy', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => ({
        artifacts: { streamBody: 'unavailable', httpStatus: 503 },
      }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    const record = await store.get(request_id);
    expect(record?.error).toMatchObject({
      code: 'TARGET_UNAVAILABLE',
      http_status: 503,
      retryable: false,
    });
    // neutral release → proxy reusable for gemini
    expect(await pool.acquire({ target: 'gemini' })).not.toBeNull();
  });

  it('completes TARGET_BLOCKED on challenge HTML and cools down proxy', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => ({
        artifacts: { streamBody: 'Please verify you are human to continue' },
      }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    expect((await store.get(request_id))?.error?.code).toBe('TARGET_BLOCKED');
    expect(await pool.acquire({ target: 'gemini' })).toBeNull();
  });

  it('completes EMPTY_RESPONSE with neutral proxy release', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => ({ artifacts: { streamBody: '' } }),
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    expect((await store.get(request_id))?.error?.code).toBe('EMPTY_RESPONSE');
    expect(await pool.acquire({ target: 'gemini' })).not.toBeNull();
  });

  it('maps step timeouts to TARGET_TIMEOUT with neutral proxy release', async () => {
    const store = new InMemoryQueryStore();
    const pool = new InMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://proxy-1',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const orch = new Orchestrator({
      queryStore: store,
      proxyPool: pool,
      stepRunner: async () => {
        throw new Error('locator.waitFor: Timeout 120000ms exceeded.');
      },
    });
    const { request_id } = await orch.submit({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    await orch.processNextJob('http');
    expect((await store.get(request_id))?.error).toMatchObject({
      code: 'TARGET_TIMEOUT',
      http_status: 504,
      retryable: true,
    });
    expect(await pool.acquire({ target: 'gemini' })).not.toBeNull();
  });
});
