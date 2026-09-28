// State that outlives the module holding it. In development the server's
// modules are reloaded when edited, which would start their maps and queues
// afresh while reviews and model calls from before the edit are still
// running; state made through this is kept on the process instead, so an
// edit mid-run loses nothing. In production nothing reloads, and each is
// simply made once.
export function persistent<T>(name: string, init: () => T): T {
  const store = globalThis as unknown as Record<symbol, T | undefined>;
  const key = Symbol.for(`docent.${name}`);
  return (store[key] ??= init());
}
