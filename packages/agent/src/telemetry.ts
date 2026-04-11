/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Thin OpenTelemetry wrapper that gracefully degrades when
 * `@opentelemetry/api` is not installed — zero overhead, no hard dep.
 */

let _tracer: any = null;

async function getTracer(): Promise<any> {
  if (_tracer) return _tracer;
  try {
    const moduleName = "@opentelemetry/api";
    const { trace } = await import(/* webpackIgnore: true */ moduleName);
    _tracer = trace.getTracer("@zauso-ai/capstan-agent", "1.0.0");
    return _tracer;
  } catch {
    return null;
  }
}

/**
 * Execute an async function inside an OpenTelemetry span.
 *
 * When `@opentelemetry/api` is not installed the function is called directly
 * without any tracing overhead — graceful degradation by design.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span?: any) => Promise<T>,
): Promise<T> {
  const tracer = await getTracer();
  if (!tracer) return fn();
  return tracer.startActiveSpan(name, { attributes }, async (span: any) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
      return result;
    } catch (err) {
      span.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: err instanceof Error ? err.message : "unknown",
      });
      throw err;
    } finally {
      span.end();
    }
  });
}
