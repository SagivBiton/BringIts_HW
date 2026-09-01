import {
  QueryCommand,
  SubmitQueryResponse,
  JobPayload,
  ErrorCode,
  ConversationTurn,
  ERROR_HTTP_STATUS,
} from '@llm-query/types';
import { classifyTransportFailure } from '@llm-query/errors';
import { ProxyPool } from '@llm-query/proxy';
import {
  JobQueue,
  InMemoryJobQueue,
  QueryStore,
  ConversationStore,
  InMemoryConversationStore,
} from '@llm-query/queue';
import { geminiAdapter, RawCapture as GeminiRaw } from '@llm-query/adapters-gemini';
import { chatgptAdapter, RawCapture as ChatgptRaw } from '@llm-query/adapters-chatgpt';

export interface OrchestratorDeps {
  queryStore: QueryStore;
  proxyPool: ProxyPool;
  jobQueue?: JobQueue;
  conversationStore?: ConversationStore;
  stepRunner?: (
    job: JobPayload,
    cmd: QueryCommand,
  ) => Promise<{ artifacts: Record<string, unknown> }>;
}

type Adapter = {
  id: string;
  plan(
    input: QueryCommand,
    ctx: { locale?: string; continuing?: boolean; priorTurns?: ConversationTurn[] },
  ): import('@llm-query/types').ExecutionPlan;
  parse(
    raw: unknown,
    opts: { parse: boolean },
  ): {
    response_text: string;
    payload?: Record<string, unknown>;
    target_session?: Record<string, unknown>;
  };
  classify(raw: unknown): import('@llm-query/types').ErrorDecision;
  resolvePrompt(input: QueryCommand, priorTurns: ConversationTurn[]): string;
};

export class OrchestratorError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly http_status: number,
  ) {
    super(message);
  }
}

export class Orchestrator {
  private readonly adapters: Map<string, Adapter>;
  private readonly jobQueue: JobQueue;
  private readonly conversations: ConversationStore;

  constructor(private readonly deps: OrchestratorDeps) {
    this.jobQueue = deps.jobQueue ?? new InMemoryJobQueue();
    this.conversations = deps.conversationStore ?? new InMemoryConversationStore();
    this.adapters = new Map<string, Adapter>([
      ['gemini', geminiAdapter as unknown as Adapter],
      ['chatgpt', chatgptAdapter as unknown as Adapter],
    ]);
  }

  getAdapter(source: string): Adapter {
    const adapter = this.adapters.get(source);
    if (!adapter) {
      throw new OrchestratorError(
        ErrorCode.UNSUPPORTED_SOURCE,
        `Unsupported source: ${source}`,
        400,
      );
    }
    return adapter;
  }

  async submit(cmd: QueryCommand): Promise<SubmitQueryResponse> {
    const adapter = this.getAdapter(cmd.source);

    let conversation_id = cmd.conversation_id;
    let priorTurns: ConversationTurn[] = [];
    let target_session: Record<string, unknown> = {};

    if (conversation_id) {
      const existing = await this.conversations.get(conversation_id);
      if (!existing || existing.source !== cmd.source) {
        throw new OrchestratorError(
          ErrorCode.CONVERSATION_NOT_FOUND,
          `Conversation not found: ${conversation_id}`,
          ERROR_HTTP_STATUS[ErrorCode.CONVERSATION_NOT_FOUND],
        );
      }
      priorTurns = existing.turns;
      target_session = existing.target_session;
    } else {
      const created = await this.conversations.create(cmd.source);
      conversation_id = created.conversation_id;
    }

    const cmdWithConv: QueryCommand = { ...cmd, conversation_id };
    const plan = adapter.plan(cmdWithConv, {
      locale: 'en-US',
      continuing: priorTurns.length > 0,
      priorTurns,
    });

    const lease = await this.deps.proxyPool.acquire({
      target: cmd.source,
      geo: cmd.geo_location,
      affinity: plan.affinity,
    });

    if (!lease) {
      const decision = classifyTransportFailure({
        kind: 'no_proxy',
        explicit_geo: Boolean(cmd.geo_location),
      });
      throw new OrchestratorError(decision.code, decision.message, decision.http_status);
    }

    const record = await this.deps.queryStore.create(cmdWithConv);
    const effective_prompt = adapter.resolvePrompt(cmdWithConv, priorTurns);

    for (const step of plan.steps) {
      const job: JobPayload = {
        request_id: record.request_id,
        step_id: step.id,
        source: cmd.source,
        worker: step.worker,
        lease_id: lease.id,
        timeout_ms: step.timeout_ms,
        artifacts: {
          conversation_id,
          effective_prompt,
          prior_turns: priorTurns,
          affinity: plan.affinity,
          ...target_session,
        },
      };
      await this.jobQueue.enqueue(job);
    }

    return { request_id: record.request_id, status: 'queued' };
  }

  /** Test helper: process one queued job synchronously. */
  async processNextJob(
    worker: import('@llm-query/types').WorkerKind = 'http',
  ): Promise<void> {
    const job = await this.jobQueue.dequeue(worker);
    if (!job) return;
    await this.processJob(job);
  }

