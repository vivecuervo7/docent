import { database, getRecord, onRecordChange } from "../../storage/store.server.js";
import { persistent } from "../../storage/persistent.server.js";
import { roundView } from "../../storage/rounds.js";
import { externalReviewers, personas } from "../../storage/settings.server.js";
import { fetchReviewFiles } from "../../github/range.server.js";
import { parseFilePatch } from "../reading/diff/parse.js";
import type { AgentReviewer, FeedbackItem, PrFile, PrRecord, Severity } from "../../types.js";
import type { RoundStats, Stats } from "./stats.js";

// What reviewing has added up to, kept apart from the reviews themselves so
// it outlasts them: a review deleted leaves its rounds' figures here. Each
// round's figures are taken afresh whenever its review is saved, and read
// straight from here.

const db = persistent("stats-tables", () => {
  const opened = database();
  opened.exec(`
    CREATE TABLE IF NOT EXISTS round_stats (
      key TEXT NOT NULL,
      round INTEGER NOT NULL,
      stats TEXT NOT NULL,
      PRIMARY KEY (key, round)
    );
  `);
  return opened;
});

// Who raised a finding, as the stats group reviewers across PRs: their
// persona or external reviewer, by name and id, else Docent's general
// reviewer, or your own agent.
function reviewerOf(r: AgentReviewer | undefined): { name: string; persona?: string; external?: string } {
  if (!r) return { name: "Unknown" };
  const runs = r.ranWith ?? r.planned;
  if (runs === "external") return { name: "Your own agent" };
  const session = runs?.startsWith("session:") ? runs.slice(8) : runs?.startsWith("persona:") ? runs.slice(8) : null;
  if (session) return { name: externalReviewers.list().find((e) => e.id === session)?.name ?? "External reviewer", external: session };
  if (r.persona === "auto") return { name: "Auto" };
  const persona = r.persona ? personas.list().find((p) => p.id === r.persona) : undefined;
  return r.persona ? { name: persona?.name ?? "Persona", persona: r.persona } : { name: "General" };
}

const decided = (i: FeedbackItem) => !!i.decided;

// A reviewer as the stats tell reviewers apart across PRs.
const idOf = (who: { name: string; persona?: string; external?: string }) => who.persona ?? who.external ?? who.name;

const fileOf = (hunk: string) => hunk.slice(0, hunk.lastIndexOf("#"));

