import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir } from "./dataDir.server.js";
import { persistent } from "./persistent.server.js";

// Each PR's review - slices, summary, threads, feedback, the prepared review
// - as one JSON record, kept here on the backend so anything that talks to
// the backend (the browser, or an agent over MCP) sees the same state.
//
// Every write names the version it started from, and is refused if the
// record has moved on since, so two writers can't silently undo each other.

const dbFile = dataDir("docent.db");
mkdirSync(dirname(dbFile), { recursive: true });

// Opened once for the process, however often this module is reloaded.
const db = persistent("db", () => {
  const opened = new DatabaseSync(dbFile);
  // Reviews can quote private code, so only this user can read them.
  chmodSync(dbFile, 0o600);
  opened.exec(`
    CREATE TABLE IF NOT EXISTS prs (
      key TEXT PRIMARY KEY,
      record TEXT NOT NULL,
      version INTEGER NOT NULL
    )
  `);
  return opened;
});

// The database itself, for what's kept beside the reviews.
export const database = () => db;

// Told of each review saved or deleted, by what keeps track of them.
const watchers = persistent("record-watchers", () => [] as { saved: (key: string, record: Record<string, unknown>) => void; deleted: (key: string) => void }[]);
export function onRecordChange(watcher: (typeof watchers)[number]) {
  watchers.push(watcher);
}

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
  for (const w of watchers) w.saved(key, record);
  return next;
}

// Changes a record from the backend, the way the browser does: on the
// latest version, made again on the newer one when something saved first.
// Long-running work keeps its results this way, so they land whether or
// not a page is open.
export function changeRecord(key: string, change: (record: Record<string, unknown>) => void): Record<string, unknown> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { record, version } = getRecord(key);
    change(record);
    try {
      putRecord(key, record, version);
      return record;
    } catch (err) {
      if (!(err instanceof VersionConflict)) throw err;
    }
  }
  throw new Error(`Couldn't save ${key}: it kept changing underneath.`);
}

export function listRecords(): { key: string; record: Record<string, unknown> }[] {
  const rows = db.prepare("SELECT key, record FROM prs").all() as { key: string; record: string }[];
  return rows.map((row) => ({ key: row.key, record: JSON.parse(row.record) }));
}

export function deleteRecord(key: string): void {
  db.prepare("DELETE FROM prs WHERE key = ?").run(key);
  for (const w of watchers) w.deleted(key);
}