  async processJob(
    job: JobPayload,
    precomputedArtifacts?: Record<string, unknown>,
  ): Promise<void> {
    const record = await this.deps.queryStore.get(job.request_id);
    if (!record) return;

    await this.deps.queryStore.setStatus(job.request_id, 'running');
    const cmd: QueryCommand = {
      source: record.source,
      prompt: record.prompt,
      parse: record.parse,
      geo_location: record.geo_location,
      conversation_id: record.conversation_id,
    };

    const adapter = this.getAdapter(job.source);
    const started = Date.now();
    const conversation_id =
      record.conversation_id ?? String(job.artifacts.conversation_id ?? '');

    try {
      const { artifacts } = this.deps.stepRunner
        ? await this.deps.stepRunner(job, cmd)
        : precomputedArtifacts !== undefined
          ? { artifacts: precomputedArtifacts }
          : { artifacts: {} };

      const transportFailure = this.classifyHttpTransport(job, artifacts);
      // Any HTTP ≥400 from the target is a definitive transport outcome (DESIGN §10.2).
      if (transportFailure) {
        await this.deps.proxyPool.release(job.lease_id, transportFailure.proxy_action);
        await this.deps.queryStore.completeError(
          job.request_id,
          {
            code: transportFailure.code,
            message: transportFailure.message,
            http_status: transportFailure.http_status,
            retryable: transportFailure.retryable,
            retry_after_ms: transportFailure.retry_after_ms,
          },
          Date.now() - started,
        );
        return;
      }

      const raw = this.toRawCapture(job.source, artifacts);
      const failure = adapter.classify(raw);
      if (this.isTerminalFailure(failure)) {
        await this.deps.proxyPool.release(job.lease_id, failure.proxy_action);
        await this.deps.queryStore.completeError(
          job.request_id,
          {
            code: failure.code,
            message: failure.message,
            http_status: failure.http_status,
            retryable: failure.retryable,
            retry_after_ms: failure.retry_after_ms,
          },
          Date.now() - started,
        );
        return;
      }

      const parsed = adapter.parse(raw, { parse: cmd.parse });
      if (!parsed.response_text) {
        const empty = classifyTransportFailure({
          kind: 'empty_response',
          affinity: 'none',
        });
        await this.deps.proxyPool.release(job.lease_id, empty.proxy_action);
        await this.deps.queryStore.completeError(
          job.request_id,
          {
            code: empty.code,
            message: empty.message,
            http_status: empty.http_status,
            retryable: empty.retryable,
            retry_after_ms: empty.retry_after_ms,
          },
          Date.now() - started,
        );
        return;
      }

      if (conversation_id) {
        await this.conversations.appendTurn(
          conversation_id,
          [
            { role: 'user', content: cmd.prompt },
            { role: 'assistant', content: parsed.response_text },
          ],
          parsed.target_session,
        );
      }

      await this.deps.proxyPool.release(job.lease_id, 'success_signal');
      await this.deps.queryStore.completeSuccess(job.request_id, {
        response_text: parsed.response_text,
        duration_ms: Date.now() - started,
        payload: parsed.payload,
        conversation_id: conversation_id || 'conv_unknown',
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal error';
      const affinityRaw = job.artifacts.affinity;
      const affinity =
        affinityRaw === 'session' || affinityRaw === 'request' ? affinityRaw : 'none';
      const timedOut = /timeout|timed out/i.test(message);
      if (timedOut) {
        const timeout = classifyTransportFailure({ kind: 'timeout', affinity });
        await this.deps.proxyPool.release(job.lease_id, timeout.proxy_action);
        await this.deps.queryStore.completeError(
          job.request_id,
          {
            code: timeout.code,
            message: timeout.message,
            http_status: timeout.http_status,
            retryable: timeout.retryable,
            retry_after_ms: timeout.retry_after_ms,
          },
          Date.now() - started,
        );
        return;
      }
      await this.deps.proxyPool.release(job.lease_id, 'neutral');
      await this.deps.queryStore.completeError(
        job.request_id,
        {
          code: ErrorCode.INTERNAL_ERROR,
          message,
          http_status: 500,
          retryable: false,
          retry_after_ms: null,
        },
        Date.now() - started,
      );
    }
  }

  private classifyHttpTransport(
    job: JobPayload,
    artifacts: Record<string, unknown>,
  ): import('@llm-query/types').ErrorDecision | null {
    const status = artifacts.httpStatus;
    if (typeof status !== 'number' || status < 400) return null;
    const affinityRaw = job.artifacts.affinity;
    const affinity =
      affinityRaw === 'session' || affinityRaw === 'request' ? affinityRaw : 'none';
    const retryAfter =
      typeof artifacts.retryAfterMs === 'number' ? artifacts.retryAfterMs : undefined;
    return classifyTransportFailure({
      kind: 'http_status',
      status,
      affinity,
      retry_after_ms: retryAfter,
    });
  }

  private isTerminalFailure(
    failure: import('@llm-query/types').ErrorDecision,
  ): boolean {
    return (
      failure.code === ErrorCode.TARGET_BLOCKED ||
      failure.code === ErrorCode.EMPTY_RESPONSE ||
      failure.code === ErrorCode.PARSING_FAILED ||
      failure.code === ErrorCode.TARGET_RATE_LIMITED ||
      failure.code === ErrorCode.TARGET_TIMEOUT ||
      failure.code === ErrorCode.TARGET_UNAVAILABLE
    );
  }

  private toRawCapture(
    source: string,
    artifacts: Record<string, unknown>,
  ): GeminiRaw | ChatgptRaw {
    if (source === 'gemini') {
      return { streamBody: String(artifacts.streamBody ?? '') };
    }
    return {
      htmlPartial: String(artifacts.htmlPartial ?? ''),
      pageUrl:
        typeof artifacts.pageUrl === 'string' ? artifacts.pageUrl : undefined,
    };
  }
}
