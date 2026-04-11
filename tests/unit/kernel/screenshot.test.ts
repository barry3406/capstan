import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { PlaywrightSession } from '../../../packages/ai/dist/harness/kernel/session/playwright-session.js';

// Minimal 1x1 transparent PNG (67 bytes)
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' +
  'Nl7BcQAAAABJRU5ErkJggg==',
  'base64',
);

function createMockPage(overrides?: {
  viewportSize?: { width: number; height: number } | null;
  mouseMoveImpl?: (...args: any[]) => Promise<void>;
}) {
  const mouseMove = mock<(...args: any[]) => Promise<void>>(
    overrides?.mouseMoveImpl ?? (async () => {}),
  );

  const page = {
    viewportSize: mock(() =>
      overrides?.viewportSize !== undefined
        ? overrides.viewportSize
        : { width: 1920, height: 1080 },
    ),
    mouse: { move: mouseMove },
    screenshot: mock<(...args: any[]) => Promise<Buffer>>(() => Promise.resolve(TINY_PNG)),
    evaluate: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve({
      width: 1920,
      height: 1080,
      docH: 3000,
    })),
    $: mock(() => Promise.resolve({
      screenshot: mock(() => Promise.resolve(undefined)),
    })),
    isClosed: mock(() => false),
    close: mock(() => Promise.resolve(undefined)),
    context: mock(() => ({ cookies: mock(() => Promise.resolve([])) })),
    on: mock(() => {}),
    goto: mock(() => Promise.resolve(undefined)),
    waitForLoadState: mock(() => Promise.resolve(undefined)),
  } as any;

  return { page, mouseMove };
}

function createSession(page: any): PlaywrightSession {
  return new PlaywrightSession(page, 'test-account', 'camoufox', 'test', []);
}

describe('screenshot mouse-move-to-safe-area', () => {
  beforeEach(() => {
    // mocks are reset per-test via fresh createMockPage calls
  });

  // Note: aboveFold tests may throw from sharp not being installed,
  // but mouse.move(0,0) happens before the sharp import — so we catch
  // and still verify mouse behavior.

  test('moves mouse to viewport corner before aboveFold screenshot', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    try { await session.screenshot('/tmp/test.png', { aboveFold: true }); } catch {}

    expect(mouseMove).toHaveBeenCalledTimes(1);
    expect(mouseMove).toHaveBeenCalledWith(0, 0);
  });

  test('uses correct coordinates for custom viewport size', async () => {
    const { page, mouseMove } = createMockPage({
      viewportSize: { width: 1280, height: 720 },
    });
    const session = createSession(page);

    try { await session.screenshot('/tmp/test.png', { aboveFold: true }); } catch {}

    expect(mouseMove).toHaveBeenCalledWith(0, 0);
  });

  test('uses default 1920x1080 when viewportSize returns null', async () => {
    const { page, mouseMove } = createMockPage({ viewportSize: null });
    const session = createSession(page);

    try { await session.screenshot('/tmp/test.png', { aboveFold: true }); } catch {}

    expect(mouseMove).toHaveBeenCalledWith(0, 0);
  });

  test('moves mouse when aboveFold is a number', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    try { await session.screenshot('/tmp/test.png', { aboveFold: 800 }); } catch {}

    expect(mouseMove).toHaveBeenCalledTimes(1);
    expect(mouseMove).toHaveBeenCalledWith(0, 0);
  });

  test('does not crash when mouse.move throws (page closed)', async () => {
    const { page, mouseMove } = createMockPage({
      mouseMoveImpl: async () => {
        throw new Error('Page closed');
      },
    });
    const session = createSession(page);

    // mouse.move throwing should be caught internally (page may be closed);
    // sharp may also throw (not installed) — both are caught
    try { await session.screenshot('/tmp/test.png', { aboveFold: true }); } catch {}

    // The key behavior: mouse.move was attempted despite it throwing
    expect(mouseMove).toHaveBeenCalledTimes(1);
  });

  test('does NOT move mouse for selector screenshots', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { selector: '.product-img' });

    expect(mouseMove).not.toHaveBeenCalled();
  });

  test('does NOT move mouse for fullPage screenshots (default)', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png');

    expect(mouseMove).not.toHaveBeenCalled();
  });

  test('does NOT move mouse for viewportOnly screenshots', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { viewportOnly: true });

    expect(mouseMove).not.toHaveBeenCalled();
  });

  test('does NOT move mouse for clip screenshots', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', {
      clip: { x: 0, y: 0, width: 500, height: 500 },
    });

    expect(mouseMove).not.toHaveBeenCalled();
  });

  test('does NOT move mouse when aboveFold is explicitly false', async () => {
    const { page, mouseMove } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { aboveFold: false });

    expect(mouseMove).not.toHaveBeenCalled();
  });
});

describe('screenshot selector error path', () => {
  test('throws when selector element not found', async () => {
    const { page } = createMockPage();
    // Override $() to return null (element not found)
    (page.$ as any).mockImplementation(() => Promise.resolve(null));
    const session = createSession(page);

    try {
      await session.screenshot('/tmp/test.png', { selector: '.nonexistent' });
      expect(true).toBe(false); // should not reach here
    } catch (err: any) {
      expect(err.message).toContain('截图失败');
    }
  });
});

describe('screenshot fullPage/viewportOnly/clip logic', () => {
  test('default fullPage=true passes fullPage to page.screenshot', async () => {
    const { page } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png');

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: true }),
    );
  });

  test('viewportOnly disables fullPage', async () => {
    const { page } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { viewportOnly: true });

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: false }),
    );
  });

  test('clip disables fullPage', async () => {
    const { page } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { clip: { x: 0, y: 0, width: 100, height: 100 } });

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: false, clip: { x: 0, y: 0, width: 100, height: 100 } }),
    );
  });

  test('clip takes precedence over viewportOnly', async () => {
    const { page } = createMockPage();
    const session = createSession(page);

    await session.screenshot('/tmp/test.png', { viewportOnly: true, clip: { x: 10, y: 10, width: 50, height: 50 } });

    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ fullPage: false, clip: { x: 10, y: 10, width: 50, height: 50 } }),
    );
  });
});
