import Redis from 'ioredis';
import { RedisConversationStore } from './redis-conversation-store';
import { QUERY_TTL_MS } from '@llm-query/types';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

async function isRedisReachable(): Promise<boolean> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 1000 });
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

describe('RedisConversationStore', () => {
  let redisAvailable = false;

  beforeAll(async () => {
    redisAvailable = await isRedisReachable();
    if (!redisAvailable) {
      console.warn('Redis unavailable — skipping RedisConversationStore tests');
    }
  });

  it('creates, appends turns, and merges target_session', async () => {
    if (!redisAvailable) return;
    const redis = new Redis(REDIS_URL);
    const store = new RedisConversationStore(redis, QUERY_TTL_MS);
    const conv = await store.create('gemini');
    expect(conv.conversation_id).toMatch(/^conv_/);

    await store.appendTurn(
      conv.conversation_id,
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      { gemini_c: 'c_abc' },
    );
    await store.appendTurn(conv.conversation_id, [], { gemini_r: 'r_xyz' });

    const fetched = await store.get(conv.conversation_id);
    expect(fetched?.turns).toHaveLength(2);
    expect(fetched?.target_session).toEqual({ gemini_c: 'c_abc', gemini_r: 'r_xyz' });
    await redis.quit();
  });

  it('returns null for missing conversations', async () => {
    if (!redisAvailable) return;
    const redis = new Redis(REDIS_URL);
    const store = new RedisConversationStore(redis);
    expect(await store.get('conv_missing_xyz')).toBeNull();
    await redis.quit();
  });
});
