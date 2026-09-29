import { laneOf } from "../storage/settings.server.js";
import { persistent } from "../storage/persistent.server.js";

// Model calls wait their turn here, so each tool or provider runs only as many
// at once as it allows: interactive calls - replies, drafting, reviews,
// preparing the review - apart from the generation queue, so a question isn't
// stuck behind a PR being prepared, and a burst of them doesn't pile onto a
// local model.

// A queue per tool or provider (see laneOf), each running as many calls at
// once as it allows, the rest waiting their turn.
const lanes = persistent("lanes", () => new Map<string, { active: number; waiting: (() => void)[] }>());

function admit(key: string, cap: number) {
  const lane = lanes.get(key)!;
  while (lane.active < cap && lane.waiting.length > 0) {
    lane.active++;
    lane.waiting.shift()!();
  }
}

export function inNamedLane<T>(key: string, cap: number, work: () => Promise<T>): Promise<T> {
  if (!lanes.has(key)) lanes.set(key, { active: 0, waiting: [] });
  const lane = lanes.get(key)!;
  return new Promise<void>((start) => {
    lane.waiting.push(start);
    admit(key, cap);
  })
    .then(work)
    .finally(() => {
      lane.active--;
      admit(key, cap);
    });
}

// Shared by the interactive model calls - replies, drafting, reviews,
// preparing the review - in the queue for the model they call.
export function inLane<T>(work: () => Promise<T>, model?: string): Promise<T> {
  const { key, cap } = laneOf(model);
  return inNamedLane(key, cap, work);
}
