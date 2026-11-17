import { useSyncExternalStore } from "react";

/** Minimal observable value for app-wide state (connection, session). */
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of [...listeners]) fn();
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
