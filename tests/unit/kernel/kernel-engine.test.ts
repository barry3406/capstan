import { describe, test, expect, mock, beforeEach } from 'bun:test';
import {
  KernelBrowserSession,
  KernelBrowserEngine,
} from '../../../packages/ai/dist/harness/kernel/adapter/kernel-engine.js';

// --- Mock factories ---

function createMockPage() {
  const mouseMove = mock(async (_x: number, _y: number) => {});
  const mouseDown = mock(async () => {});
  const mouseUp = mock(async () => {});

  return {
    mouse: { move: mouseMove, down: mouseDown, up: mouseUp },
    screenshot: mock(async () => Buffer.from('PNG', 'utf-8')),
    $: mock(async (sel: string) =>
      sel === '.missing'
        ? null
        : { screenshot: mock(async () => Buffer.from('EL_PNG', 'utf-8')) },
    ),
    evaluate: mock(async (fn: any) => 'eval_result'),
    click: mock(async () => {}),
    keyboard: {
      down: mock(async () => {}),
      up: mock(async () => {}),
      press: mock(async () => {}),
    },
    goto: mock(async () => {}),
    url: mock(() => 'https://example.com'),
    isClosed: mock(() => false),
    close: mock(async () => {}),
    waitForLoadState: mock(async () => {}),
    context: mock(() => ({ cookies: mock(async () => []) })),
    on: mock(() => {}),
  } as any;
}

function createMockKernelSession(page: any) {
  return {
    accountId: 'harness',
    engine: 'camoufox',
    platform: 'test',
    url: () => page.url(),
    goto: mock(async (_url: string) => {}),
    waitForNavigation: mock(async (_opts?: any) => {}),
    close: mock(async () => {}),
    screenshot: mock(async () => {}),
    evaluate: mock(async () => {}),
    humanDelay: mock(async () => {}),
    humanScroll: mock(async () => {}),
    fetch: mock(async () => ({})),
    intercept: mock(() => ({ [Symbol.dispose]() {} })),
    querySelector: mock(async () => null),
    getCookies: mock(async () => []),
    hasCookie: mock(async () => false),
  } as any;
}

function createMockMouseEngine() {
  return {
    moveTo: mock(async (_page: any, _target: any) => {}),
    setFatigue: mock(() => {}),
  } as any;
}

function createMockKeyboardEngine() {
  return {
    typeText: mock(async (_page: any, _text: string, _sel?: string) => {}),
  } as any;
}

function createMockScrollEngine() {
  return {
    scroll: mock(async (_page: any, _opts: any) => {}),
  } as any;
}

// --- Tests ---

describe('KernelBrowserSession', () => {
  let page: any;
  let kernelSession: any;
  let mouseEngine: any;
  let keyboardEngine: any;
  let scrollEngine: any;
  let session: KernelBrowserSession;

  beforeEach(() => {
    page = createMockPage();
    kernelSession = createMockKernelSession(page);
    mouseEngine = createMockMouseEngine();
    keyboardEngine = createMockKeyboardEngine();
    scrollEngine = createMockScrollEngine();
    session = new KernelBrowserSession(
      kernelSession,
      page,
      mouseEngine,
      keyboardEngine,
      scrollEngine,
      [],
    );
  });

  test('goto() delegates to kernel session', async () => {
    await session.goto('https://example.com');
    expect(kernelSession.goto).toHaveBeenCalledWith('https://example.com');
  });

  test('goto() runs harness guards before kernel session', async () => {
    const order: string[] = [];
    const guard = mock(async () => {
      order.push('guard');
    });
    kernelSession.goto = mock(async () => {
      order.push('kernel');
    });

    const guardedSession = new KernelBrowserSession(
      kernelSession,
      page,
      mouseEngine,
      keyboardEngine,
      scrollEngine,
      [guard],
    );

    await guardedSession.goto('https://test.com');
    expect(order).toEqual(['guard', 'kernel']);
  });

  test('screenshot() returns Buffer from page.screenshot()', async () => {
    const buf = await session.screenshot();
    expect(buf).toBeInstanceOf(Buffer);
    expect(page.screenshot).toHaveBeenCalledWith({ fullPage: true, type: 'png' });
  });

  test('screenshotElement() captures specific element', async () => {
    const buf = await session.screenshotElement('.product');
    expect(buf).toBeInstanceOf(Buffer);
    expect(page.$).toHaveBeenCalledWith('.product');
  });

  test('screenshotElement() throws for missing element', async () => {
    try {
      await session.screenshotElement('.missing');
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.message).toContain('.missing');
    }
  });

  test('evaluate() passes string to page.evaluate()', async () => {
    const result = await session.evaluate<string>('document.title');
    expect(page.evaluate).toHaveBeenCalledWith('document.title');
    expect(result).toBe('eval_result');
  });

  test('click() uses MouseEngine.moveTo then mouse down/up', async () => {
    await session.click(100, 200);
    expect(mouseEngine.moveTo).toHaveBeenCalledWith(page, { x: 100, y: 200 });
    expect(page.mouse.down).toHaveBeenCalledTimes(1);
    expect(page.mouse.up).toHaveBeenCalledTimes(1);
  });

  test('type() uses KeyboardEngine.typeText', async () => {
    await session.type('#search', 'hello world');
    expect(keyboardEngine.typeText).toHaveBeenCalledWith(page, 'hello world', '#search');
  });

  test('scroll("down") uses ScrollEngine with direction 1', async () => {
    await session.scroll('down', 500);
    expect(scrollEngine.scroll).toHaveBeenCalledWith(page, { direction: 1, distance: 500 });
  });

  test('scroll("up") uses ScrollEngine with direction -1', async () => {
    await session.scroll('up');
    expect(scrollEngine.scroll).toHaveBeenCalledWith(page, { direction: -1, distance: 300 });
  });

  test('waitForNavigation() delegates to kernel session', async () => {
    await session.waitForNavigation(5000);
    expect(kernelSession.waitForNavigation).toHaveBeenCalledWith({ timeout: 5000 });
  });

  test('url() delegates to kernel session', () => {
    expect(session.url()).toBe('https://example.com');
  });

  test('close() delegates to kernel session', async () => {
    await session.close();
    expect(kernelSession.close).toHaveBeenCalledTimes(1);
  });
});

describe('KernelBrowserEngine', () => {
  test('name is "camoufox"', () => {
    const engine = new KernelBrowserEngine('taobao');
    expect(engine.name).toBe('camoufox');
  });

  test('close() is safe when not launched', async () => {
    const engine = new KernelBrowserEngine();
    await engine.close(); // should not throw
  });
});
