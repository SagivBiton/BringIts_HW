import { chatgptAdapter } from '../src/adapter';

describe('chatgptAdapter', () => {
  it('returns a single browser generate step', () => {
    const plan = chatgptAdapter.plan(
      { source: 'chatgpt', prompt: 'hello', parse: true },
      {},
    );
    expect(plan.affinity).toBe('none');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({
      id: 'generate',
      worker: 'browser',
      purpose: 'generate',
    });
  });

  it('parses data-assistant-markdown guest markup', () => {
    const parsed = chatgptAdapter.parse(
      {
        htmlPartial:
          '<h4 data-message-attribution="">ChatGPT said:</h4><div data-assistant-markdown=""><p>pong</p></div>',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe('pong');
  });

  it('ignores Searching the web status as empty', () => {
    const parsed = chatgptAdapter.parse(
      {
        htmlPartial: '<div data-assistant-markdown=""><p>Searching the web</p></div>',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe('');
  });

  it('strips leaked guest-shell CSS from assistant text', () => {
    const parsed = chatgptAdapter.parse(
      {
        htmlPartial:
          '<div data-assistant-markdown=""><p>I can give you the weather, but I need a location.</p>' +
          '<style>@layer theme{:where(.puik-root){--gray-0:#fff}}</style></div>',
      },
      { parse: true },
    );
    expect(parsed.response_text).toBe(
      'I can give you the weather, but I need a location.',
    );
    expect(parsed.response_text).not.toContain('@layer');
  });

  it('parses assistant text from HTML partial (author-role)', () => {
    const parsed = chatgptAdapter.parse(
      { htmlPartial: '<div data-message-author-role="assistant"><p>Hello! 👋</p></div>' },
      { parse: true },
    );
    expect(parsed.response_text).toContain('Hello');
  });

  it('parses legacy data-message assistant markup', () => {
    const parsed = chatgptAdapter.parse(
      { htmlPartial: '<div data-message="assistant">Hello! 👋</div>' },
      { parse: true },
    );
    expect(parsed.response_text).toContain('Hello');
  });

  it('uses session affinity when continuing', () => {
    const plan = chatgptAdapter.plan(
      {
        source: 'chatgpt',
        prompt: 'again',
        parse: true,
        conversation_id: 'conv_1',
      },
      { continuing: true },
    );
    expect(plan.affinity).toBe('session');
  });

  it('classifies verification gate as blocked', () => {
    const decision = chatgptAdapter.classify({
      htmlPartial: 'Chat verification could not be completed',
    });
    expect(decision.code).toBe('TARGET_BLOCKED');
  });
});
