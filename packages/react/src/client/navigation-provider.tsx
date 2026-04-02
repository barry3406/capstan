import { createElement, useEffect, useState, useCallback } from "react";
import type { ReactNode, ReactElement } from "react";
import { PageContext } from "../loader.js";
import type { NavigateEventDetail, RouterState } from "./types.js";
import { getRouter } from "./router.js";

/**
 * NavigationProvider — bridges the imperative router with React's
 * declarative rendering model.
 *
 * Listens for `capstan:navigate` CustomEvents dispatched by the router
 * and updates the `PageContext.Provider` value so that Outlet components
 * re-render with the new loader data / params.
 *
 * Also subscribes to router state changes so child components can
 * display loading indicators.
 */
export function NavigationProvider({
  children,
  initialLoaderData,
  initialParams,
  initialAuth,
}: {
  children: ReactNode;
  initialLoaderData?: unknown;
  initialParams?: Record<string, string>;
  initialAuth?: {
    isAuthenticated: boolean;
    type: "human" | "agent" | "anonymous" | "workload";
  };
}): ReactElement {
  const [contextValue, setContextValue] = useState<{
    loaderData: unknown;
    params: Record<string, string>;
    auth: { isAuthenticated: boolean; type: "human" | "agent" | "anonymous" | "workload" };
  }>({
    loaderData: initialLoaderData ?? null,
    params: initialParams ?? {},
    auth: initialAuth ?? { isAuthenticated: false, type: "anonymous" as const },
  });

  const [routerState, setRouterState] = useState<RouterState>({
    url: typeof window !== "undefined" ? window.location.pathname : "/",
    status: "idle",
  });

  // Listen for capstan:navigate events from the router
  useEffect(() => {
    function handleNavigate(e: Event): void {
      const detail = (e as CustomEvent<NavigateEventDetail>).detail;
      setContextValue((prev) => ({
        ...prev,
        loaderData: detail.loaderData,
        params: detail.params,
      }));
    }

    window.addEventListener("capstan:navigate", handleNavigate);
    return () => window.removeEventListener("capstan:navigate", handleNavigate);
  }, []);

  // Subscribe to router state changes
  useEffect(() => {
    const router = getRouter();
    if (!router) return;
    return router.subscribe(setRouterState);
  }, []);

  void routerState; // Will be used by loading indicators in future

  return createElement(
    PageContext.Provider,
    { value: contextValue },
    children,
  );
}

/**
 * Hook to get the current router state (url, status, error).
 * Re-renders when the state changes.
 */
export function useRouterState(): RouterState {
  const [state, setState] = useState<RouterState>(() => {
    const router = getRouter();
    return router?.state ?? { url: "/", status: "idle" };
  });

  useEffect(() => {
    const router = getRouter();
    if (!router) return;
    return router.subscribe(setState);
  }, []);

  return state;
}

/**
 * Hook for programmatic navigation.
 */
export function useNavigate(): (url: string, opts?: { replace?: boolean; scroll?: boolean }) => void {
  return useCallback((url: string, opts) => {
    const router = getRouter();
    if (router) {
      void router.navigate(url, opts);
    } else {
      window.location.href = url;
    }
  }, []);
}
