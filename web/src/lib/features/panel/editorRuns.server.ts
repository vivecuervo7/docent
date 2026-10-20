import { editFindings, type Earlier, type Edit, type Editable } from "./editor.server.js";
import { getAgentReview } from "./agentReviews.server.js";
import { fetchReviewFiles } from "../../github/range.server.js";
import { changeRound, roundRecord } from "../../storage/rounds.server.js";
import { getRecord, keyFor } from "../../storage/store.server.js";
import { persistent } from "../../storage/persistent.server.js";
import { nearestHunk, parseFilePatch, type Hunk } from "../reading/diff/parse.js";
import { reviewerName } from "./findings.js";
import type { FeedbackItem, PrRecord, Slice } from "../../types.js";

// The panel's editor, run here as reviewers' findings come in, so they're
// checked whether or not a page is open. A PR's runs for a round go one
// after another, each seeing what the last one grouped, until nothing is
// ready. A finding it fails on is shown as it is.

type Item = FeedbackItem & { matched?: boolean };
type Waiting = { reviewer: string; item: Item; docents: boolean; slices: string[]; ready: boolean };

const chains = persistent("editor-runs.chains", () => new Map<string, Promise<void>>());

// Runs the editor over a round's findings that are ready for it, after any
// run already going.
export function editRound(owner: string, repo: string, number: string, round: number | undefined, mcpUrl: string): Promise<void> {
  const key = `${owner}/${repo}/${number}@${round ?? "latest"}`;
  const next = (chains.get(key) ?? Promise.resolve())
    .then(() => editNext(owner, repo, number, round, mcpUrl))
    .catch((err) => console.error(`[editor] ${key}: ${(err as Error).message}`));
  chains.set(key, next);
  return next;
}

const isDocents = (record: PrRecord, reviewer: string) => {
  const ranWith = record.agentReviewers?.find((a) => a.id === reviewer)?.ranWith;
  return !!ranWith && ranWith !== "external" && !ranWith.startsWith("session:");
};

