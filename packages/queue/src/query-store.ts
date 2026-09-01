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

export class InMemoryQueryStore implements QueryStore {
  private readonly records = new Map<string, QueryRecord & { expires_at: number }>();

  constructor(private readonly ttlMs: number = QUERY_TTL_MS) {}

  async create(cmd: QueryCommand): Promise<QueryRecord> {
    const request_id = createRequestId();
    const now = new Date().toISOString();
    const record: QueryRecord & { expires_at: number } = {
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
    this.records.set(request_id, record);
    return this.strip(record);
  }

  async get(requestId: string): Promise<QueryRecord | null> {
    const record = this.records.get(requestId);
    if (!record) return null;
    if (Date.now() > record.expires_at && record.status !== 'ok' && record.status !== 'error') {
      record.status = 'expired';
    }
    return this.strip(record);
  }

  async setStatus(requestId: string, status: QueryStatus): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) return;
    record.status = status;
    if (status === 'running' && !record.started_at) {
      record.started_at = new Date().toISOString();
    }
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
    const record = this.records.get(requestId);
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
  }

  async completeError(
    requestId: string,
    error: PublicErrorBody,
    duration_ms: number,
  ): Promise<void> {
    const record = this.records.get(requestId);
    if (!record) return;
    record.status = 'error';
    record.finished_at = new Date().toISOString();
    record.duration_ms = duration_ms;
    record.error = error;
  }

  private strip(record: QueryRecord & { expires_at: number }): QueryRecord {
    const { expires_at: _, ...rest } = record;
    return rest;
  }
}
