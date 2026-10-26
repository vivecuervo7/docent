import { changeRecord, listRecords } from "./store.server.js";
import { persistent } from "./persistent.server.js";

// A round is done once its review is posted. Rounds posted before posting
// marked them so are marked now, as of when they were posted.

type Round = { completedAt?: number; review?: { posted?: { at: number; pending?: boolean } } };

const undone = (r: Round) => !!r.review?.posted && !r.review.posted.pending && !r.completedAt;

persistent("posted-done", () => {
  for (const { key, record } of listRecords()) {
    const rounds = [record, ...((record.rounds as Round[] | undefined) ?? [])] as Round[];
    if (!rounds.some(undone)) continue;
    changeRecord(key, (r) => {
      for (const round of [r, ...((r.rounds as Round[] | undefined) ?? [])] as Round[]) {
        if (undone(round)) round.completedAt = round.review!.posted!.at;
      }
    });
  }
  return true;
});