async function editNext(owner: string, repo: string, number: string, round: number | undefined, mcpUrl: string): Promise<void> {
  const record = roundRecord(owner, repo, number, round) as unknown as PrRecord;
  const slices: Slice[] = record.slices ?? [];
  const panel = record.agentReviewers ?? [];
  const running = (reviewer: string) => getAgentReview(owner, repo, number, reviewer)?.status === "running";
  // The slices each of Docent's reviewers still running has finished.
  const finishedByRunning = panel
    .filter((a) => running(a.id) && isDocents(record, a.id))
    .map((a) => new Set(getAgentReview(owner, repo, number, a.id)?.progress?.finished ?? []));

  const unedited = Object.entries(record.feedback ?? {})
    .filter(([key]) => key.startsWith("agent-"))
    .flatMap(([reviewer, draft]) => (draft?.items ?? []).filter((i) => !i.edited && !i.editFailed).map((item) => ({ reviewer, item: item as Item })));
  if (!unedited.length) return;

  // The slices a finding is in: the one it was found in, else where its lines are.
  let hunks: Map<string, Hunk[]> | null = null;
  const slicesOf = async (item: Item): Promise<string[]> => {
    if (item.slice) return [item.slice];
    if (!item.path) return [];
    hunks ??= new Map((await fetchReviewFiles(owner, repo, number, round)).map((f) => [f.filename, parseFilePatch(f.patch ?? "")]));
    const inFile = hunks.get(item.path) ?? [];
    const nearest = item.start && nearestHunk(inFile, item.start);
    const keys = item.start ? (nearest ? [`${item.path}#${nearest.index}`] : []) : inFile.map((h) => `${item.path}#${h.index}`);
    return slices.filter((s) => s.hunks.some((k) => keys.includes(k))).map((s) => s.id);
  };

  // A slice's findings are ready once every Docent reviewer still running has
  // finished it (one about the whole PR, once none is running); anyone else's
  // once their review is over.
  const waiting: Waiting[] = await Promise.all(
    unedited.map(async ({ reviewer, item }) => {
      const docents = isDocents(record, reviewer);
      const inSlices = await slicesOf(item);
      const ready = docents
        ? finishedByRunning.every((finished) => inSlices.length > 0 && inSlices.every((s) => finished.has(s)))
        : !running(reviewer);
      return { reviewer, item, docents, slices: inSlices, ready };
    }),
  );
  const ready = waiting.filter((w) => w.ready);
  if (!ready.length) return;

  // A slice at a time, in order, for Docent's reviewers; everyone else's
  // together, first.
  const order = (w: Waiting) => (!w.docents ? -1 : w.slices.length ? slices.findIndex((s) => s.id === w.slices[0]) : slices.length);
  ready.sort((a, b) => order(a) - order(b));
  const first = ready[0];
  const batch = ready.filter((w) => w.docents === first.docents && (!w.docents || w.slices[0] === first.slices[0]));
  const shown = Object.entries(record.feedback ?? {})
    .filter(([key]) => key.startsWith("agent-"))
    .flatMap(([reviewer, draft]) => (draft?.items ?? []).filter((i) => i.edited && !i.filtered && !i.joins).map((item) => ({ reviewer, item: item as Item })));
  const where = (i: Item) => (i.path ? `${i.path}${i.start ? ` line ${i.start.line}` : ""}` : "the PR as a whole");
  const describe = ({ reviewer, item }: { reviewer: string; item: Item }): Editable => ({
    id: item.id,
    who: reviewerName(record, reviewer),
    location: where(item),
    body: item.body,
    ...(item.rationale ? { rationale: item.rationale } : {}),
    ...(item.severity ? { severity: item.severity } : {}),
    ...(item.setAside ? { setAside: item.setAside } : {}),
  });

  // What earlier rounds of this review raised and you decided, for the editor
  // to match new findings against: one you skipped there isn't asked again,
  // one you kept and that's back likely wasn't fixed.
  const total = ((getRecord(keyFor(owner, repo, number)).record as unknown as PrRecord).rounds?.length ?? 0) + 1;
  const thisRound = round === undefined ? total - 1 : round;
  const earlier: Earlier[] = [];
  for (let i = 0; i < thisRound; i++) {
    const before = roundRecord(owner, repo, number, i) as unknown as PrRecord;
    for (const [reviewer, draft] of Object.entries(before.feedback ?? {})) {
      if (!reviewer.startsWith("agent-")) continue;
      for (const item of draft?.items ?? []) {
        if (!item.decided || item.filtered || item.joins) continue;
        earlier.push({
          id: `r${i + 1}:${item.id}`,
          round: i + 1,
          decision: item.included ? "kept" : "skipped",
          who: reviewerName(before, reviewer),
          location: where(item),
          body: item.body,
        });
      }
    }
  }
  const earlierById = new Map(earlier.map((f) => [f.id, f]));

  let edits: Map<string, Edit>;
  try {
    edits = await editFindings(
      owner,
      repo,
      number,
      {
        ...(first.docents && first.slices[0] ? { slice: first.slices[0] } : {}),
        fresh: batch.map(describe),
        shown: shown.map(describe),
        ...(earlier.length ? { earlier } : {}),
        filter: first.docents,
        mcpUrl,
        round,
      },
      new AbortController().signal,
    );
  } catch (err) {
    console.error(`[editor] ${owner}/${repo}#${number}: ${(err as Error).message}`);
    settle(owner, repo, number, round, batch, () => ({ editFailed: true }));
    return editNext(owner, repo, number, round, mcpUrl);
  }

  // Following each finding's "same as" to the one its group gathers round:
  // one already shown, or else a new one.
  const reviewerOf = new Map([...shown, ...batch].map(({ reviewer, item }) => [item.id, reviewer]));
  const shownIds = new Set(shown.map(({ item }) => item.id));
  const rootOf = (id: string) => {
    const seen = new Set<string>();
    let at = id;
    while (!shownIds.has(at) && edits.get(at)?.sameAs && !seen.has(at)) {
      seen.add(at);
      at = edits.get(at)!.sameAs!;
    }
    return at;
  };
  const clusters = new Map<string, string[]>();
  for (const { item } of batch) {
    const root = rootOf(item.id);
    clusters.set(root, [...(clusters.get(root) ?? []), item.id]);
  }
  // A group gathers round the finding its repeats point at. If that one is
  // filtered out, its repeats make the same filtered point, and go with it.
  const outcome = new Map<string, Partial<Item>>();
  for (const [root, members] of clusters) {
    const rootFiltered = !shownIds.has(root) && edits.get(root)?.filtered;
    for (const id of members) {
      const e = edits.get(id);
      const checked: Partial<Item> = {
        ...(e?.checked ? { checked: e.checked } : {}),
        ...(e?.speculative ? { speculative: e.speculative } : {}),
        ...(e?.severity ? { severity: e.severity as Item["severity"] } : {}),
        ...(e?.disputed ? { disputed: e.disputed } : {}),
        ...(e?.onPr ? { onPr: e.onPr } : {}),
        ...(e?.impact ? { impact: e.impact } : {}),
        ...(e?.impactLevel ? { impactLevel: e.impactLevel as Item["impactLevel"] } : {}),
        ...(e?.checkedVerdict ? { checkedVerdict: e.checkedVerdict as Item["checkedVerdict"] } : {}),
        ...(e?.skip ? { skipSuggested: e.skip } : {}),
      };
      // The same point as one from an earlier round: skipped there, it's
      // filtered here; kept there, it's kept and said to be back.
      const before = e?.earlier ? earlierById.get(e.earlier) : undefined;
      if (before?.decision === "skipped" && !rootFiltered) {
        outcome.set(id, { filtered: `Skipped in round ${before.round}.` });
        continue;
      }
      if (before) checked.raisedBefore = before.round;
      if (rootFiltered) outcome.set(id, { filtered: e?.filtered ?? rootFiltered });
      else if (id !== root) outcome.set(id, { joins: { reviewer: reviewerOf.get(root)!, id: root }, ...checked });
      else outcome.set(id, checked);
    }
  }
  // In a round of some commits, a finding on lines it didn't change is
  // nudged, gently: a minor one or a nit starts out skipped; a major one or a
  // blocker stands, tagged as outside the round.
  if (record.range) {
    const files = await fetchReviewFiles(owner, repo, number, round);
    const inRound = (item: Item) => {
      if (!item.path) return true;
      const file = files.find((f) => f.filename === item.path);
      if (!file) return false;
      if (!item.start || !file.rangeLines) return true;
      const end = item.end ?? item.start;
      const lines = file.rangeLines[item.start.side];
      return lines.some((n) => n >= item.start!.line && n <= end.line);
    };
    for (const { item } of batch) {
      const o = outcome.get(item.id);
      if (!o || o.filtered || inRound(item)) continue;
      const severity = o.severity ?? item.severity;
      if (severity === "minor" || severity === "nit") {
        o.skipSuggested ??= `${severity === "nit" ? "A nit" : "Minor"}, and outside this round's changes.`;
      } else if (severity) o.outsideRound = true;
    }
  }
  settle(owner, repo, number, round, batch, (id) => ({ edited: true, ...outcome.get(id) }));
  return editNext(owner, repo, number, round, mcpUrl);
}

