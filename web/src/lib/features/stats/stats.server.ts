import { database, listRecords, onRecordChange } from "../../storage/store.server.js";
import { persistent } from "../../storage/persistent.server.js";
import { roundView } from "../../storage/rounds.js";
import { externalReviewers, personas } from "../../storage/settings.server.js";
import { fetchReviewFiles } from "../../github/range.server.js";
import { parseFilePatch } from "../reading/diff/parse.js";
import type { AgentReviewer, FeedbackItem, PrFile, PrRecord, Severity } from "../../types.js";
import type { RoundStats, Stats } from "./stats.js";
import { tally, tallied } from "./tallies.server.js";

// What reviewing has added up to, kept apart from the reviews themselves so
// it outlasts them: a review deleted leaves its rounds' figures here. Each
// round's figures are taken afresh whenever its review is saved. It starts
// keeping them the first time the stats are asked for, from the reviews
// there are then.

const db = persistent("stats-tables", () => {
  const opened = database();
  opened.exec(`
    CREATE TABLE IF NOT EXISTS round_stats (
      key TEXT NOT NULL,
      round INTEGER NOT NULL,
      stats TEXT NOT NULL,
      PRIMARY KEY (key, round)
    );
    CREATE TABLE IF NOT EXISTS stats_meta (
      name TEXT PRIMARY KEY
    );
  `);
  return opened;
});

// Who raised a finding, as the stats group reviewers across PRs: their
// persona or external reviewer by name, else Docent's general reviewer, or
// your own agent.
function reviewerName(r: AgentReviewer | undefined): string {
  if (!r) return "Unknown";
  const runs = r.ranWith ?? r.planned;
  if (runs === "external") return "Your own agent";
  const session = runs?.startsWith("session:") ? runs.slice(8) : runs?.startsWith("persona:") ? runs.slice(8) : null;
  if (session) return externalReviewers.list().find((e) => e.id === session)?.name ?? "External reviewer";
  if (r.persona === "auto") return "Auto";
  return (r.persona && personas.list().find((p) => p.id === r.persona)?.name) || "General";
}

const decided = (i: FeedbackItem) => !!i.decided;

// A round's figures, from its review as it stands.
function roundStats(key: string, record: PrRecord, round: number): Omit<RoundStats, "sizes"> | null {
  const [owner, repo, number] = key.split("/");
  const notes = record.notes ?? [];
  const yours = notes.flatMap((n) => n.messages.filter((m) => m.role === "user"));
  const findings = Object.entries(record.feedback ?? {})
    .filter(([id]) => id.startsWith("agent-"))
    .flatMap(([id, draft]) => (draft?.items ?? []).map((item) => ({ reviewer: id, item })));
  const answers = [...notes.flatMap((n) => n.messages), ...findings.flatMap((f) => f.item.messages ?? [])].filter((m) => m.role === "assistant");
  const posted = record.review?.posted;
  const activity = [...yours.map((m) => m.at), ...findings.flatMap((f) => (f.item.messages ?? []).filter((m) => m.role === "user").map((m) => m.at))];
  if (posted) activity.push(posted.at);
  if (record.completedAt) activity.push(record.completedAt);
  if (!record.slices?.length && !activity.length) return null;

  const reviewers = new Map<string, RoundStats["reviewers"][number]>();
  const severities: Partial<Record<Severity, number>> = {};
  for (const { reviewer, item } of findings) {
    const name = reviewerName(record.agentReviewers?.find((a) => a.id === reviewer));
    const r = reviewers.get(name) ?? { name, raised: 0, kept: 0, skipped: 0, filtered: 0 };
    r.raised++;
    if (item.filtered) r.filtered++;
    else if (decided(item)) item.included ? r.kept++ : r.skipped++;
    reviewers.set(name, r);
    if (item.severity && !item.filtered) severities[item.severity] = (severities[item.severity] ?? 0) + 1;
  }

  // What went out: each posted comment, by whether it came from your
  // threads or the panel's findings.
  const yoursIds = new Set((record.feedback?.yours?.items ?? []).map((i) => i.id));
  const sent = posted ? (record.review?.comments ?? []).filter((c) => c.included) : [];
  return {
    key,
    pr: { owner, repo, number, title: record.title ?? `#${number}` },
    round,
    activity: activity.filter((at) => Number.isFinite(at)).sort((a, b) => a - b),
    ...(posted ? { posted: posted.at } : {}),
    ...(record.completedAt ? { completed: record.completedAt } : {}),
    slices: record.slices?.length ?? 0,
    reviewers: [...reviewers.values()],
    severities,
    questions: yours.filter((m) => !m.comment && !m.conclusion).length,
    comments: yours.filter((m) => m.comment).length,
    conclusions: yours.filter((m) => m.conclusion).length,
    answers: answers.length,
    checks: Object.values(record.threadChecks ?? {}).filter((c) => c.verdict).length,
    postedComments: {
      yours: sent.filter((c) => c.from.some((id) => yoursIds.has(id))).length,
      panel: sent.filter((c) => !c.from.some((id) => yoursIds.has(id))).length,
    },
  };
}

