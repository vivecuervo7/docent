import { database } from "../../storage/store.server.js";
import { persistent } from "../../storage/persistent.server.js";

// Things counted as they happen, by when: model calls made, and GitHub
// threads resolved from Docent.

export type TallyKind = "call" | "resolved";

const db = persistent("stats-tallies", () => {
  const opened = database();
  opened.exec("CREATE TABLE IF NOT EXISTS tallies (at INTEGER NOT NULL, kind TEXT NOT NULL)");
  return opened;
});

export function tally(kind: TallyKind, at = Date.now()) {
  db.prepare("INSERT INTO tallies (at, kind) VALUES (?, ?)").run(at, kind);
}

export function tallied(kind: TallyKind): number[] {
  return (db.prepare("SELECT at FROM tallies WHERE kind = ? ORDER BY at").all(kind) as { at: number }[]).map((r) => r.at);
}
