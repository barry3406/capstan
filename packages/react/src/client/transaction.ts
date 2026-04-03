import type { ClientMetadata, ClientRouteEntry } from "./types.js";
import type { ScrollSnapshot } from "./scroll.js";

/**
 * Navigation transaction helpers.
 *
 * The router keeps a stack of pending navigations so that only the most
 * recent transaction can commit, while older ones are aborted and safely
 * ignored if they resolve later.
 */

export interface StableViewState {
  url: string;
  route: ClientRouteEntry | undefined;
  metadata: ClientMetadata | undefined;
  title: string;
  scroll: ScrollSnapshot | null;
}

export interface NavigationTransaction {
  id: number;
  targetUrl: string;
  controller: AbortController;
  previous: StableViewState;
}

export class NavigationTransactionStack {
  private stack: NavigationTransaction[] = [];
  private nextId = 0;

  begin(transaction: Omit<NavigationTransaction, "id">): NavigationTransaction {
    const next: NavigationTransaction = {
      ...transaction,
      id: ++this.nextId,
    };

    this.stack.at(-1)?.controller.abort();
    this.stack.push(next);
    return next;
  }

  current(): NavigationTransaction | null {
    this.pruneAborted();
    return this.stack.at(-1) ?? null;
  }

  isCurrent(transaction: NavigationTransaction): boolean {
    return this.current()?.id === transaction.id && !transaction.controller.signal.aborted;
  }

  complete(transaction: NavigationTransaction): boolean {
    if (!this.isCurrent(transaction)) {
      return false;
    }

    this.stack.pop();
    this.pruneAborted();
    return true;
  }

  rollback(transaction: NavigationTransaction): boolean {
    if (!this.isCurrent(transaction)) {
      return false;
    }

    this.stack.pop();
    this.pruneAborted();
    return true;
  }

  clear(): void {
    this.stack.length = 0;
  }

  private pruneAborted(): void {
    while (this.stack.length > 0 && this.stack.at(-1)?.controller.signal.aborted) {
      this.stack.pop();
    }
  }
}

