import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dataDir } from './dataDir.server.js';
import { persistent } from './persistent.server.js';

// Each PR's review - slices, summary, threads, feedback, the prepared review
// - as one JSON record, kept here on the backend so anything that talks to
// the backend (the browser, or an agent over MCP) sees the same state.
//
// Every write names the version it started from, and is refused if the
// record has moved on since, so two writers can't silently undo each other.

const dbFile = dataDir('docent.db');
mkdirSync(dirname(dbFile), { recursive: true });

// Opened once for the process, however often this module is reloaded.
const db = persistent('db', () => {
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
// A deleted review is kept a week, for undoing; `at` is when it went.
const watchers = persistent(
	'record-watchers',
	() =>
		[] as {
			saved: (key: string, record: Record<string, unknown>) => void;
			deleted: (key: string, at: number) => void;
			restored?: (key: string, at: number) => void;
		}[]
);
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
	const row = db.prepare('SELECT record, version FROM prs WHERE key = ?').get(key) as { record: string; version: number } | undefined;
	return row ? { record: JSON.parse(row.record), version: row.version } : { record: {}, version: 0 };
}

export class VersionConflict extends Error {
	constructor(readonly current: StoredRecord) {
		super('The record changed since it was read.');
	}
}

// Saves a record written from `version`, and returns the new version.
export function putRecord(key: string, record: Record<string, unknown>, version: number): number {
	const next = version + 1;
	const json = JSON.stringify(record);
	const result =
		version === 0
			? db.prepare('INSERT INTO prs (key, record, version) VALUES (?, ?, 1) ON CONFLICT(key) DO NOTHING').run(key, json)
			: db.prepare('UPDATE prs SET record = ?, version = ? WHERE key = ? AND version = ?').run(json, next, key, version);
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
	const rows = db.prepare('SELECT key, record FROM prs').all() as { key: string; record: string }[];
	return rows.map((row) => ({ key: row.key, record: JSON.parse(row.record) }));
}

db.exec(`
	CREATE TABLE IF NOT EXISTS deleted_prs (
		key TEXT NOT NULL,
		record TEXT NOT NULL,
		version INTEGER NOT NULL,
		deleted_at INTEGER NOT NULL,
		PRIMARY KEY (key, deleted_at)
	)
`);

const KEPT_FOR = 7 * 24 * 60 * 60 * 1000;

// A review deleted is kept aside for a week, so it can be put back.
export function deleteRecord(key: string): void {
	const at = Date.now();
	const row = db.prepare('SELECT record, version FROM prs WHERE key = ?').get(key) as { record: string; version: number } | undefined;
	if (row) db.prepare('INSERT INTO deleted_prs (key, record, version, deleted_at) VALUES (?, ?, ?, ?)').run(key, row.record, row.version, at);
	db.prepare('DELETE FROM prs WHERE key = ?').run(key);
	for (const w of watchers) w.deleted(key, at);
}

// Reviews deleted in the last week, latest first; older ones go for good.
export function listDeleted(): { key: string; title?: string; deletedAt: number }[] {
	db.prepare('DELETE FROM deleted_prs WHERE deleted_at < ?').run(Date.now() - KEPT_FOR);
	const rows = db.prepare('SELECT key, record, deleted_at FROM deleted_prs ORDER BY deleted_at DESC').all() as {
		key: string;
		record: string;
		deleted_at: number;
	}[];
	return rows.map((r) => ({ key: r.key, title: (JSON.parse(r.record) as { title?: string }).title, deletedAt: r.deleted_at }));
}

// Puts a deleted review back, unless the PR has been reviewed afresh since.
export function restoreRecord(key: string, at: number): void {
	const row = db.prepare('SELECT record, version FROM deleted_prs WHERE key = ? AND deleted_at = ?').get(key, at) as
		{ record: string; version: number } | undefined;
	if (!row) throw new Error('That review is no longer kept.');
	if (db.prepare('SELECT 1 FROM prs WHERE key = ?').get(key)) throw new Error('This PR has a review again since; delete that one first to put this one back.');
	db.prepare('INSERT INTO prs (key, record, version) VALUES (?, ?, ?)').run(key, row.record, row.version);
	db.prepare('DELETE FROM deleted_prs WHERE key = ? AND deleted_at = ?').run(key, at);
	for (const w of watchers) w.restored?.(key, at);
}
