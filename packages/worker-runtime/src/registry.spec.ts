import { buildStepRegistry, runRegisteredStep } from './registry';
import { geminiHttpStepMeta } from '@llm-query/adapters-gemini';
import { chatgptBrowserStepMeta } from '@llm-query/adapters-chatgpt';

describe('buildStepRegistry', () => {
  it('indexes steps by source:id', () => {
    const registry = buildStepRegistry([geminiHttpStepMeta, chatgptBrowserStepMeta]);
    expect(registry.has('gemini:generate')).toBe(true);
    expect(registry.has('chatgpt:generate')).toBe(true);
  });

  it('filters to http worker only', () => {
    const registry = buildStepRegistry([geminiHttpStepMeta, chatgptBrowserStepMeta], 'http');
    expect(registry.has('gemini:generate')).toBe(true);
    expect(registry.has('chatgpt:generate')).toBe(false);
  });

  it('filters to browser worker only', () => {
    const registry = buildStepRegistry([geminiHttpStepMeta, chatgptBrowserStepMeta], 'browser');
    expect(registry.has('gemini:generate')).toBe(false);
    expect(registry.has('chatgpt:generate')).toBe(true);
  });
});

describe('runRegisteredStep', () => {
  it('runs a registered step and returns artifacts', async () => {
    const registry = buildStepRegistry([
      {
        ...geminiHttpStepMeta,
        run: async () => ({ artifacts: { streamBody: '"ok"' } }),
      },
    ]);
    const result = await runRegisteredStep(registry, {
      request_id: 'q_1',
      step_id: 'generate',
      source: 'gemini',
      worker: 'http',
      lease_id: 'lease_1',
      timeout_ms: 120_000,
      artifacts: {},
    }, 'http://proxy:8080', 'hello');
    expect(result.artifacts.streamBody).toBe('"ok"');
  });

  it('throws when step is not registered', async () => {
    const registry = buildStepRegistry([]);
    await expect(
      runRegisteredStep(registry, {
        request_id: 'q_1',
        step_id: 'generate',
        source: 'gemini',
        worker: 'http',
        lease_id: 'lease_1',
        timeout_ms: 120_000,
        artifacts: {},
      }, 'http://proxy:8080', 'hello'),
    ).rejects.toThrow('Step not registered');
  });
});
