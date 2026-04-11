import { describe, it, expect, mock } from 'bun:test';
import { Retry } from '../../../packages/ai/dist/harness/kernel/aop/retry.js';
import { Timeout } from '../../../packages/ai/dist/harness/kernel/aop/timeout.js';
import { Log } from '../../../packages/ai/dist/harness/kernel/aop/log.js';
import { Guard } from '../../../packages/ai/dist/harness/kernel/aop/guard.js';

// 辅助：手动应用方法装饰器（TC39 装饰器在测试中直接调用）
function applyMethodDecorator<T extends (...args: any[]) => any>(
  decorator: (method: T, context: ClassMethodDecoratorContext) => T,
  method: T,
  name: string = 'testMethod',
): T {
  const ctx = {
    kind: 'method' as const,
    name,
    static: false,
    private: false,
    access: { has: () => true, get: () => method },
    addInitializer: () => {},
    metadata: {},
  } as unknown as ClassMethodDecoratorContext;
  return decorator(method, ctx);
}

describe('AOP: @Retry', () => {
  it('成功时不重试', async () => {
    let callCount = 0;
    const fn = mock(async () => { callCount++; return 'ok'; });
    const decorator = Retry(3, 10);
    const wrapped = applyMethodDecorator(decorator, fn);
    const result = await wrapped.call({});
    expect(result).toBe('ok');
    expect(callCount).toBe(1);
  });

  it('失败后重试指定次数', async () => {
    let callCount = 0;
    const fn = mock(async () => {
      callCount++;
      if (callCount <= 2) throw new Error(`fail${callCount}`);
      return 'ok';
    });
    const decorator = Retry(3, 10);
    const wrapped = applyMethodDecorator(decorator, fn);
    const result = await wrapped.call({});
    expect(result).toBe('ok');
    expect(callCount).toBe(3);
  });

  it('重试用完后抛出最后一个错误', async () => {
    let callCount = 0;
    const fn = mock(async () => { callCount++; throw new Error('always fail'); });
    const decorator = Retry(2, 10);
    const wrapped = applyMethodDecorator(decorator, fn);
    await expect(wrapped.call({})).rejects.toThrow('always fail');
    expect(callCount).toBe(3); // 1 + 2 retries
  });
});

describe('AOP: @Timeout', () => {
  it('快速完成时返回结果', async () => {
    const fn = mock(async () => 'fast');
    const decorator = Timeout(1000);
    const wrapped = applyMethodDecorator(decorator, fn, 'fastMethod');
    expect(await wrapped.call({})).toBe('fast');
  });

  it('超时时抛异常', async () => {
    const fn = mock(() => new Promise(r => setTimeout(r, 5000)));
    const decorator = Timeout(50);
    const wrapped = applyMethodDecorator(decorator, fn, 'slowMethod');
    await expect(wrapped.call({})).rejects.toThrow('Timeout');
  });

  it('同步方法直接返回', async () => {
    const fn = mock(() => 42);
    const decorator = Timeout(100);
    const wrapped = applyMethodDecorator(decorator, fn);
    expect(await wrapped.call({})).toBe(42);
  });
});

describe('AOP: @Log', () => {
  it('正常执行时返回结果', async () => {
    const fn = mock(async () => 'logged');
    const decorator = Log('test');
    const wrapped = applyMethodDecorator(decorator, fn);
    expect(await wrapped.call({})).toBe('logged');
  });

  it('异常时重新抛出', async () => {
    const fn = mock(async () => { throw new Error('boom'); });
    const decorator = Log('test');
    const wrapped = applyMethodDecorator(decorator, fn);
    await expect(wrapped.call({})).rejects.toThrow('boom');
  });
});

describe('AOP: @Guard', () => {
  it('所有守卫通过则执行方法', async () => {
    let g1Called = 0, g2Called = 0;
    const g1 = mock(async () => { g1Called++; });
    const g2 = mock(async () => { g2Called++; });
    const fn = mock(async () => 'guarded');
    const decorator = Guard(g1, g2);
    const wrapped = applyMethodDecorator(decorator, fn);
    expect(await wrapped.call({})).toBe('guarded');
    expect(g1Called).toBe(1);
    expect(g2Called).toBe(1);
  });

  it('守卫抛异常则中止执行', async () => {
    let fnCalled = false;
    const g1 = mock(async () => { throw new Error('denied'); });
    const fn = mock(async () => { fnCalled = true; return 'nope'; });
    const decorator = Guard(g1);
    const wrapped = applyMethodDecorator(decorator, fn);
    await expect(wrapped.call({})).rejects.toThrow('denied');
    expect(fnCalled).toBe(false);
  });
});
