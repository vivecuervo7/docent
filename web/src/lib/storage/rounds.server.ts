import { getRecord, keyFor } from "./store.server.js";
import { ROUND_FIELDS } from "./rounds.js";

// A PR's rounds, as the backend reads them: the record's own fields are the
// latest, and each earlier round is read the same way through a view of it.
// A round is given by its index among the earlier ones; none is the latest.

type Stored = Record<string, unknown> & { rounds?: Record<string, unknown>[] };
type Reviewer = { id: string; name?: string };

export function roundRecord(owner: string, repo: string, number: string, round?: number): Stored {
  const record = getRecord(keyFor(owner, repo, number)).record as Stored;
  if (round === undefined) return record;
  const earlier = record.rounds?.[round];
  if (!earlier) throw new Error(`This PR has no round ${round + 1}.`);
  const view: Stored = { ...record };
  for (const field of ROUND_FIELDS) delete view[field];
  return { ...view, ...earlier };
}

// The round a reviewer is on. Reviewer ids aren't reused across a PR's
// rounds, so each belongs to one.
export function roundOf(owner: string, repo: string, number: string, reviewer: string | undefined): number | undefined {
  if (!reviewer) return undefined;
  const record = getRecord(keyFor(owner, repo, number)).record as Stored;
  const at = (record.rounds ?? []).findIndex((r) => (r.agentReviewers as Reviewer[] | undefined)?.some((a) => a.id === reviewer));
  return at >= 0 ? at : undefined;
}

// Every reviewer on the PR, the latest round's first.
export function allReviewers(owner: string, repo: string, number: string): Reviewer[] {
  const record = getRecord(keyFor(owner, repo, number)).record as Stored;
  return [record, ...[...(record.rounds ?? [])].reverse()].flatMap((r) => (Array.isArray(r.agentReviewers) ? (r.agentReviewers as Reviewer[]) : []));
}

// How a round is named to an agent, after the PR: "owner/repo#12@round1".
export function prRef(owner: string, repo: string, number: string, round?: number): string {
  return `${owner}/${repo}#${number}${round === undefined ? "" : `@round${round + 1}`}`;
}
