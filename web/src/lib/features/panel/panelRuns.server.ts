import { dismissAgentReview, getAgentReview, openExternalReview, startBuiltinReview, startSessionReview, type ReviewContext } from "./agentReviews.server.js";
import { pickPersonas } from "./auto.server.js";
import { AUTO_PERSONA, isAuto, nameAll, reviewerFrom, sessionId, setupFrom, setupValue, type ReviewerSetup } from "./panel.svelte.js";
import { fetchReviewFiles } from "../../github/range.server.js";
import { changeRound, roundRecord } from "../../storage/rounds.server.js";
import { defaultPanel, externalReviewers, modelName, personas } from "../../storage/settings.server.js";
import { parseFilePatch } from "../reading/diff/parse.js";
import { everythingElse, reviewKeys } from "../reading/progress.js";
import type { AgentReviewer, PrRecord } from "../../types.js";

// Starting the panel, here rather than in the browser: the default panel
// given to a round once it's prepared, a reviewer started, "auto" choosing
// the personas a PR warrants and starting them, and the whole panel started
// once a round's prepared when that was asked for. What each does is saved
// into the round, so it goes on whether or not a page is open.

export interface Ref {
  owner: string;
  repo: string;
  number: string;
  round?: number;
}

const read = ({ owner, repo, number, round }: Ref) => roundRecord(owner, repo, number, round) as unknown as PrRecord;
const change = ({ owner, repo, number, round }: Ref, edit: (record: PrRecord) => void) =>
  changeRound(owner, repo, number, round, (record) => edit(record as unknown as PrRecord));

const isDocents = (a: AgentReviewer) => {
  const runs = a.planned ?? a.ranWith;
  return runs !== "external" && !sessionId(runs);
};

// The default panel, for a round whose panel is as a new one starts: one
// reviewer, never run or changed. Ids carry on from earlier rounds.
export function applyDefaultPanel(ref: Ref) {
  change(ref, (r) => {
    const panel = r.agentReviewers ?? [];
    const untouched =
      !r.panelSettled && panel.length <= 1 && panel.every((a) => !a.ranWith && !a.planned && !a.lastRun && !r.feedback?.[a.id]?.items.length);
    if (!untouched) return;
    r.panelSettled = true;
    const saved = defaultPanel();
    const highest = r.agentHighest ?? 0;
    // An empty default is a choice too: no reviewers.
    if (saved) r.agentReviewers = saved.map((entry, i) => reviewerFrom(entry, `agent-${highest + i + 1}`));
    else r.agentReviewers = panel;
    r.agentHighest = Math.max(highest, ...r.agentReviewers.map((a) => Number(a.id.slice("agent-".length)) || 0));
    nameAll(r);
  });
}

// What reviewers are told about the round: its title, summary and slices,
// the hunks no slice took as one last slice.
async function contextOf(ref: Ref): Promise<ReviewContext> {
  const r = read(ref);
  const files = await fetchReviewFiles(ref.owner, ref.repo, ref.number, ref.round);
  const keys = reviewKeys(files, (f) => parseFilePatch(f.patch ?? ""));
  const prepared = r.slices ?? [];
  const rest = prepared.length ? everythingElse(keys, prepared) : null;
  return { title: r.title, summary: r.summary ?? null, slices: rest ? [...prepared, rest] : prepared };
}

// Starts one reviewer: Docent's own, one of your external reviewers, or
// waiting for your own agent. "auto" chooses its personas first, after
// this returns.
export async function startReviewer(ref: Ref, id: string, setup: ReviewerSetup, mcpUrl: string): Promise<void> {
  if (setup.mode === "builtin" && setup.persona === AUTO_PERSONA) return startAuto(ref, id, setup.model, mcpUrl);
  const { owner, repo, number } = ref;
  const context = await contextOf(ref);
  if (setup.mode === "builtin") {
    const persona = setup.persona ? personas.list().find((p) => p.id === setup.persona) : undefined;
    startBuiltinReview(owner, repo, number, context, id, setup.model, persona?.instructions, mcpUrl);
  } else if (setup.mode === "session") {
    const session = externalReviewers.list().find((p) => p.id === setup.session);
    if (!session) throw new Error("That external reviewer isn't set up any more.");
    startSessionReview(owner, repo, number, context, session, mcpUrl, id);
  } else {
    openExternalReview(owner, repo, number, context, id);
  }
  change(ref, (r) => {
    r.agentReviewers = (r.agentReviewers ?? []).map((a) => (a.id === id ? { ...a, ranWith: setupValue(setup), planned: undefined } : a));
    r.panelSettled = true;
  });
}

