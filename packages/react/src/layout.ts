import { createContext, useContext, createElement } from "react";
import type { ReactNode, ReactElement } from "react";

// Outlet renders child content in a layout
const OutletContext = createContext<ReactNode>(null);

export function OutletProvider({
  children,
  outlet,
}: {
  children: ReactElement;
  outlet: ReactNode;
}) {
  return createElement(OutletContext.Provider, { value: outlet }, children);
}

export function Outlet(): ReactElement {
  const outlet = useContext(OutletContext);
  return outlet as ReactElement;
}
