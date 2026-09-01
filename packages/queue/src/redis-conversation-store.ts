import {
  ConversationRecord,
  ConversationTurn,
  SourceId,
  QUERY_TTL_MS,
  createConversationId,
} from '@llm-query/types';
import type { ConversationStore } from './conversation-store';
import type { RedisClient } from './redis-query-store';

type StoredRecord = ConversationRecord & { expires_at: number };

export class RedisConversationStore implements ConversationStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlMs: number = QUERY_TTL_MS,
  ) {}

  async create(source: SourceId): Promise<ConversationRecord> {
    const conversation_id = createConversationId();
    const now = new Date().toISOString();
    const record: StoredRecord = {
      conversation_id,
      source,
      turns: [],
      target_session: {},
      created_at: now,
      updated_at: now,
      expires_at: Date.now() + this.ttlMs,
    };
    await this.save(record);
    return this.strip(record);
  }

  async get(conversationId: string): Promise<ConversationRecord | null> {
    const record = await this.load(conversationId);
    if (!record) return null;
    if (Date.now() > record.expires_at) {
      return null;
    }
    return this.strip(record);
  }

  async appendTurn(
    conversationId: string,
    turns: ConversationTurn[],
    target_session?: Record<string, unknown>,
    proxy_id?: string,
  ): Promise<ConversationRecord | null> {
    const record = await this.load(conversationId);
    if (!record) return null;
    if (Date.now() > record.expires_at) {
      return null;
    }
    record.turns.push(...turns);
    if (target_session) {
      record.target_session = { ...record.target_session, ...target_session };
    }
    if (proxy_id !== undefined) {
      record.proxy_id = proxy_id;
    }
    record.updated_at = new Date().toISOString();
    record.expires_at = Date.now() + this.ttlMs;
    await this.save(record);
    return this.strip(record);
  }

  private key(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  private async load(conversationId: string): Promise<StoredRecord | null> {
    const raw = await this.redis.get(this.key(conversationId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as StoredRecord;
    } catch {
      return null;
    }
  }

  private async save(record: StoredRecord): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((this.ttlMs * 2) / 1000));
    await this.redis.set(
      this.key(record.conversation_id),
      JSON.stringify(record),
      'EX',
      ttlSeconds,
    );
  }

  private strip(record: StoredRecord): ConversationRecord {
    const { expires_at: _, ...rest } = record;
    return rest;
  }
}
