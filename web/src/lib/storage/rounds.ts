import { emptyRecord } from './record';
import type { PrRecord, Round } from '../types';

// A PR reviewed again after more commits keeps each earlier review as a
// round. The record's own fields are the latest round, so everything that
// reads a review reads that one; an earlier round is read through a view
// that puts its fields over the record's.

export const ROUND_FIELDS = [
	'range',
	'reviewed',
	'slices',
	'summary',
	'conversation',
	'fileNotes',
	'notes',
	'feedback',
	'agentReviewers',
	'agentHighest',
	'panelSettled',
	'review',
	'preparedHead',
	'completedAt'
] as const satisfies readonly (keyof PrRecord)[];

// Copied through JSON, as it may be the page's live state, which can't be
// cloned directly; a record is JSON anyway.
function pick(record: PrRecord): Round {
	const round: Record<string, unknown> = {};
	for (const field of ROUND_FIELDS) if (record[field] !== undefined) round[field] = JSON.parse(JSON.stringify(record[field]));
	return round as Round;
}

// An earlier round, read like the latest.
export function roundView(record: PrRecord, index: number): PrRecord {
	const view = { ...record } as Record<string, unknown>;
	for (const field of ROUND_FIELDS) delete view[field];
	return { ...emptyRecord(), ...view, ...record.rounds?.[index] } as PrRecord;
}

// Puts a change made to an earlier round's view back: its fields into the
// round, the rest into the record.
export function keepRound(record: PrRecord, view: PrRecord, index: number): void {
	const rounds = record.rounds ?? [];
	const round = pick(view);
	for (const [field, value] of Object.entries(view)) {
		if (field !== 'rounds' && !(ROUND_FIELDS as readonly string[]).includes(field)) (record as unknown as Record<string, unknown>)[field] = value;
	}
	record.rounds = rounds.map((r, i) => (i === index ? round : r));
}

// Takes back a round begun but not yet prepared: the one before it is the
// latest again.
export function dropRound(record: PrRecord): void {
	const last = record.rounds?.at(-1);
	if (!last) return;
	for (const field of ROUND_FIELDS) delete record[field];
	Object.assign(record, emptyRecord(), last);
	record.rounds = record.rounds!.slice(0, -1);
	if (!record.rounds.length) delete record.rounds;
}

// Moves the latest round into the earlier ones and begins another, with
// the commits given or the whole PR.
export function beginRound(record: PrRecord, range: PrRecord['range'] | null): void {
	record.rounds = [...(record.rounds ?? []), pick(record)];
	const fresh = emptyRecord();
	for (const field of ROUND_FIELDS) delete record[field];
	Object.assign(record, {
		reviewed: fresh.reviewed,
		slices: fresh.slices,
		summary: fresh.summary,
		conversation: fresh.conversation,
		fileNotes: fresh.fileNotes,
		notes: fresh.notes,
		feedback: fresh.feedback,
		agentReviewers: fresh.agentReviewers,
		...(range ? { range } : {})
	});
}
