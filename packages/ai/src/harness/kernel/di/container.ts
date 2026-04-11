/** Branded token — 保留泛型类型信息供 resolve 推断 */
export interface Token<T = unknown> {
  readonly __brand: 'DIToken';
  readonly __type?: T; // phantom type，仅用于类型推断，运行时不存在
  readonly description: string;
}

/** 创建类型安全的 DI token */
export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as unknown as Token<T>;
}

export type Lifetime = 'singleton' | 'transient';

interface Registration<T = any> {
  factory: () => T;
  lifetime: Lifetime;
  instance?: T;
}

export class Container {
  private registry = new Map<unknown, Registration>();

  register<T>(token: Token<T>, factory: () => T, lifetime: Lifetime = 'singleton'): this {
    this.registry.set(token, { factory, lifetime });
    return this;
  }

  resolve<T>(token: Token<T>): T {
    const reg = this.registry.get(token);
    if (!reg) {
      throw new Error(`DI: 未注册的 token: ${String(token)}`);
    }

    if (reg.lifetime === 'singleton') {
      if (reg.instance === undefined) {
        reg.instance = reg.factory();
      }
      return reg.instance as T;
    }

    return reg.factory() as T;
  }

  has(token: Token): boolean {
    return this.registry.has(token);
  }
}