// Every round of a review, each saved over its last figures; how big it
// and its slices were is kept from before, and worked out once when it's
// missing.
function saveRounds(key: string, stored: Record<string, unknown>) {
  const record = stored as unknown as PrRecord;
  const earlier = record.rounds?.length ?? 0;
  for (let i = 0; i <= earlier; i++) {
    const view = i === earlier ? record : roundView(record, i);
    const figures = roundStats(key, view, i + 1);
    if (!figures) continue;
    const before = readRound(key, i + 1);
    const sizes = before?.sizes && before.slices === figures.slices ? before.sizes : undefined;
    writeRound({ ...figures, ...(sizes ? { sizes } : {}) });
    if (!sizes && figures.slices) measure(key, i === earlier ? undefined : i, i + 1);
  }
}

function readRound(key: string, round: number): RoundStats | undefined {
  const row = db.prepare("SELECT stats FROM round_stats WHERE key = ? AND round = ?").get(key, round) as { stats: string } | undefined;
  return row ? JSON.parse(row.stats) : undefined;
}

function writeRound(stats: RoundStats) {
  db.prepare("INSERT INTO round_stats (key, round, stats) VALUES (?, ?, ?) ON CONFLICT(key, round) DO UPDATE SET stats = excluded.stats").run(
    stats.key,
    stats.round,
    JSON.stringify(stats),
  );
}

// Lines a change touches, for the whole round and each slice: in a round of
// some commits, only those its commits changed.
function sizesOf(files: PrFile[], slices: { hunks: string[] }[]) {
  const inRound = (f: PrFile, kind: "add" | "del", line: number | undefined) =>
    !f.rangeLines || (line !== undefined && f.rangeLines[kind === "add" ? "new" : "old"].includes(line));
  const hunkLines = new Map<string, number>();
  for (const f of files) {
    for (const h of parseFilePatch(f.patch ?? "")) {
      if (f.inRange && !f.inRange.includes(h.index)) continue;
      const n = h.rows.filter((r) => (r.kind === "add" && inRound(f, "add", r.new)) || (r.kind === "del" && inRound(f, "del", r.old))).length;
      hunkLines.set(`${f.filename}#${h.index}`, n);
    }
  }
  return {
    lines: [...hunkLines.values()].reduce((a, b) => a + b, 0),
    slices: slices.map((s) => s.hunks.reduce((a, k) => a + (hunkLines.get(k) ?? 0), 0)),
  };
}

