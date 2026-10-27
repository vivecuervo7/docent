import { changeRound } from './rounds.server.js';

// Work on a round that takes a model a while - drafting your comments,
// preparing the review - run here and kept in the round as a job: running,
// then done with what it made, or failed. It finishes whether or not a page
// is open; the page makes the job's result its own when it next looks, and
// clears it. One under way when this process stops is lost.

export type JobName = 'draft' | 'prepare';

export function startJob(
	ref: { owner: string; repo: string; number: string; round?: number },
	name: JobName,
	input: unknown,
	work: () => Promise<unknown>
): void {
	const { owner, repo, number, round } = ref;
	const save = (job: Record<string, unknown>) =>
		changeRound(owner, repo, number, round, (record) => {
			record.jobs = { ...(record.jobs as Record<string, unknown> | undefined), [name]: job };
		});
	const startedAt = Date.now();
	save({ status: 'running', startedAt, input });
	work()
		.then(
			(result) => save({ status: 'done', startedAt, input, result }),
			(err) => save({ status: 'failed', startedAt, input, error: (err as Error).message })
		)
		// The round can be gone by the time it's saved.
		.catch((err) => console.error(`[job] ${name}: ${(err as Error).message}`));
}
