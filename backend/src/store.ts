import { chmodSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Each PR's review - slices, summary, threads, feedback, the prepared review
// - as one JSON record, kept here on the backend so anything that talks to
// the backend (the browser, or an agent over MCP) sees the same state.
//
// Every write names the version it started from, and is refused if the
// record has moved on since, so two writers can't silently undo each other.

const dbFile = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "docent.db");
mkdirSync(dirname(dbFile), { recursive: true });

const db = new DatabaseSync(dbFile);
// Reviews can quote private code, so only this user can read them.
chmodSync(dbFile, 0o600);
db.exec(`
  CREATE TABLE IF NOT EXISTS prs (
    key TEXT PRIMARY KEY,
    record TEXT NOT NULL,
    version INTEGER NOT NULL
  )
`);

export interface StoredRecord {
  record: Record<string, unknown>;
  // 0 for a PR with nothing saved yet.
  version: number;
}

export function keyFor(owner: string, repo: string, number: string): string {
  return `${owner}/${repo}/${number}`;
}

export function getRecord(key: string): StoredRecord {
  const row = db.prepare("SELECT record, version FROM prs WHERE key = ?").get(key) as
    | { record: string; version: number }
    | undefined;
  return row ? { record: JSON.parse(row.record), version: row.version } : { record: {}, version: 0 };
}

export class VersionConflict extends Error {
  constructor(readonly current: StoredRecord) {
    super("The record changed since it was read.");
  }
}

// Saves a record written from `version`, and returns the new version.
export function putRecord(key: string, record: Record<string, unknown>, version: number): number {
  const next = version + 1;
  const json = JSON.stringify(record);
  const result =
    version === 0
      ? db.prepare("INSERT INTO prs (key, record, version) VALUES (?, ?, 1) ON CONFLICT(key) DO NOTHING").run(key, json)
      : db.prepare("UPDATE prs SET record = ?, version = ? WHERE key = ? AND version = ?").run(json, next, key, version);
  if (result.changes === 0) throw new VersionConflict(getRecord(key));
  return next;
}

export function listRecords(): { key: string; record: Record<string, unknown> }[] {
  const rows = db.prepare("SELECT key, record FROM prs").all() as { key: string; record: string }[];
  return rows.map((row) => ({ key: row.key, record: JSON.parse(row.record) }));
}

export function deleteRecord(key: string): void {
  db.prepare("DELETE FROM prs WHERE key = ?").run(key);
}
