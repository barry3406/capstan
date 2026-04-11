import { useContext, useOptimistic } from "react";
import { PageContext } from "./loader.js";

export function useAuth() {
  const ctx = useContext(PageContext);
  return ctx.auth;
}

export function useParams(): Record<string, string> {
  const ctx = useContext(PageContext);
  return ctx.params;
}

/**
 * Optimistic state for mutations using React 19's `useOptimistic` hook.
 *
 * `useOptimistic` allows showing a temporary "optimistic" state while an
 * async action (form submission, API call) is in progress. The optimistic
 * value is automatically reverted to the real state once the action's
 * parent transition completes.
 *
 * @param currentState  The actual state value (e.g., from server/loader data)
 * @param updateFn  Reducer that merges the current state with an optimistic value
 * @returns `[optimisticState, addOptimistic]` tuple
 *
 * @example
 * ```tsx
 * function TodoList({ todos }: { todos: Todo[] }) {
 *   const [optimisticTodos, addOptimisticTodo] = useCapstanOptimistic(
 *     todos,
 *     (state, newTodo: Todo) => [...state, newTodo],
 *   );
 *
 *   async function handleAdd(formData: FormData) {
 *     const title = formData.get("title") as string;
 *     addOptimisticTodo({ id: "temp", title, completed: false });
 *     await createTodo(title); // server call
 *   }
 *
 *   return (
 *     <ul>
 *       {optimisticTodos.map(todo => <li key={todo.id}>{todo.title}</li>)}
 *     </ul>
 *   );
 * }
 * ```
 *
 * @see https://react.dev/reference/react/useOptimistic
 */
export function useCapstanOptimistic<TState, TAction>(
  currentState: TState,
  updateFn: (currentState: TState, action: TAction) => TState,
): [TState, (action: TAction) => void] {
  return useOptimistic(currentState, updateFn);
}
