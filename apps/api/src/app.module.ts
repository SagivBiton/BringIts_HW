import { Module } from '@nestjs/common';
import { QueriesController } from './queries/queries.controller';
import { QueriesService } from './queries/queries.service';
import {
  createQueryStore,
  createJobQueue,
  createConversationStore,
  QueryStore,
  JobQueue,
  ConversationStore,
} from '@llm-query/queue';
import { createProxyPool, ProxyPool } from '@llm-query/proxy';
import { Orchestrator } from '@llm-query/orchestrator';

export const QUERY_STORE = Symbol('QUERY_STORE');
export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const PROXY_POOL = Symbol('PROXY_POOL');
export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');

@Module({
  controllers: [QueriesController],
  providers: [
    {
      provide: QUERY_STORE,
      useFactory: () => createQueryStore(process.env.REDIS_URL),
    },
    {
      provide: JOB_QUEUE,
      useFactory: () => createJobQueue(process.env.REDIS_URL),
    },
    {
      provide: CONVERSATION_STORE,
      useFactory: () => createConversationStore(process.env.REDIS_URL),
    },
    {
      provide: PROXY_POOL,
      useFactory: async () => createProxyPool(process.env.DATABASE_URL),
    },
    {
      provide: Orchestrator,
      useFactory: (
        store: QueryStore,
        pool: ProxyPool,
        jobQueue: JobQueue,
        conversations: ConversationStore,
      ) =>
        new Orchestrator({
          queryStore: store,
          proxyPool: pool,
          jobQueue,
          conversationStore: conversations,
        }),
      inject: [QUERY_STORE, PROXY_POOL, JOB_QUEUE, CONVERSATION_STORE],
    },
    {
      provide: QueriesService,
      useFactory: (orchestrator: Orchestrator, store: QueryStore) =>
        new QueriesService(orchestrator, store),
      inject: [Orchestrator, QUERY_STORE],
    },
  ],
})
export class AppModule {}
