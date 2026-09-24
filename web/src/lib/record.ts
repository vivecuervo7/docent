import { FIRST_AGENT, type PrRecord, type PrRef, type SavedPr } from './types';

// Each PR's review is one record on the backend. Every write names the
// version it started from; if something else saved first (the React app, or
// an agent over MCP), the backend refuses with the latest copy and the change
// is made again on that.

const url = (ref: PrRef) => `/api/prs/${ref.owner}/${ref.repo}/${ref.number}`;
const keyOf = (ref: PrRef) => `${ref.owner}/${ref.repo}/${ref.number}`;

export function emptyRecord(): PrRecord {
	return {
		reviewed: {},
		slices: null,
		summary: null,
		conversation: null,
		fileNotes: null,
		notes: [],
		feedback: {},
		agentReviewers: [{ id: FIRST_AGENT }]
	};
}

// Fills in what an older record lacks, the same way the React app does.
export function normalize(stored: Partial<PrRecord> | undefined): PrRecord {
	const record = { ...emptyRecord(), ...stored } as PrRecord;
	if (Array.isArray(record.conversation)) record.conversation = null;
	record.reviewed ??= {};
	record.slices ??= null;
	record.fileNotes ??= null;
	record.notes ??= [];
	record.feedback ??= {};
	const legacy = record.feedback.agent;
	if (legacy) {
		record.feedback = { ...record.feedback, [FIRST_AGENT]: record.feedback[FIRST_AGENT] ?? legacy };
		delete record.feedback.agent;
	}
	record.agentReviewers ??= [];
	if (record.agentReviewers[0]?.id !== FIRST_AGENT) {
		record.agentReviewers = [{ id: FIRST_AGENT }, ...record.agentReviewers.filter((r) => r.id !== FIRST_AGENT)];
	}
	return record;
}

export async function getRecord(ref: PrRef): Promise<{ record: PrRecord; version: number }> {
	const res = await fetch(url(ref));
	if (!res.ok) throw new Error(`Couldn't load the review (${res.status})`);
	const { record, version } = (await res.json()) as { record: Partial<PrRecord>; version: number };
	return { record: normalize(record), version };
}

// One save at a time per PR from this page, so its own writes never race.
const saving = new Map<string, Promise<unknown>>();

function oneAtATime<T>(key: string, work: () => Promise<T>): Promise<T> {
	const run = (saving.get(key) ?? Promise.resolve()).then(work, work);
	saving.set(key, run.catch(() => {}));
	return run;
}

export function updateRecord(ref: PrRef, change: (record: PrRecord) => void): Promise<PrRecord> {
	return oneAtATime(keyOf(ref), async () => {
		let { record, version } = await getRecord(ref);
		for (let attempt = 0; attempt < 5; attempt++) {
			change(record);
			const res = await fetch(url(ref), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ record, version })
			});
			if (res.status === 409) {
				const current = (await res.json()) as { record: Partial<PrRecord>; version: number };
				record = normalize(current.record);
				version = current.version;
				continue;
			}
			if (!res.ok) throw new Error(`Couldn't save the review (${res.status})`);
			return record;
		}
		throw new Error("Couldn't save the review: it kept changing underneath.");
	});
}

export async function listSaved(): Promise<SavedPr[]> {
	const res = await fetch('/api/prs');
	if (!res.ok) throw new Error(`Couldn't list saved reviews (${res.status})`);
	const { prs } = (await res.json()) as { prs: (SavedPr & { record: Partial<PrRecord> })[] };
	return prs.map((p) => ({ ...p, record: normalize(p.record) }));
}

export async function deleteSaved(ref: PrRef): Promise<void> {
	await fetch(url(ref), { method: 'DELETE' });
}
