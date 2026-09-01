/**
 * Multi-turn follow-up e2e: different prompts each turn, both sources.
 * Usage: npx tsx scripts/e2e-followups.ts
 */
const BASE = process.env.API_URL ?? 'http://127.0.0.1:3000';

type Turn = {
  prompt: string;
  /** Case-insensitive substring(s) expected in response_text */
  mustInclude: RegExp[];
  /** Fail if any of these match (case-insensitive) */
  mustNotInclude?: RegExp[];
};

type Thread = {
  name: string;
  source: 'gemini' | 'chatgpt';
  turns: Turn[];
};

const THREADS: Thread[] = [
  {
    name: 'gemini-pet',
    source: 'gemini',
    turns: [
      {
        prompt:
          'I have a pet named Whiskers who is a cat. Reply with exactly one short sentence confirming you understood.',
        mustInclude: [/whiskers|cat/i],
      },
      {
        prompt: 'What kind of animal is Whiskers? Reply with one word only.',
        mustInclude: [/cat/i],
      },
      {
        prompt: "What is my pet's name? Reply with one word only.",
        mustInclude: [/whiskers/i],
      },
    ],
  },
  {
    name: 'chatgpt-color',
    source: 'chatgpt',
    turns: [
      {
        prompt:
          'My favorite color is teal. Reply with exactly one short sentence confirming you understood.',
        mustInclude: [/teal|color|favor/i],
      },
      {
        prompt: 'What color did I say is my favorite? Reply with one word only.',
        mustInclude: [/teal/i],
      },
      {
        prompt: 'Spell that favorite color in ALL CAPS. Reply with one word only.',
        mustInclude: [/TEAL/],
      },
    ],
  },
  {
    name: 'gemini-capitals',
    source: 'gemini',
    turns: [
      {
        prompt: 'Name one European capital city. Reply with one word only.',
        mustInclude: [
          /paris|berlin|madrid|rome|lisbon|vienna|warsaw|prague|athens|amsterdam|brussels|stockholm|oslo|helsinki|copenhagen|dublin|budapest|bucharest|sofia|zagreb|london/i,
        ],
      },
      {
        prompt: 'Now name one capital in Asia. Reply with one word only.',
        mustInclude: [
          /tokyo|beijing|seoul|bangkok|hanoi|jakarta|manila|delhi|new delhi|beijing|singapore|kuala lumpur|islamabad|dhaka|kathmandu|ulaanbaatar|taipei|pyongyang|vientiane|phnom penh/i,
        ],
        mustNotInclude: [/paris|berlin|madrid|rome|london/i],
      },
      {
        prompt:
          'Of the two capitals you named, which one is farther east? Reply with one word only (the city name).',
        mustInclude: [/[A-Za-z]{3,}/],
      },
    ],
  },
  {
    name: 'chatgpt-math',
    source: 'chatgpt',
    turns: [
      {
        prompt: 'Remember the secret number 17. Reply with exactly: noted',
        mustInclude: [/noted/i],
      },
      {
        prompt: 'What secret number did I ask you to remember? Reply with only the number.',
        mustInclude: [/17/],
      },
      {
        prompt: 'What is that secret number plus 25? Reply with only the number.',
        mustInclude: [/42/],
      },
    ],
  },
];

function looksBad(text: string): string | null {
  const t = text.trim();
  if (!t) return 'empty';
  if (t.length > 8000) return `too long (${t.length})`;
  if (/^Searching the web\.?$/i.test(t)) return 'intermediate search status';
  if (/@layer\b|:where\(|--gray-/i.test(t)) return 'CSS leak';
  if (/googleusercontent\.com\/card_content/i.test(t)) return 'card_content URL';
  if (t.startsWith('{') || t.startsWith('[')) return 'JSON dump';
  return null;
}

async function post(source: string, prompt: string, conversation_id?: string) {
  const body: Record<string, unknown> = { source, prompt };
  if (conversation_id) body.conversation_id = conversation_id;
  const res = await fetch(`${BASE}/v1/queries`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${res.status}: ${JSON.stringify(json)}`);
  return json as { request_id: string };
}

async function waitDone(id: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE}/v1/queries/${id}`);
    const body = (await res.json()) as Record<string, unknown>;
    const st = body.status as string;
    if (st === 'ok' || st === 'error' || st === 'expired') return body;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`timeout waiting for ${id}`);
}

async function runThread(thread: Thread) {
  let conversation_id: string | undefined;
  const turnResults: Array<Record<string, unknown>> = [];

  for (let i = 0; i < thread.turns.length; i++) {
    const turn = thread.turns[i];
    process.stderr.write(`→ ${thread.name} turn ${i + 1}: ${turn.prompt.slice(0, 60)}…\n`);
    const { request_id } = await post(thread.source, turn.prompt, conversation_id);
    const timeout = thread.source === 'chatgpt' ? 240_000 : 120_000;
    const body = await waitDone(request_id, timeout);
    const text = String(body.response_text ?? '');
    const issues: string[] = [];

    if (body.status !== 'ok') {
      issues.push(`status=${body.status} error=${JSON.stringify(body.error)}`);
    } else {
      const bad = looksBad(text);
      if (bad) issues.push(bad);
      for (const re of turn.mustInclude) {
        if (!re.test(text)) issues.push(`missing ${re}; got: ${text.slice(0, 200)}`);
      }
      for (const re of turn.mustNotInclude ?? []) {
        if (re.test(text)) issues.push(`unexpected ${re}; got: ${text.slice(0, 200)}`);
      }
      if (!conversation_id) {
        conversation_id = String(body.conversation_id ?? '');
        if (!conversation_id.startsWith('conv_')) {
          issues.push(`bad conversation_id: ${conversation_id}`);
        }
      } else if (body.conversation_id !== conversation_id) {
        issues.push(
          `conversation_id changed: ${conversation_id} → ${body.conversation_id}`,
        );
      }
    }

    const ok = issues.length === 0;
    process.stderr.write(
      `  ${ok ? 'OK' : 'FAIL'} [${conversation_id}] ${text.slice(0, 100)}\n`,
    );
    turnResults.push({
      turn: i + 1,
      ok,
      issues,
      prompt: turn.prompt,
      response_text: text,
      conversation_id,
      request_id,
    });
    if (!ok) break;
  }

  return {
    name: thread.name,
    source: thread.source,
    conversation_id,
    ok: turnResults.every((t) => t.ok),
    turns: turnResults,
  };
}

async function main() {
  const results = [];
  for (const thread of THREADS) {
    try {
      results.push(await runThread(thread));
    } catch (e) {
      results.push({
        name: thread.name,
        source: thread.source,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({ passed, failed: results.length - passed, results }, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main();