// "auto": chooses the personas the PR warrants - the general reviewer too,
// unless one's on the panel by choice - puts them on the panel after it in
// place of its last picks, and starts them.
function startAuto(ref: Ref, id: string, model: string, mcpUrl: string) {
  change(ref, (r) => {
    r.agentReviewers = (r.agentReviewers ?? []).map((a) => (a.id === id ? { ...a, picking: true } : a));
  });
  void (async () => {
    const before = read(ref).agentReviewers ?? [];
    const chosen = before.flatMap((a) => (!a.pickedBy && isDocents(a) && a.persona && !isAuto(a) ? [a.persona] : []));
    const general = !before.some((a) => !a.pickedBy && isDocents(a) && !a.persona && !isAuto(a));
    try {
      const picks = await pickPersonas(ref.owner, ref.repo, ref.number, model, chosen, ref.round);
      const previous = before.filter((a) => a.pickedBy === id).map((a) => a.id);
      for (const old of previous) dismissAgentReview(ref.owner, ref.repo, ref.number, old, true);
      const added: { id: string; persona?: string }[] = [];
      change(ref, (r) => {
        for (const old of previous) delete r.feedback?.[old];
        const panel = r.agentReviewers ?? [];
        const highest = Math.max(0, r.agentHighest ?? 0, ...panel.map((a) => Number(a.id.slice("agent-".length)) || 0));
        const wanted: { persona?: string; reason: string }[] = [...(general ? [{ reason: "The general reviewer reviews every PR." }] : []), ...picks];
        const fresh = wanted.map((p, i): AgentReviewer => {
          const pid = `agent-${highest + i + 1}` as AgentReviewer["id"];
          added.push({ id: pid, ...(p.persona ? { persona: p.persona } : {}) });
          return { id: pid, planned: model, ...(p.persona ? { persona: p.persona } : {}), pickedBy: id as AgentReviewer["id"], pickReason: p.reason };
        });
        r.agentHighest = highest + fresh.length;
        // Its picks sit just after it.
        const kept = panel.filter((a) => a.pickedBy !== id);
        kept.splice(kept.findIndex((a) => a.id === id) + 1, 0, ...fresh);
        r.agentReviewers = kept.map((a) =>
          a.id === id
            ? { ...a, picking: undefined, ranWith: model, planned: undefined, picks: { at: Date.now(), personas: picks.map((p) => p.persona), ...(general ? { general } : {}) } }
            : a,
        );
        r.panelSettled = true;
        nameAll(r);
      });
      await Promise.all(added.map((a) => startReviewer(ref, a.id, { mode: "builtin", model, ...(a.persona ? { persona: a.persona } : {}) }, mcpUrl)));
    } catch (err) {
      change(ref, (r) => {
        r.agentReviewers = (r.agentReviewers ?? []).map((a) =>
          a.id === id ? { ...a, picking: undefined, picks: { at: Date.now(), personas: [], error: (err as Error).message } } : a,
        );
      });
    }
  })();
}

// Starts every reviewer switched on that hasn't run, as "Start the panel"
// does - but your own agent, whose command only you can run.
export async function startPanel(ref: Ref, mcpUrl: string): Promise<void> {
  const model = modelName();
  for (const a of read(ref).agentReviewers ?? []) {
    if (a.off || a.ranWith || a.pickedBy || getAgentReview(ref.owner, ref.repo, ref.number, a.id)) continue;
    const setup = setupFrom(a, model);
    if (setup.mode === "external") continue;
    await startReviewer(ref, a.id, setup, mcpUrl).catch((err) => console.error(`[panel] ${a.id}: ${(err as Error).message}`));
  }
}
