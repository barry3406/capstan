function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * TC39 方法装饰器 — 失败自动重试（指数退避）
 */
export function Retry(times = 3, delayMs = 1000) {
  return function (_target: Function, _context: ClassMethodDecoratorContext) {
    return async function (this: any, ...args: any[]) {
      for (let i = 0; i <= times; i++) {
        try {
          return await _target.apply(this, args);
        } catch (e) {
          if (i === times) throw e;
          await sleep(delayMs * 2 ** i);
        }
      }
    };
  };
}
