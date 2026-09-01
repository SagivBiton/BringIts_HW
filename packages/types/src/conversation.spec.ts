import { buildPromptWithHistory } from '../src/conversation';

describe('buildPromptWithHistory', () => {
  it('returns prompt unchanged when no prior turns', () => {
    expect(buildPromptWithHistory('hello', [])).toBe('hello');
  });

  it('prepends prior turns for follow-ups', () => {
    const out = buildPromptWithHistory('and Asia?', [
      { role: 'user', content: 'largest in Europe?' },
      { role: 'assistant', content: 'Russia, Germany, UK' },
    ]);
    expect(out).toContain('User: largest in Europe?');
    expect(out).toContain('Assistant: Russia, Germany, UK');
    expect(out).toContain('User: and Asia?');
  });
});
