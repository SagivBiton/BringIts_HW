import Redis from 'ioredis-mock';
import { RedisQueryStore } from './redis-query-store';
import { runQueryStoreContractTests } from './query-store.contract';

runQueryStoreContractTests('Redis', (ttlMs) => new RedisQueryStore(new Redis(), ttlMs));

describe('RedisQueryStore', () => {
  it('stores records under query:{id} keys', async () => {
    const redis = new Redis();
    const store = new RedisQueryStore(redis);
    const record = await store.create({
      source: 'gemini',
      prompt: 'hello',
      parse: true,
    });
    const raw = await redis.get(`query:${record.request_id}`);
    expect(raw).toBeTruthy();
  });
});
