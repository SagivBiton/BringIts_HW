import {
  QueryCommand,
  ExecutionPlan,
  GLOBAL_DEADLINE_MS,
  ErrorCode,
  ConversationTurn,
  buildPromptWithHistory,
} from '@llm-query/types';
import type { ErrorDecision } from '@llm-query/types';

export interface PlanContext {
  locale?: string;
  priorTurns?: ConversationTurn[];
  continuing?: boolean;
}

export interface RawCapture {
  streamBody: string;
  modelId?: string;
}

export interface ParsedCapture {
  response_text: string;
  payload?: Record<string, unknown>;
  model?: { id: string };
  target_session?: Record<string, unknown>;
}

export interface SourceAdapter {
  id: string;
  plan(input: QueryCommand, ctx: PlanContext): ExecutionPlan;
  parse(raw: RawCapture, opts: { parse: boolean }): ParsedCapture;
  classify(raw: RawCapture): ErrorDecision;
  /** Effective prompt sent to the target (includes history when continuing). */
  resolvePrompt(input: QueryCommand, priorTurns: ConversationTurn[]): string;
}

/** Decode a JSON string body (content between quotes) without corrupting nested \\n escapes. */
function decodeJsonStringInner(inner: string): string {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return inner
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function extractQuotedStrings(body: string): string[] {
  const matches = body.match(/"((?:\\.|[^"\\])*)"/g) ?? [];
  return matches
    .map((m) => decodeJsonStringInner(m.slice(1, -1)))
    .filter((s) => s.length > 0);
}

/** StreamGenerate nests the real payload in a quoted JSON blob; flatten a few layers. */
function flattenQuotedStrings(body: string, depth = 0): string[] {
  const top = extractQuotedStrings(body);
  if (depth >= 3) return top;
  const nested: string[] = [];
  for (const s of top) {
    const t = s.trim();
    if (t.startsWith('[') || t.startsWith('{')) {
      nested.push(...flattenQuotedStrings(s, depth + 1));
    }
  }
  return top.concat(nested);
}

/** Parse a JSON array prefix starting at `src[0] === '['`. */
function parseJsonArrayPrefix(src: string): unknown[] | null {
  if (!src.startsWith('[')) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(src.slice(0, i + 1)) as unknown;
          return Array.isArray(v) ? v : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Assistant text sits in `["rc_…", ["answer", …], …]` inside the nested payload.
 * Prefer that over heuristic string picking (geo, UI chrome, model names).
 */
function extractRcAnswers(body: string): string[] {
  const answers: string[] = [];
  const re = /"rc_[^"]+"\s*,\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const arr = parseJsonArrayPrefix(body.slice(m.index + m[0].length));
    if (!arr) continue;
    const parts = arr.filter((x): x is string => typeof x === 'string' && x.length > 0);
    if (parts.length > 0) answers.push(parts.join(''));
  }
  return answers;
}

function collectRcAnswers(streamBody: string): string[] {
  const blobs = [
    streamBody,
    ...extractQuotedStrings(streamBody).filter((s) => {
      const t = s.trim();
      return t.startsWith('[') || t.startsWith('{');
    }),
  ];
  return blobs.flatMap(extractRcAnswers);
}

const UI_CHROME = new Set([
  'Longer',
  'Shorter',
  'Try again',
  'expand',
  'compress',
  'refresh',
]);

/** Skip Gemini protocol / framing tokens; keep assistant prose. */
export function isProtocolToken(s: string): boolean {
  if (s.length <= 1) return true;
  if (s.startsWith('c_') || s.startsWith('r_') || s.startsWith('rc_')) return true;
  if (s.startsWith('wrb.') || s.startsWith('di.')) return true;
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//')) return true;
  if (s.startsWith('SWML_')) return true;
  if (UI_CHROME.has(s)) return true;
  // Whole JSON fragments embedded as quoted strings
  const t = s.trim();
  if (t.startsWith('[') || t.startsWith('{')) return true;
  // Dotted identifiers like wrb.fr (no spaces)
  if (/^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)+$/i.test(s)) return true;
  // Numeric / opaque ids that appear as quoted strings in StreamGenerate
  if (/^\d+$/.test(s)) return true;
  if (/^[0-9a-f]{16,}$/i.test(s)) return true;
  // Locale tags (en, en-US) — not assistant text
  if (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(s)) return true;
  return false;
}

export function pickResponseText(strings: string[]): string {
  const candidates = strings.filter((s) => !isProtocolToken(s));
  if (candidates.length === 0) return '';
  return candidates.sort((a, b) => {
    const score = (s: string) =>
      s.length +
      (/\s/.test(s) ? 100 : 0) +
      (/[A-Za-z]/.test(s) ? 50 : 0);
    return score(b) - score(a);
  })[0];
}

/** Drop weather-card / media placeholders that Gemini prepends to prose. */
export function cleanGeminiAnswer(text: string): string {
  return text
    .replace(/^https?:\/\/googleusercontent\.com\/card_content\/\d+\s*/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const geminiAdapter: SourceAdapter = {
  id: 'gemini',

  plan(input: QueryCommand, ctx: PlanContext): ExecutionPlan {
    const continuing = Boolean(input.conversation_id || ctx.continuing);
    return {
      affinity: continuing ? 'session' : 'none',
      session_key: continuing ? input.conversation_id : undefined,
      steps: [
        {
          id: 'generate',
          worker: 'http',
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
    const rcAnswers = collectRcAnswers(raw.streamBody);
    const strings = flattenQuotedStrings(raw.streamBody);
    const response_text = cleanGeminiAnswer(
      rcAnswers.sort((a, b) => b.length - a.length)[0] ?? pickResponseText(strings),
    );
    const gemini_c = strings.find((s) => s.startsWith('c_'));
    const gemini_r = strings.find((s) => s.startsWith('r_'));
    const target_session: Record<string, unknown> = {};
    if (gemini_c) target_session.gemini_c = gemini_c;
    if (gemini_r) target_session.gemini_r = gemini_r;

    const result: ParsedCapture = { response_text, target_session };
    if (raw.modelId) {
      result.model = { id: raw.modelId };
    }
    if (!opts.parse) {
      result.payload = { streamBody: raw.streamBody, modelId: raw.modelId };
    }
    return result;
  },

  classify(raw: RawCapture): ErrorDecision {
    const lower = raw.streamBody.toLowerCase();
    if (!raw.streamBody.trim()) {
      return emptyResponse();
    }
    if (lower.includes('verify you are human') || lower.includes('captcha')) {
      return blocked();
    }
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Unhandled gemini capture',
      http_status: 500,
      retry: 'never',
      proxy_action: 'neutral',
      retry_after_ms: null,
      fingerprint: 'gemini:unclassified',
      retryable: false,
    };
  },
};

function blocked(): ErrorDecision {
  return {
    code: ErrorCode.TARGET_BLOCKED,
    message: 'The target returned a block or challenge instead of an answer.',
    http_status: 403,
    retry: 'new_proxy',
    proxy_action: 'cooldown',
    retry_after_ms: null,
    fingerprint: 'gemini:block',
    retryable: true,
  };
}

function emptyResponse(): ErrorDecision {
  return {
    code: ErrorCode.EMPTY_RESPONSE,
    message: 'The target finished without assistant text.',
    http_status: 502,
    retry: 'same_lease',
    proxy_action: 'neutral',
    retry_after_ms: null,
    fingerprint: 'gemini:empty',
    retryable: true,
  };
}

export { geminiHttpStep } from './steps/generate.http';
