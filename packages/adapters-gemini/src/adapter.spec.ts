import { geminiAdapter } from '../src/adapter';

describe('geminiAdapter', () => {
  it('returns a single http generate step', () => {
    const plan = geminiAdapter.plan(
      { source: 'gemini', prompt: 'hello', parse: true },
      {},
    );
    expect(plan.affinity).toBe('none');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: 'generate',
      worker: 'http',
      purpose: 'generate',
    });
  });

  it('parses stream body into response_text', () => {
    const raw = {
      streamBody: 'prefix "Hello there" suffix',
    };
    const parsed = geminiAdapter.parse(raw, { parse: true });
    expect(parsed.response_text).toBe('Hello there');
  });

  it('includes payload when parse is false', () => {
    const raw = { streamBody: '"Hi"', modelId: 'm1' };
    const parsed = geminiAdapter.parse(raw, { parse: false });
    expect(parsed.response_text).toBe('Hi');
    expect(parsed.payload).toEqual({ modelId: 'm1', streamBody: '"Hi"' });
  });

  it('classifies empty stream as empty response', () => {
    const decision = geminiAdapter.classify({ streamBody: '' });
    expect(decision.code).toBe('EMPTY_RESPONSE');
  });

  it('still parses short answers like Hi', () => {
    const parsed = geminiAdapter.parse({ streamBody: '"Hi"' }, { parse: true });
    expect(parsed.response_text).toBe('Hi');
  });

  it('skips JSON fragment quotes and keeps nested answer', () => {
    const parsed = geminiAdapter.parse(
      {
        streamBody:
          '"[null,[\\"c_x\\"]]" "rc_abc" "pong" "en"',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe('pong');
  });

  it('skips long numeric protocol ids so short answers like pong win', () => {
    const parsed = geminiAdapter.parse(
      {
        streamBody:
          ')]}\'\n[["wrb.fr","5826289324850082504","c_abc","pong","en"]]',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe('pong');
  });

  it('reads nested StreamGenerate rc_ answer (not geo/UI chrome or lone e)', () => {
    const nested = JSON.stringify([
      null,
      ['c_d3196a0c0eeafd4a', 'r_9a4eb243390985c2'],
      null,
      null,
      [['rc_b0c9820db5863cd7', ['apple'], null, null, null, null, null, null, [1], 'en']],
      ['Ashkelon, Israel', 'SWML_DESCRIPTION_FROM_YOUR_INTERNET_ADDRESS'],
      null,
      null,
      'IL',
      null,
      null,
      null,
      null,
      null,
      false,
      null,
      null,
      null,
      null,
      'en',
      null,
      null,
      null,
      true,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      '3.5 Flash-Lite',
    ]);
    const streamBody = `)]}'\n[["wrb.fr",null,${JSON.stringify(nested)}]]\n[["wrb.fr","di","af.httprm","8588839736223167434","e"]]`;
    const parsed = geminiAdapter.parse({ streamBody }, { parse: true });
    expect(parsed.response_text).toBe('apple');
    expect(parsed.target_session?.gemini_c).toBe('c_d3196a0c0eeafd4a');
    expect(parsed.target_session?.gemini_r).toBe('r_9a4eb243390985c2');
  });

  it('joins multi-part rc_ answer strings', () => {
    const nested = JSON.stringify([
      null,
      ['c_x', 'r_y'],
      null,
      null,
      [['rc_abc', ['Hello ', 'world'], null, null, null, null, null, null, [1], 'en']],
    ]);
    const streamBody = `[["wrb.fr",null,${JSON.stringify(nested)}]]`;
    const parsed = geminiAdapter.parse({ streamBody }, { parse: true });
    expect(parsed.response_text).toBe('Hello world');
  });

  it('keeps nested \\\\n so full multiline rc_ answers parse (not a truncated early chunk)', () => {
    // Live StreamGenerate double-encodes newlines as \\\\n inside the outer quoted blob.
    const answer =
      '**Parsing** means analyzing symbols.\n\nIt breaks text into components.';
    const nested = JSON.stringify([
      null,
      ['c_aa', 'r_bb'],
      null,
      null,
      [['rc_cc', [answer], null, null, null, null, null, null, [1], 'en']],
    ]);
    // Simulate streaming: short early chunk + full final blob
    const earlyNested = JSON.stringify([
      null,
      ['c_aa', 'r_bb'],
      null,
      null,
      [['rc_cc', ['**Parsing'], null, null, null, null, null, null, [1], 'en']],
    ]);
    const streamBody =
      `[["wrb.fr",null,${JSON.stringify(earlyNested)}]]\n` +
      `[["wrb.fr",null,${JSON.stringify(nested)}]]`;
    const parsed = geminiAdapter.parse({ streamBody }, { parse: true });
    expect(parsed.response_text).toBe(answer);
    expect(parsed.response_text).toContain('breaks text');
  });

  it('skips protocol tokens like wrb.fr and prefers prose', () => {
    const parsed = geminiAdapter.parse(
      {
        streamBody:
          ')]}\'\n[["wrb.fr","c_abc","r_xyz","Hello from Gemini, how can I help?"]]',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe('Hello from Gemini, how can I help?');
    expect(parsed.target_session?.gemini_c).toBe('c_abc');
    expect(parsed.target_session?.gemini_r).toBe('r_xyz');
  });

  it('unescapes quoted newlines in stream body', () => {
    const parsed = geminiAdapter.parse(
      { streamBody: '"Line one\\nLine two"' },
      { parse: true },
    );
    expect(parsed.response_text).toBe('Line one\nLine two');
  });

  it('strips googleusercontent card_content prefixes', () => {
    const nested = JSON.stringify([
      null,
      ['c_aa', 'r_bb'],
      null,
      null,
      [
        [
          'rc_cc',
          [
            'http://googleusercontent.com/card_content/0\nIn Rishon LeZion, it is 31°C.',
          ],
          null,
          null,
          null,
          null,
          null,
          null,
          [1],
          'en',
        ],
      ],
    ]);
    const streamBody = `[["wrb.fr",null,${JSON.stringify(nested)}]]`;
    const parsed = geminiAdapter.parse({ streamBody }, { parse: true });
    expect(parsed.response_text).toBe('In Rishon LeZion, it is 31°C.');
  });

  it('uses session affinity when continuing a conversation', () => {
    const plan = geminiAdapter.plan(
      { source: 'gemini', prompt: 'again', parse: true, conversation_id: 'conv_1' },
      { continuing: true },
    );
    expect(plan.affinity).toBe('session');
    expect(plan.session_key).toBe('conv_1');
    expect(plan.steps[0].uses_session).toBe(true);
  });

  it('resolvePrompt includes history for follow-ups', () => {
    const prompt = geminiAdapter.resolvePrompt(
      { source: 'gemini', prompt: 'next', parse: true },
      [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'reply' },
      ],
    );
    expect(prompt).toContain('User: first');
    expect(prompt).toContain('User: next');
  });
});
