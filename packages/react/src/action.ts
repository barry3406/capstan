import {
  createContext,
  useContext,
  createElement,
  useActionState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import type { ActionResult } from "@zauso-ai/capstan-core";

// ---------------------------------------------------------------------------
// Action context
// ---------------------------------------------------------------------------

export interface ActionContextValue {
  result?: ActionResult<unknown>;
  formData?: Record<string, unknown>;
}

export const ActionContext = createContext<ActionContextValue | undefined>(
  undefined,
);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useActionData<T = unknown>(): ActionResult<T> | undefined {
  const ctx = useContext(ActionContext);
  if (ctx === undefined) {
    return undefined;
  }
  return ctx.result as ActionResult<T> | undefined;
}

export function useFormData(): Record<string, unknown> | undefined {
  const ctx = useContext(ActionContext);
  if (ctx === undefined) {
    return undefined;
  }
  return ctx.formData;
}

// ---------------------------------------------------------------------------
// useCapstanAction — React 19 useActionState wrapper
// ---------------------------------------------------------------------------

/**
 * Result from `useCapstanAction`, wrapping React 19's `useActionState`.
 */
export interface CapstanActionState<T> {
  /** Current state (initially `initialState`, then the return value of `action`). */
  state: T;
  /** Form action function to pass to `<form action={...}>` or `<button formAction={...}>`. */
  formAction: (payload: FormData) => void;
  /** Whether the action is currently executing (pending transition). */
  isPending: boolean;
}

/**
 * Wrap an async server action with React 19's `useActionState` hook.
 *
 * `useActionState` (new in React 19) replaces the React 18 pattern of
 * managing form submission state manually. It integrates with React's
 * transition system to provide:
 * - Automatic pending state tracking (`isPending`)
 * - Progressive enhancement (works before JS loads)
 * - Sequential state updates (previous state fed into next action call)
 *
 * @param action  Async function `(previousState: T, formData: FormData) => Promise<T>`
 * @param initialState  Initial value for the action state
 * @param permalink  Optional URL for progressive enhancement (server-side form target)
 * @returns `{ state, formAction, isPending }`
 *
 * @example
 * ```tsx
 * const { state, formAction, isPending } = useCapstanAction(
 *   async (prev, formData) => {
 *     const result = await submitForm(formData);
 *     return result;
 *   },
 *   { status: "idle" },
 * );
 *
 * return (
 *   <form action={formAction}>
 *     <button disabled={isPending}>Submit</button>
 *     {state.status === "error" && <p>Error occurred</p>}
 *   </form>
 * );
 * ```
 *
 * @see https://react.dev/reference/react/useActionState
 */
export function useCapstanAction<T>(
  action: (previousState: Awaited<T>, formData: FormData) => T | Promise<T>,
  initialState: Awaited<T>,
  permalink?: string,
): CapstanActionState<Awaited<T>> {
  const [state, formAction, isPending] = useActionState(action, initialState, permalink);
  return { state, formAction, isPending };
}

// ---------------------------------------------------------------------------
// ActionForm component
// ---------------------------------------------------------------------------

export interface ActionFormProps {
  action?: string;
  encType?:
    | "application/x-www-form-urlencoded"
    | "multipart/form-data";
  children?: ReactNode;
  className?: string;
  id?: string;
}

export function ActionForm(props: ActionFormProps): ReactElement {
  const {
    action,
    encType,
    children,
    className,
    id,
  } = props;

  const hiddenField = createElement("input", {
    type: "hidden",
    name: "_capstan_action",
    value: "1",
  });

  return createElement(
    "form",
    {
      method: "post",
      ...(action !== undefined ? { action } : {}),
      ...(encType !== undefined ? { encType } : {}),
      ...(className !== undefined ? { className } : {}),
      ...(id !== undefined ? { id } : {}),
    },
    hiddenField,
    children,
  );
}
