/**
 * TC39 方法装饰器 — 记录入参/返回/异常/耗时
 */
export function Log(category?: string) {
  return function (target: Function, context: ClassMethodDecoratorContext) {
    const methodName = String(context.name);
    const log = {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: (..._: any[]) => {},
    };

    return async function (this: any, ...args: any[]) {
      const start = performance.now();
      log.debug({ args }, `${methodName} 开始`);

      try {
        const result = await target.apply(this, args);
        const duration = Math.round(performance.now() - start);
        log.info({ duration }, `${methodName} 完成`);
        return result;
      } catch (err) {
        const duration = Math.round(performance.now() - start);
        log.error({ err, duration }, `${methodName} 异常`);
        throw err;
      }
    };
  };
}
