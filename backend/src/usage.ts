import { AsyncLocalStorage } from "node:async_hooks";

// Token use, added up over a piece of work - an agent review - so what
// caching saves can be seen. Model calls made inside `usageScope.run` add to
// its tally.

export interface Usage {
  calls: number;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

export const usageScope = new AsyncLocalStorage<Usage>();

export function emptyUsage(): Usage {
  return { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

export function addUsage(u: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number } | undefined) {
  const tally = usageScope.getStore();
  if (!tally || !u) return;
  tally.calls += 1;
  tally.input += u.input_tokens ?? 0;
  tally.cacheRead += u.cache_read_input_tokens ?? 0;
  tally.cacheWrite += u.cache_creation_input_tokens ?? 0;
  tally.output += u.output_tokens ?? 0;
}
