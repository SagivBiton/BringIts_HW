/**
 * Full-stack prompt smoke: POST → poll → assert response_text quality.
 * Usage: npx tsx scripts/e2e-full-prompts.ts
 */
import { writeFileSync } from 'fs';

const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';

type Case = {
  name: string;
  source: 'gemini' | 'chatgpt';
  prompt: string;
  /** Optional: response must include this (case-insensitive) */
  mustInclude?: string | RegExp;
  /** Fail if response looks like raw wire/JSON dump */
  rejectRawDump?: boolean;
};

const CASES: Case[] = [
  {
    name: 'gemini-pong',
    source: 'gemini',
    prompt: 'Reply with exactly one word: pong',
    mustInclude: /pong/i,
    rejectRawDump: true,
  },
  {
    name: 'gemini-capital',
    source: 'gemini',
    prompt: 'What is the capital of France? Reply with one word only.',
    mustInclude: /paris/i,
    rejectRawDump: true,
  },
  {
    name: 'gemini-math',
    source: 'gemini',
    prompt: 'What is 17 + 25? Reply with only the number.',
    mustInclude: /42/,
    rejectRawDump: true,
  },
  {
    name: 'chatgpt-pong',
    source: 'chatgpt',
    prompt: 'Reply with exactly one word: pong',
    mustInclude: /pong/i,
    rejectRawDump: true,
  },
  {
    name: 'chatgpt-capital',
    source: 'chatgpt',
    prompt: 'What is the capital of France? Reply with one word only.',
    mustInclude: /paris/i,
    rejectRawDump: true,
  },
  {
    name: 'chatgpt-math',
    source: 'chatgpt',
    prompt: 'What is 17 + 25? Reply with only the number.',
    mustInclude: /42/,
    rejectRawDump: true,
  },
];

async function post(source: string, prompt: string) {
  const res = await fetch(`${BASE}/v1/queries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, prompt }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`POST ${res.status}: ${JSON.stringify(body)}`);
  return body as { request_id: string; status: string };
}

async function get(id: string) {
  const res = await fetch(`${BASE}/v1/queries/${id}`);
  const body = await res.json();
  if (!res.ok) throw new Error(`GET ${res.status}: ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
}

async function waitDone(id: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const body = await get(id);
    const st = body.status as string;
    if (st === 'ok' || st === 'error' || st === 'expired') return body;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${id}`);
}

function looksLikeRawDump(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return true;
  if (t.includes('"c_') && t.includes('"r_')) return true;
  if (t.includes('wrb.fr')) return true;
  if (t.length > 500 && /\[null,/.test(t)) return true;
  return false;
}

function evaluate(c: Case, body: Record<string, unknown>) {
  const issues: string[] = [];
  if (body.status !== 'ok') {
    issues.push(`status=${body.status} error=${JSON.stringify(body.error)}`);
    return { ok: false, issues, response_text: '' };
  }
  const text = String(body.response_text ?? '');
  if (!text.trim()) issues.push('empty response_text');
  if (c.rejectRawDump && looksLikeRawDump(text)) {
    issues.push(`looks like raw dump: ${text.slice(0, 120)}…`);
  }
  if (c.mustInclude) {
    const m =
      typeof c.mustInclude === 'string'
        ? text.toLowerCase().includes(c.mustInclude.toLowerCase())
        : c.mustInclude.test(text);
    if (!m) issues.push(`missing expected ${c.mustInclude}; got: ${text.slice(0, 200)}`);
  }
  return { ok: issues.length === 0, issues, response_text: text };
}

async function main() {
  const results: Array<{
    name: string;
    source: string;
    ok: boolean;
    issues: string[];
    response_text: string;
    request_id?: string;
    duration_ms?: number;
  }> = [];

  for (const c of CASES) {
    process.stderr.write(`→ ${c.name}…\n`);
    try {
      const { request_id } = await post(c.source, c.prompt);
      const timeout = c.source === 'chatgpt' ? 180_000 : 90_000;
      const body = await waitDone(request_id, timeout);
      const ev = evaluate(c, body);
      results.push({
        name: c.name,
        source: c.source,
        ok: ev.ok,
        issues: ev.issues,
        response_text: ev.response_text,
        request_id,
        duration_ms: body.duration_ms as number | undefined,
      });
      process.stderr.write(
        `  ${ev.ok ? 'OK' : 'FAIL'} ${ev.response_text.slice(0, 80)}\n`,
      );
    } catch (e) {
      results.push({
        name: c.name,
        source: c.source,
        ok: false,
        issues: [e instanceof Error ? e.message : String(e)],
        response_text: '',
      });
      process.stderr.write(`  ERR ${e}\n`);
    }
  }

  writeFileSync('/tmp/e2e-full-prompts.json', JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main();
