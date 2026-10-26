import { changeRecord, listRecords } from "./store.server.js";
import { persistent } from "./persistent.server.js";
import { clearInterruptedChecks } from "../features/threads/threadChecks.server.js";
import { editRound } from "../features/panel/editorRuns.server.js";
import { knownMcpUrl } from "../api/mcpUrl.server.js";

// Work saved as under way when the server starts can't still be: whatever
// ran it went with the last process. Each is marked as interrupted, once a
// start, so the page says so instead of waiting on it. Findings a panel left
// for the editor are taken up again, as the panel would have.

const INTERRUPTED = "Interrupted when Docent restarted.";

type Job = { status?: string; error?: string };
type Items = Record<string, { items?: { edited?: boolean; editFailed?: boolean }[] } | undefined>;

const unedited = (round: Record<string, unknown>) =>
  Object.entries((round.feedback as Items | undefined) ?? {}).some(
    ([reviewer, draft]) => reviewer.startsWith("agent-") && (draft?.items ?? []).some((i) => !i.edited && !i.editFailed),
  );

function failRunning(jobs: unknown): boolean {
  let changed = false;
  for (const job of Object.values((jobs as Record<string, Job> | undefined) ?? {})) {
    if (job?.status !== "running") continue;
    job.status = "failed";
    job.error = INTERRUPTED;
    changed = true;
  }
  return changed;
}

persistent("interrupted-swept", () => {
  for (const { key, record } of listRecords()) {
    const rounds = [record, ...((record.rounds as Record<string, unknown>[] | undefined) ?? [])];
    if (!rounds.some((r) => Object.values((r.jobs as Record<string, Job> | undefined) ?? {}).some((j) => j?.status === "running"))) continue;
    changeRecord(key, (r) => {
      for (const round of [r, ...((r.rounds as Record<string, unknown>[] | undefined) ?? [])]) failRunning(round.jobs);
    });
  }
  clearInterruptedChecks(INTERRUPTED);
  for (const { key, record } of listRecords()) {
    const [owner, repo, number] = key.split("/");
    const earlier = (record.rounds as Record<string, unknown>[] | undefined) ?? [];
    earlier.forEach((round, i) => unedited(round) && void editRound(owner, repo, number, i, knownMcpUrl()));
    if (unedited(record)) void editRound(owner, repo, number, undefined, knownMcpUrl());
  }
  return true;
});