// Saves what the editor made of a batch, over whatever grouping its findings
// had before.
function settle(
  owner: string,
  repo: string,
  number: string,
  round: number | undefined,
  batch: { reviewer: string; item: Item }[],
  change: (id: string) => Partial<Item>,
) {
  const ids = new Set(batch.map(({ item }) => item.id));
  const reviewers = new Set(batch.map(({ reviewer }) => reviewer));
  changeRound(owner, repo, number, round, (stored) => {
    const record = stored as unknown as PrRecord;
    for (const reviewer of reviewers) {
      const draft = record.feedback?.[reviewer];
      if (!draft) continue;
      record.feedback[reviewer] = {
        ...draft,
        items: draft.items.map((i) => {
          if (!ids.has(i.id)) return i;
          const { joins: _j, filtered: _f, editFailed: _e, checked: _c, speculative: _s, disputed: _d, onPr: _o, impact: _i, impactLevel: _l, checkedVerdict: _v, raisedBefore: _r, outsideRound: _out, skipSuggested, matched: _m, ...rest } =
            i as Item;
          const next: Item = { ...rest, ...change(i.id) };
          // A suggested skip applies until the reviewer decides, and lifts
          // when a later edit no longer suggests it.
          if (!i.decided) {
            if (next.skipSuggested) next.included = false;
            else if (skipSuggested) next.included = true;
          }
          return next;
        }),
      };
    }
  });
}