// A round's figures, from its review as it stands.
function roundStats(key: string, record: PrRecord, round: number): Omit<RoundStats, "sizes"> | null {
  const [owner, repo, number] = key.split("/");
  const notes = record.notes ?? [];
  const findings = Object.entries(record.feedback ?? {})
    .filter(([id]) => id.startsWith("agent-"))
    .flatMap(([id, draft]) => (draft?.items ?? []).map((item) => ({ reviewer: id, item })));
  // What you wrote: in your own threads, and asking about findings.
  const yours = [...notes, ...findings.map((f) => f.item)].flatMap((t) => (t.messages ?? []).filter((m) => m.role === "user"));
  const answers = [...notes.flatMap((n) => n.messages), ...findings.flatMap((f) => f.item.messages ?? [])].filter((m) => m.role === "assistant");
  const posted = record.review?.posted;
  const activity = yours.map((m) => m.at);
  if (posted) activity.push(posted.at);
  if (record.completedAt) activity.push(record.completedAt);
  if (!record.slices?.length && !activity.length) return null;

  const reviewers = new Map<string, RoundStats["reviewers"][number]>();
  const severities: Partial<Record<Severity, number>> = {};
  for (const { reviewer, item } of findings) {
    const who = reviewerOf(record.agentReviewers?.find((a) => a.id === reviewer));
    const name = who.name;
    const r = reviewers.get(name) ?? { ...who, raised: 0, kept: 0, skipped: 0, kickedBack: 0, filtered: 0 };
    r.raised++;
    // One left undecided counts as what it was left at, which is what's
    // posted: kept, unless the editor suggested skipping it.
    if (item.filtered) r.filtered++;
    else if (item.included) r.kept++;
    else {
      r.skipped++;
      // Skipped by you though neither its reviewer nor the editor suggested it.
      if (decided(item) && !item.setAside && !item.skipSuggested) r.kickedBack!++;
    }
    reviewers.set(name, r);
    if (item.severity && !item.filtered) severities[item.severity] = (severities[item.severity] ?? 0) + 1;
  }

  // Each finding the editor didn't filter out, with what became of it and
  // whose findings it grouped with as the same point.
  const shown = new Map(findings.filter((f) => !f.item.filtered).map((f) => [`${f.reviewer}/${f.item.id}`, f]));
  const leadOf = (key: string, item: FeedbackItem) =>
    item.joins && shown.has(`${item.joins.reviewer}/${item.joins.id}`) ? `${item.joins.reviewer}/${item.joins.id}` : key;
  const who = (reviewer: string) => idOf(reviewerOf(record.agentReviewers?.find((a) => a.id === reviewer)));
  const groups = new Map<string, Set<string>>();
  for (const [key, { reviewer, item }] of shown) {
    const lead = leadOf(key, item);
    groups.set(lead, (groups.get(lead) ?? new Set()).add(who(reviewer)));
  }
  const found = [...shown].map(([key, { reviewer, item }]) => {
    const by = who(reviewer);
    return {
      by,
      kept: item.included,
      kickedBack: decided(item) && !item.included && !item.setAside && !item.skipSuggested,
      with: [...groups.get(leadOf(key, item))!].filter((other) => other !== by),
    };
  });
  // Who reviewed this round, so overlap is only weighed between reviewers
  // that ran together.
  const ran = (record.agentReviewers ?? [])
    .filter((a) => a.persona !== "auto" && (a.lastRun || findings.some((f) => f.reviewer === a.id)))
    .map((a) => reviewerOf(a));

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
    // The files the round's slices cover, and how many each slice does.
    files: [...new Set((record.slices ?? []).flatMap((sl) => sl.hunks.map(fileOf)))],
    sliceFiles: (record.slices ?? []).map((sl) => new Set(sl.hunks.map(fileOf)).size),
    reviewers: [...reviewers.values()],
    severities,
    questions: yours.filter((m) => !m.comment && !m.conclusion).length,
    comments: yours.filter((m) => m.comment).length,
    conclusions: yours.filter((m) => m.conclusion).length,
    answers: answers.length,
    checks: Object.values(record.threadChecks ?? {}).filter((c) => c.verdict).length,
    counted: COUNTED,
    found,
    ran: [...new Map(ran.map((r) => [idOf(r), { id: idOf(r), ...r }])).values()],
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
    // Measured again, its last sizes kept meanwhile, when how it's counted changes.
    if ((sizes?.pr === undefined || before?.counted !== COUNTED) && figures.slices) measure(key, i === earlier ? undefined : i, i + 1);
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
  // Asked again when how rounds are counted changes.
  const id = `${key}#${round}@${COUNTED}`;
  if (measuring.asked.has(id)) return;
  measuring.asked.add(id);
  measuring.queue.push(async () => {
    const [owner, repo, number] = key.split("/");
    const [files, whole] = await Promise.all([
      fetchReviewFiles(owner, repo, number, roundIndex),
      fetchReviewFiles(owner, repo, number, roundIndex, { whole: true }),
    ]);
    const current = readRound(key, round);
    const { record: stored, version } = getRecord(key);
    const record = version ? (stored as unknown as PrRecord) : undefined;
    const slices = record ? (roundIndex === undefined ? record : roundView(record, roundIndex)).slices : null;
    // Counted as what's read is, so files shown without a patch don't count.
    const pr = sizesOf(whole, []).lines;
    if (current && slices) writeRound({ ...current, sizes: { ...sizesOf(files, slices), pr } });
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

// What a round's figures count, which goes up when that changes: rounds
// counted the old way are taken again once, from the reviews still kept.
const COUNTED = 7;

function fillPoints() {
  const missing = new Set(
    (db.prepare("SELECT key, stats FROM round_stats").all() as { key: string; stats: string }[])
      .filter((r) => (JSON.parse(r.stats) as RoundStats).counted !== COUNTED)
      .map((r) => r.key)
  );
  for (const key of missing) {
    const { record, version } = getRecord(key);
    if (version) saveRounds(key, record);
  }
}

// What a save or delete does, set afresh each time this module loads, so a
// watcher made by an earlier load still runs the latest code.
const hooks = persistent("stats-hooks", () => ({
  saved: (_key: string, _record: Record<string, unknown>) => {},
  deleted: (_key: string, _at: number) => {},
  restored: (_key: string, _at: number) => {},
}));
hooks.saved = (key, record) => {
  try {
    saveRounds(key, record);
  } catch (err) {
    console.error(`[stats] ${key}: ${(err as Error).message}`);
  }
};
// A review deleted keeps its figures, out of the way of a fresh review of
// the same PR, under when it went, and has them back if it's put back.
hooks.deleted = (key, at) => {
  db.prepare("UPDATE round_stats SET key = ? WHERE key = ?").run(`${key}@${at}`, key);
};
hooks.restored = (key, at) => {
  db.prepare("UPDATE round_stats SET key = ? WHERE key = ?").run(key, `${key}@${at}`);
};
persistent("stats-watcher-v2", () => {
  onRecordChange({
    saved: (key, record) => hooks.saved(key, record),
    deleted: (key, at) => hooks.deleted(key, at),
    restored: (key, at) => hooks.restored(key, at),
  });
  return true;
});
fillPoints();

export function readStats(): Stats {
  // A persona or external reviewer removed takes its figures with it.
  const persona = new Set(personas.list().map((p) => p.id));
  const external = new Set(externalReviewers.list().map((e) => e.id));
  const kept = (r: { persona?: string; external?: string }) => (!r.persona || persona.has(r.persona)) && (!r.external || external.has(r.external));
  const rounds = (db.prepare("SELECT stats FROM round_stats").all() as { stats: string }[]).map((r) => JSON.parse(r.stats) as RoundStats);
  // Their findings too, and whose they were grouped with.
  const removed = new Set(
    rounds.flatMap((r) => [...r.reviewers, ...(r.ran ?? [])].filter((v) => !kept(v)).map((v) => v.persona ?? v.external ?? v.name))
  );
  // Named as they're called now, so a rename carries back.
  const personaName = new Map(personas.list().map((p) => [p.id, p.name]));
  const externalName = new Map(externalReviewers.list().map((e) => [e.id, e.name]));
  const named = <T extends { name: string; persona?: string; external?: string }>(v: T): T => ({
    ...v,
    name: (v.persona && personaName.get(v.persona)) || (v.external && externalName.get(v.external)) || v.name,
  });
  return {
    rounds: rounds.map((r) => ({
      ...r,
      reviewers: r.reviewers.filter(kept).map(named),
      ...(r.found ? { found: r.found.filter((f) => !removed.has(f.by)).map((f) => ({ ...f, with: f.with.filter((id) => !removed.has(id)) })) } : {}),
      ...(r.ran ? { ran: r.ran.filter((v) => !removed.has(v.id)).map(named) } : {})
    }))
  };
}
