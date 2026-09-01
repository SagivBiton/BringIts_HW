export const MAX_PROMPT_LENGTH = 8192;
export const DEFAULT_PARSE = true;
export const QUERY_TTL_MS = 15 * 60 * 1000;
export const GLOBAL_DEADLINE_MS = 120_000;
export const MAX_INTERNAL_RETRIES = 2;

export const SUPPORTED_SOURCES = ['chatgpt', 'gemini'] as const;
export type SourceId = (typeof SUPPORTED_SOURCES)[number];

export type QueryStatus = 'queued' | 'running' | 'ok' | 'error' | 'expired';

export type WorkerKind = 'http' | 'browser';

export type ProxyAffinity = 'none' | 'request' | 'session';

export type RetryPolicy = 'never' | 'same_lease' | 'new_proxy' | 'restart_plan';

export type ProxyAction =
  | 'none'
  | 'neutral'
  | 'cooldown'
  | 'burn'
  | 'success_signal';

export { createRequestId, createConversationId } from './ids';
export { validateQueryCommand } from './validation';
export type { ValidationResult } from './validation';
export { ErrorCode, ERROR_HTTP_STATUS } from './errors';
export type { PublicError, ValidationError } from './errors';
export { buildPromptWithHistory } from './conversation';


export interface QueryCommand {
  source: SourceId;
  prompt: string;
  parse: boolean;
  geo_location?: string;
  conversation_id?: string;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationRecord {
  conversation_id: string;
  source: SourceId;
  turns: ConversationTurn[];
  /** Adapter-owned site session (ids, cookies refs, conversation URL, …). */
  target_session: Record<string, unknown>;
  proxy_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Step {
  id: string;
  worker: WorkerKind;
  purpose: 'generate' | 'mint' | 'other';
  timeout_ms: number;
  uses_session: boolean;
}

export interface ExecutionPlan {
  affinity: ProxyAffinity;
  session_key?: string;
  steps: Step[];
}

export interface ErrorDecision {
  code: import('./errors').ErrorCode;
  message: string;
  http_status: number;
  retry: RetryPolicy;
  proxy_action: ProxyAction;
  retry_after_ms: number | null;
  fingerprint: string;
  retryable: boolean;
}

export interface ProxyLease {
  id: string;
  proxy_id: string;
  request_id: string;
  affinity: ProxyAffinity;
  expires_at: Date;
}

export interface QueryRecord {
  request_id: string;
  status: QueryStatus;
  source: SourceId;
  prompt: string;
  parse: boolean;
  geo_location?: string;
  conversation_id?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  result?: QuerySuccessBody;
  error?: PublicErrorBody;
}

export interface QuerySuccessBody {
  request_id: string;
  status: 'ok';
  duration_ms: number;
  source: SourceId;
  prompt: string;
  parse: boolean;
  geo_location?: string;
  conversation_id: string;
  response_text: string;
  markdown?: string;
  citations?: Array<{ title: string; url: string }>;
  citation_urls?: string[];
  model?: { id: string; name?: string };
  payload?: Record<string, unknown>;
}

export interface PublicErrorBody {
  code: import('./errors').ErrorCode;
  message: string;
  http_status: number;
  retryable: boolean;
  retry_after_ms: number | null;
}

export interface SubmitQueryResponse {
  request_id: string;
  status: 'queued';
}

export interface JobPayload {
  request_id: string;
  step_id: string;
  source: SourceId;
  worker: WorkerKind;
  lease_id: string;
  timeout_ms: number;
  artifacts: Record<string, unknown>;
}
