/**
 * TC39 方法装饰器 — 超时中止
 */
export function Timeout(ms: number) {
  return function (target: Function, _context: ClassMethodDecoratorContext) {
    return async function (this: any, ...args: any[]) {
      return Promise.race([
        target.apply(this, args),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout: 方法执行超过 ${ms}ms`)), ms),
        ),
      ]);
    };
  };
}
