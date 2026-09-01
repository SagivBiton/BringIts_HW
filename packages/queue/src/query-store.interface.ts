import {
  QueryRecord,
  QueryCommand,
  PublicErrorBody,
  QueryStatus,
} from '@llm-query/types';

export interface QueryStore {
  create(cmd: QueryCommand): Promise<QueryRecord>;
  get(requestId: string): Promise<QueryRecord | null>;
  setStatus(requestId: string, status: QueryStatus): Promise<void>;
  completeSuccess(
    requestId: string,
    partial: {
      response_text: string;
      duration_ms: number;
      payload?: Record<string, unknown>;
      conversation_id: string;
    },
  ): Promise<void>;
  completeError(
    requestId: string,
    error: PublicErrorBody,
    duration_ms: number,
  ): Promise<void>;
}