// Sizes are worked out from the round's files on GitHub, one round at a
// time, once each.
const measuring = persistent("stats-measuring", () => ({ queue: [] as (() => Promise<void>)[], busy: false, asked: new Set<string>() }));
function measure(key: string, roundIndex: number | undefined, round: number) {
  const id = `${key}#${round}`;
  if (measuring.asked.has(id)) return;
  measuring.asked.add(id);
  measuring.queue.push(async () => {
    const [owner, repo, number] = key.split("/");
    const files = await fetchReviewFiles(owner, repo, number, roundIndex);
    const current = readRound(key, round);
    const record = listRecords().find((r) => r.key === key)?.record as unknown as PrRecord | undefined;
    const slices = record ? (roundIndex === undefined ? record : roundView(record, roundIndex)).slices : null;
    if (current && slices) writeRound({ ...current, sizes: sizesOf(files, slices) });
  });
  void drain();
}
async function drain() {
  if (measuring.busy) return;
  measuring.busy = true;
  while (measuring.queue.length) {
    await measuring.queue.shift()!().catch(() => {});
  }
  measuring.busy = false;
}

// The model calls a review made before they were counted as they happened:
// each answer, draft, preparation and check, and Docent's own reviewers at
// about a call a slice. Once, when the stats are first set up.
function countEarlierCalls() {
  // Calls already counted as they happened aren't counted again.
  const since = tallied("call")[0] ?? Infinity;
  const count = (at: number) => at < since && tally("call", at);
  for (const { record: stored } of listRecords()) {
    const record = stored as unknown as PrRecord;
    const rounds = [...(record.rounds ?? []).map((_, i) => roundView(record, i)), record];
    for (const r of rounds) {
      const when = [
        ...(r.notes ?? []).flatMap((n) => n.messages.map((m) => m.at)),
        r.review?.posted?.at,
        r.completedAt,
      ].filter((x): x is number => typeof x === "number");
      const first = when.length ? Math.min(...when) : undefined;
      for (const n of r.notes ?? []) for (const m of n.messages) if (m.role === "assistant") count(m.at);
      for (const draft of Object.values(r.feedback ?? {}))
        for (const item of draft?.items ?? []) for (const m of item.messages ?? []) if (m.role === "assistant") count(m.at);
      if (r.feedback?.yours?.draftedAt) count(r.feedback.yours.draftedAt);
      if (r.review?.preparedAt) count(r.review.preparedAt);
      for (const c of Object.values(r.threadChecks ?? {})) if (c.verdict) count(c.at);
      if (r.summary && first) for (let i = 0; i < 4; i++) count(first);
      for (const a of r.agentReviewers ?? []) {
        const runs = a.ranWith;
        if (!a.lastRun || !runs || runs === "external" || runs.startsWith("session:") || runs.startsWith("persona:")) continue;
        const calls = (r.slices?.length ?? 0) + 1;
        for (let i = 0; i < calls; i++) count(a.lastRun.startedAt);
        if (a.picks?.at) count(a.picks.at);
      }
    }
  }
}

// Set up once: figures for every review already kept, and the calls they made.
function setUp() {
  const done = (name: string) => !!db.prepare("SELECT 1 FROM stats_meta WHERE name = ?").get(name);
  if (!done("calls")) {
    countEarlierCalls();
    db.prepare("INSERT INTO stats_meta (name) VALUES ('calls')").run();
  }
  for (const { key, record } of listRecords()) saveRounds(key, record);
}

persistent("stats-watch", () => {
  onRecordChange({
    saved: (key, record) => {
      try {
        saveRounds(key, record);
      } catch (err) {
        console.error(`[stats] ${key}: ${(err as Error).message}`);
      }
    },
    // A review deleted keeps its figures, out of the way of a fresh review
    // of the same PR.
    deleted: (key) => {
      db.prepare("UPDATE round_stats SET key = ? WHERE key = ?").run(`${key}@${Date.now()}`, key);
    },
  });
  setUp();
  return true;
});

export function readStats(): Stats {
  const rounds = (db.prepare("SELECT stats FROM round_stats").all() as { stats: string }[]).map((r) => JSON.parse(r.stats) as RoundStats);
  return { rounds, calls: tallied("call"), resolved: tallied("resolved") };
}
