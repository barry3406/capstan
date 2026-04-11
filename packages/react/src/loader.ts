import { createContext, useContext, use } from "react";
import type { LoaderFunction, CapstanPageContext } from "./types.js";

// Context for passing loader data and page context to components
export const PageContext = createContext<CapstanPageContext>({
  loaderData: null,
  params: {},
  auth: { isAuthenticated: false, type: "anonymous" },
});

export function defineLoader<T>(fn: LoaderFunction<T>): LoaderFunction<T> {
  return fn;
}

export function useLoaderData<T extends LoaderFunction>(): Awaited<ReturnType<T>> {
  const ctx = useContext(PageContext);
  return ctx.loaderData as Awaited<ReturnType<T>>;
}

/**
 * Read a promise's resolved value during render using React 19's `use()` hook.
 *
 * `use()` is a new React 19 primitive that can read the value of a Promise
 * (or Context) during render. Unlike `useEffect` or `useState`, `use()`:
 * - Suspends the component while the promise is pending (works with `<Suspense>`)
 * - Throws to the nearest error boundary if the promise rejects
 * - Can be called conditionally (unlike other hooks)
 *
 * Use this when loader data is provided as a promise (e.g., streaming SSR
 * where the data arrives after the shell) instead of pre-resolved data.
 *
 * @param promise  A promise containing the loader data
 * @returns The resolved value of the promise
 *
 * @example
 * ```tsx
 * function UserProfile({ dataPromise }: { dataPromise: Promise<User> }) {
 *   const user = useLoaderDataSuspense(dataPromise);
 *   return <h1>{user.name}</h1>;
 * }
 *
 * // Wrap in Suspense for the loading state:
 * <Suspense fallback={<Spinner />}>
 *   <UserProfile dataPromise={fetchUser(id)} />
 * </Suspense>
 * ```
 *
 * @see https://react.dev/reference/react/use
 */
export function useLoaderDataSuspense<T>(promise: Promise<T>): T {
  return use(promise);
}
