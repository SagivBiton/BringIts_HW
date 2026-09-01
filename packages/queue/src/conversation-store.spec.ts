import { InMemoryConversationStore } from './conversation-store';
import { QUERY_TTL_MS } from '@llm-query/types';

describe('InMemoryConversationStore', () => {
  it('creates an empty conversation for a source', async () => {
    const store = new InMemoryConversationStore();
    const conv = await store.create('gemini');
    expect(conv.conversation_id).toMatch(/^conv_/);
    expect(conv.source).toBe('gemini');
    expect(conv.turns).toEqual([]);
  });

  it('appends user and assistant turns', async () => {
    const store = new InMemoryConversationStore();
    const conv = await store.create('chatgpt');
    await store.appendTurn(conv.conversation_id, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    const fetched = await store.get(conv.conversation_id);
    expect(fetched?.turns).toHaveLength(2);
    expect(fetched?.turns[1].content).toBe('hello');
  });

  it('merges target_session artifacts', async () => {
    const store = new InMemoryConversationStore();
    const conv = await store.create('gemini');
    await store.appendTurn(
      conv.conversation_id,
      [{ role: 'user', content: 'a' }],
      { gemini_c: 'c_123' },
    );
    await store.appendTurn(
      conv.conversation_id,
      [{ role: 'assistant', content: 'b' }],
      { gemini_r: 'r_456' },
    );
    const fetched = await store.get(conv.conversation_id);
    expect(fetched?.target_session).toEqual({ gemini_c: 'c_123', gemini_r: 'r_456' });
  });

  it('returns null after TTL', async () => {
    jest.useFakeTimers();
    const store = new InMemoryConversationStore(QUERY_TTL_MS);
    const conv = await store.create('gemini');
    jest.advanceTimersByTime(QUERY_TTL_MS + 1);
    expect(await store.get(conv.conversation_id)).toBeNull();
    jest.useRealTimers();
  });
});
