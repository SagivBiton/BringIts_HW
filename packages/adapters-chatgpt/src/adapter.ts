import {
  QueryCommand,
  ExecutionPlan,
  GLOBAL_DEADLINE_MS,
  ErrorCode,
  ConversationTurn,
  buildPromptWithHistory,
} from '@llm-query/types';
import type { ErrorDecision } from '@llm-query/types';
import { isIntermediateAssistantText } from './intermediate-text';

export interface PlanContext {
  locale?: string;
  priorTurns?: ConversationTurn[];
  continuing?: boolean;
}

export interface RawCapture {
  htmlPartial: string;
  pageUrl?: string;
}

export interface ParsedCapture {
  response_text: string;
  payload?: Record<string, unknown>;
  target_session?: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  plan(input: QueryCommand, ctx: PlanContext): ExecutionPlan;
  parse(raw: RawCapture, opts: { parse: boolean }): ParsedCapture;
  classify(raw: RawCapture): ErrorDecision;
  resolvePrompt(input: QueryCommand, priorTurns: ConversationTurn[]): string;
}

function extractResponseText(htmlPartial: string): string {
  const markdown = htmlPartial.match(
    /data-assistant-markdown[^>]*>([\s\S]*?)(?=<\/div>\s*<div data-message-intervention|<\/div>\s*<\/div>\s*<div aria-label="Response actions"|$)/i,
  );
  if (markdown?.[1]) {
    const text = cleanAssistantProse(stripHtml(markdown[1]));
    if (text && !isIntermediateAssistantText(text)) return text;
  }
  const simpleMd = htmlPartial.match(/data-assistant-markdown[^>]*>\s*<p>([\s\S]*?)<\/p>/i);
  if (simpleMd?.[1]) {
    const text = cleanAssistantProse(stripHtml(simpleMd[1]));
    if (text && !isIntermediateAssistantText(text)) return text;
  }
  const roleBlock = htmlPartial.match(
    /data-message-author-role="assistant"[^>]*>([\s\S]*?)(?=<div[^>]*data-message-author-role=|$)/i,
  );
  if (roleBlock?.[1]) {
    const text = cleanAssistantProse(stripHtml(roleBlock[1]));
    if (text && !isIntermediateAssistantText(text)) return text;
  }
  const legacy = htmlPartial.match(/data-message="assistant"[^>]*>([^<]+)/);
  if (legacy?.[1]) {
    const text = cleanAssistantProse(legacy[1]);
    if (text && !isIntermediateAssistantText(text)) return text;
  }
  const fallback = cleanAssistantProse(stripHtml(htmlPartial));
  return isIntermediateAssistantText(fallback) ? '' : fallback;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cut CSS / theme tokens that sometimes leak from the ChatGPT guest shell. */
export function cleanAssistantProse(text: string): string {
  const cut = text.search(/@layer\b|@media\b|:where\(|--[a-z]+-\d+\s*:/i);
  if (cut > 0) return text.slice(0, cut).replace(/\s+/g, ' ').trim();
  return text.replace(/\s+/g, ' ').trim();
}


export const chatgptAdapter: SourceAdapter = {
  id: 'chatgpt',

  plan(input: QueryCommand, ctx: PlanContext): ExecutionPlan {
    const continuing = Boolean(input.conversation_id || ctx.continuing);
    return {
      affinity: continuing ? 'session' : 'none',
      session_key: continuing ? input.conversation_id : undefined,
      steps: [
        {
          id: 'generate',
          worker: 'browser',
          purpose: 'generate',
          timeout_ms: GLOBAL_DEADLINE_MS,
          uses_session: continuing,
        },
      ],
    };
  },

  resolvePrompt(input: QueryCommand, priorTurns: ConversationTurn[]): string {
    return buildPromptWithHistory(input.prompt, priorTurns);
  },

  parse(raw: RawCapture, opts: { parse: boolean }): ParsedCapture {
    const response_text = extractResponseText(raw.htmlPartial);
    const target_session: Record<string, unknown> = {};
    if (raw.pageUrl) {
      target_session.chatgpt_url = raw.pageUrl;
    }
    const result: ParsedCapture = { response_text, target_session };
    if (!opts.parse) {
      result.payload = { htmlPartial: raw.htmlPartial, pageUrl: raw.pageUrl };
    }
    return result;
  },

  classify(raw: RawCapture): ErrorDecision {
    const lower = raw.htmlPartial.toLowerCase();
    if (
      lower.includes('verification could not be completed') ||
      lower.includes('cdn-cgi/challenge')
    ) {
      return {
        code: ErrorCode.TARGET_BLOCKED,
        message: 'The target returned a block or challenge instead of an answer.',
        http_status: 403,
        retry: 'new_proxy',
        proxy_action: 'cooldown',
        retry_after_ms: null,
        fingerprint: 'chatgpt:block',
        retryable: true,
      };
    }
    if (!raw.htmlPartial.trim()) {
      return {
        code: ErrorCode.EMPTY_RESPONSE,
        message: 'The target finished without assistant text.',
        http_status: 502,
        retry: 'same_lease',
        proxy_action: 'neutral',
        retry_after_ms: null,
        fingerprint: 'chatgpt:empty',
        retryable: true,
      };
    }
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Unhandled chatgpt capture',
      http_status: 500,
      retry: 'never',
      proxy_action: 'neutral',
      retry_after_ms: null,
      fingerprint: 'chatgpt:unclassified',
      retryable: false,
    };
  },
};

export { chatgptBrowserStep, chatgptBrowserStepMeta } from './steps/generate.browser';
