type GuardFunction = (...args: any[]) => void | Promise<void>;

/**
 * TC39 方法装饰器 — 前置守卫管道
 */
export function Guard(...guardFns: GuardFunction[]) {
  return function (target: Function, _context: ClassMethodDecoratorContext) {
    return async function (this: any, ...args: any[]) {
      for (const guard of guardFns) {
        await guard(...args);
      }
      return target.apply(this, args);
    };
  };
}
