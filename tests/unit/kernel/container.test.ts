import { describe, it, expect, beforeEach } from 'bun:test';
import { Container, createToken } from '../../../packages/ai/dist/harness/kernel/di/container.js';

describe('Container', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  it('singleton 只创建一次实例', () => {
    let count = 0;
    const token = createToken<{ id: number }>('svc');
    container.register(token, () => ({ id: ++count }), 'singleton');

    const a = container.resolve(token);
    const b = container.resolve(token);
    expect(a).toBe(b);
    expect(count).toBe(1);
  });

  it('transient 每次创建新实例', () => {
    let count = 0;
    const token = createToken<{ id: number }>('svc');
    container.register(token, () => ({ id: ++count }), 'transient');

    const a = container.resolve(token);
    const b = container.resolve(token);
    expect(a).not.toBe(b);
    expect(count).toBe(2);
  });

  it('未注册的 token 抛异常', () => {
    const token = createToken('nope');
    expect(() => container.resolve(token)).toThrow('未注册的 token');
  });

  it('has() 检查注册状态', () => {
    const token = createToken<{}>('svc');
    expect(container.has(token)).toBe(false);
    container.register(token, () => ({}));
    expect(container.has(token)).toBe(true);
  });

  it('支持 symbol-based token', () => {
    const token = createToken<string>('myService');
    container.register(token, () => 'hello');
    expect(container.resolve(token)).toBe('hello');
  });

  it('singleton 懒创建 — 注册时不调用工厂', () => {
    let called = false;
    const token = createToken<{}>('lazy');
    container.register(token, () => { called = true; return {}; }, 'singleton');
    expect(called).toBe(false);
    container.resolve(token);
    expect(called).toBe(true);
  });
});
