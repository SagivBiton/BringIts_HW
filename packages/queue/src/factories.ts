import Redis from 'ioredis';
import { InMemoryQueryStore } from './query-store';
import { RedisQueryStore } from './redis-query-store';
import type { QueryStore } from './query-store.interface';
import { createJobQueue } from './bullmq-job-queue';
import type { JobQueue } from './job-queue';
import { InMemoryConversationStore } from './conversation-store';
import type { ConversationStore } from './conversation-store';
import { RedisConversationStore } from './redis-conversation-store';

export { createJobQueue };

export function createQueryStore(redisUrl?: string): QueryStore {
  if (redisUrl) {
    return new RedisQueryStore(new Redis(redisUrl));
  }
  return new InMemoryQueryStore();
}

/** Shared across API + workers when REDIS_URL is set (required for follow-ups). */
export function createConversationStore(redisUrl?: string): ConversationStore {
  if (redisUrl) {
    return new RedisConversationStore(new Redis(redisUrl));
  }
  return new InMemoryConversationStore();
}

export function createStores(redisUrl?: string): {
  queryStore: QueryStore;
  jobQueue: JobQueue;
  conversationStore: ConversationStore;
} {
  return {
    queryStore: createQueryStore(redisUrl),
    jobQueue: createJobQueue(redisUrl),
    conversationStore: createConversationStore(redisUrl),
  };
}
