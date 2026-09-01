import {
  QueryRecord,
  QueryCommand,
  QuerySuccessBody,
  PublicErrorBody,
  QueryStatus,
  QUERY_TTL_MS,
  createRequestId,
} from '@llm-query/types';
import type { QueryStore } from './query-store.interface';

type StoredRecord = QueryRecord & { expires_at: number };

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

export class RedisQueryStore implements QueryStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly ttlMs: number = QUERY_TTL_MS,
  ) {}

  async create(cmd: QueryCommand): Promise<QueryRecord> {
    const request_id = createRequestId();
    const now = new Date().toISOString();
    const record: StoredRecord = {
      request_id,
      status: 'queued',
      source: cmd.source,
      prompt: cmd.prompt,
      parse: cmd.parse,
      geo_location: cmd.geo_location,
      conversation_id: cmd.conversation_id,
      created_at: now,
      expires_at: Date.now() + this.ttlMs,
    };
    await this.save(record);
    return this.strip(record);
  }

  async get(requestId: string): Promise<QueryRecord | null> {
    const record = await this.load(requestId);
    if (!record) return null;
    if (
      Date.now() > record.expires_at &&
      record.status !== 'ok' &&
      record.status !== 'error'
    ) {
      record.status = 'expired';
      await this.save(record);
    }
    return this.strip(record);
  }

  async setStatus(requestId: string, status: QueryStatus): Promise<void> {
    const record = await this.load(requestId);
    if (!record) return;
    record.status = status;
    if (status === 'running' && !record.started_at) {
      record.started_at = new Date().toISOString();
    }
    await this.save(record);
  }

  async completeSuccess(
    requestId: string,
    partial: {
      response_text: string;
      duration_ms: number;
      payload?: Record<string, unknown>;
      conversation_id: string;
    },
  ): Promise<void> {
    const record = await this.load(requestId);
    if (!record) return;
    const finished = new Date().toISOString();
    record.status = 'ok';
    record.finished_at = finished;
    record.duration_ms = partial.duration_ms;
    record.conversation_id = partial.conversation_id;
    const body: QuerySuccessBody = {
      request_id: requestId,
      status: 'ok',
      duration_ms: partial.duration_ms,
      source: record.source,
      prompt: record.prompt,
      parse: record.parse,
      geo_location: record.geo_location,
      conversation_id: partial.conversation_id,
      response_text: partial.response_text,
      ...(record.parse ? {} : { payload: partial.payload }),
    };
    record.result = body;
    await this.save(record);
  }

  async completeError(
    requestId: string,
    error: PublicErrorBody,
    duration_ms: number,
  ): Promise<void> {
    const record = await this.load(requestId);
    if (!record) return;
    record.status = 'error';
    record.finished_at = new Date().toISOString();
    record.duration_ms = duration_ms;
    record.error = error;
    await this.save(record);
  }

  private key(requestId: string): string {
    return `query:${requestId}`;
  }

  private async load(requestId: string): Promise<StoredRecord | null> {
    const raw = await this.redis.get(this.key(requestId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredRecord;
  }

  private async save(record: StoredRecord): Promise<void> {
    // Keep the key past logical expiry so GET can return status=expired (DESIGN.md).
    const redisTtlSeconds = Math.max(1, Math.ceil((this.ttlMs * 2) / 1000));
    await this.redis.set(this.key(record.request_id), JSON.stringify(record), 'EX', redisTtlSeconds);
  }

  private strip(record: StoredRecord): QueryRecord {
    const { expires_at: _, ...rest } = record;
    return rest;
  }
}
