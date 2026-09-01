import {
  ConversationRecord,
  ConversationTurn,
  SourceId,
  QUERY_TTL_MS,
  createConversationId,
} from '@llm-query/types';

export interface ConversationStore {
  create(source: SourceId): Promise<ConversationRecord>;
  get(conversationId: string): Promise<ConversationRecord | null>;
  appendTurn(
    conversationId: string,
    turns: ConversationTurn[],
    target_session?: Record<string, unknown>,
    proxy_id?: string,
  ): Promise<ConversationRecord | null>;
}

export class InMemoryConversationStore implements ConversationStore {
  private readonly records = new Map<
    string,
    ConversationRecord & { expires_at: number }
  >();

  constructor(private readonly ttlMs: number = QUERY_TTL_MS) {}

  async create(source: SourceId): Promise<ConversationRecord> {
    const conversation_id = createConversationId();
    const now = new Date().toISOString();
    const record: ConversationRecord & { expires_at: number } = {
      conversation_id,
      source,
      turns: [],
      target_session: {},
      created_at: now,
      updated_at: now,
      expires_at: Date.now() + this.ttlMs,
    };
    this.records.set(conversation_id, record);
    return this.strip(record);
  }

  async get(conversationId: string): Promise<ConversationRecord | null> {
    const record = this.records.get(conversationId);
    if (!record) return null;
    if (Date.now() > record.expires_at) {
      this.records.delete(conversationId);
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
    const record = this.records.get(conversationId);
    if (!record) return null;
    if (Date.now() > record.expires_at) {
      this.records.delete(conversationId);
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
    return this.strip(record);
  }

  private strip(
    record: ConversationRecord & { expires_at: number },
  ): ConversationRecord {
    const { expires_at: _, ...rest } = record;
    return rest;
  }
}
