import { runChatgptGuestTurn, parsePlaywrightProxy } from '../src/playwright-guest';
import { chatgptBrowserStep } from '../src/steps/generate.browser';

function mockPage(
  assistantHtml: string | (() => string),
  onFill?: (text: string) => void,
) {
  const promptLocator = {
    waitFor: async () => {},
    click: async () => {},
    fill: async (text: string) => onFill?.(text),
    press: async () => {},
    first: () => promptLocator,
  };
  const makeAssistantLocator = () => {
    const locator = {
      waitFor: async () => {},
      innerHTML: async () =>
        typeof assistantHtml === 'function' ? assistantHtml() : assistantHtml,
      last: () => locator,
      first: () => locator,
      count: async () => 1,
    };
    return locator;
  };
  return {
    goto: async () => {},
    url: () => 'https://chatgpt.com/c/mock',
    locator: (selector: string) => {
      if (/prompt-textarea|textarea|contenteditable|Ask|mobile-composer/i.test(selector)) {
        return promptLocator;
      }
      return makeAssistantLocator();
    },
    waitForTimeout: async () => {},
    keyboard: {
      type: async (text: string) => onFill?.(text),
      press: async () => {},
    },
  };
}

function mockBrowser(page: ReturnType<typeof mockPage>) {
  return {
    newPage: async () => page,
    close: async () => {},
  };
}

describe('parsePlaywrightProxy', () => {
  it('returns undefined for empty or direct', () => {
    expect(parsePlaywrightProxy('')).toBeUndefined();
    expect(parsePlaywrightProxy('direct')).toBeUndefined();
  });

  it('parses authenticated proxy URLs', () => {
    expect(parsePlaywrightProxy('http://user:pass@proxy:8080')).toEqual({
      server: 'http://proxy:8080',
      username: 'user',
      password: 'pass',
    });
  });
});

describe('runChatgptGuestTurn', () => {
  it('fills the prompt, submits, and returns assistant HTML', async () => {
    const fills: string[] = [];
    const result = await runChatgptGuestTurn(
      { prompt: 'hello', proxyUrl: 'http://proxy:8080' },
      {
        launch: async () =>
          mockBrowser(
            mockPage('<div data-assistant-markdown><p>Hi there!</p></div>', (t) =>
              fills.push(t),
            ),
          ) as never,
      },
    );

    expect(fills).toEqual(['hello']);
    expect(result.htmlPartial).toContain('Hi there');
  });

  it('waits past Searching the web until a real answer appears', async () => {
    let n = 0;
    const result = await runChatgptGuestTurn(
      { prompt: 'how is the weather', proxyUrl: 'direct' },
      {
        launch: async () =>
          mockBrowser(
            mockPage(() => {
              n += 1;
              if (n < 4) {
                return '<div data-assistant-markdown><p>Searching the web</p></div>';
              }
              return '<div data-assistant-markdown><p>It is sunny and 72°F.</p></div>';
            }),
          ) as never,
      },
    );
    expect(result.htmlPartial).toContain('sunny');
    expect(result.htmlPartial).not.toContain('Searching the web');
  });

  it('passes proxy settings to firefox launch', async () => {
    let launchOpts: Record<string, unknown> | undefined;
    await runChatgptGuestTurn(
      { prompt: 'hi', proxyUrl: 'http://user:pass@proxy:8080' },
      {
        launch: async (opts) => {
          launchOpts = opts as Record<string, unknown>;
          return mockBrowser(mockPage('ok')) as never;
        },
      },
    );
    expect(launchOpts?.proxy).toEqual({
      server: 'http://proxy:8080',
      username: 'user',
      password: 'pass',
    });
  });
});

describe('chatgptBrowserStep', () => {
  it('uses injected runBrowser when provided', async () => {
    const result = await chatgptBrowserStep({
      proxyUrl: '',
      prompt: 'hi',
      runBrowser: async () => ({
        htmlPartial: '<div data-assistant-markdown><p>Mock</p></div>',
      }),
    });
    expect(result.artifacts.htmlPartial).toContain('Mock');
  });
});
