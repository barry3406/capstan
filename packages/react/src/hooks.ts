import { useContext } from "react";
import { PageContext } from "./loader.js";

export function useAuth() {
  const ctx = useContext(PageContext);
  return ctx.auth;
}

export function useParams(): Record<string, string> {
  const ctx = useContext(PageContext);
  return ctx.params;
}
