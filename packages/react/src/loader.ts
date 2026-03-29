import { createContext, useContext } from "react";
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
