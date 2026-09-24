import { matchPath, useLocation, useNavigate } from "react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject, type UIEvent } from "react";
import { diffArrays } from "diff";
import { BookOpen, Check, CircleAlert, ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, Bot, Files, FlaskConical, Folder, Info, Lightbulb, Image as ImageIcon, ListChecks, Loader2, LogOut, MessagesSquare, Package, Send, SlidersHorizontal, Trash2, User, Wrench, type LucideIcon } from "lucide-react";
import {
  Decoration,
  Diff,
  getChangeKey,
  Hunk,
  markEdits,
  parseDiff,
  tokenize,
  type ChangeData,
  type DiffType,
  type HunkData,
} from "react-diff-view";
import "react-diff-view/style/index.css";
import refractor from "refractor";
import jsx from "refractor/lang/jsx.js";
import tsx from "refractor/lang/tsx.js";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  appendNoteMessage,
  deleteNote as persistDeleteNote,
  markNoteRead as persistNoteRead,
  deleteSavedPr,
  getPrRecord,
  listSavedPrs,
  markPrOpened,
  saveFeedback as persistFeedback,
  saveNote as persistNote,
  saveReviewDraft as persistReviewDraft,
  saveConversation as persistConversation,
  saveFileNotes as persistFileNotes,
  saveSlices as persistSlices,
  saveSummary as persistSummary,
  setHunksReviewed as persistReviewedHunks,
  type ConversationSummary,
  type FeedbackDraft,
  type FeedbackItem,
  type FileNote,
  type FeedbackKind,
  type LineRef,
  type Note,
  type ReviewComment,
  type ReviewDraft,
  type ReplyOutcome,
  type ReviewerConversation,
  type Slice,
  type PrSummary,
  type SavedPr,
} from "./prDb";
import {
  EXPAND_STEP,
  expandHunk,
  expansionFor,
  fileLines,
  gapAbove,
  gapBelow,
  shownHunks,
  type Expansion,
  type ShownHunk,
} from "./hunkExpansion";
import { changeKeys, changesBetween, matches, describeLines, diffLines, isUnread, lineRefFor, PIN_SIZE } from "./noteAnchors";
import { AgentFeedbackView, YourFeedbackView, type AgentReviewState, type DraftStatus } from "./feedbackViews";
import { PostReviewView, type ReviewCandidate, type ReviewPayload } from "./postReviewView";
import { Markdown } from "./markdown";
import { CommentIcon, FindingCount, FindingPanel, NoteCount, NotePanel, NotePin, OffscreenUnread } from "./notes";
import { plainText } from "./plainText";

// The bundled "common" language set covers most backend languages already;
// JSX/TSX aren't in it and are registered separately (each pulls in its own
// JS/TS grammar dependency automatically).
refractor.register(jsx);
refractor.register(tsx);

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  go: "go",
  py: "python",
  rb: "ruby",
  java: "java",
  kt: "kotlin",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  md: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "markup",
  htm: "markup",
  xml: "markup",
  sql: "sql",
  lua: "lua",
  r: "r",
  pl: "perl",
  ini: "ini",
};

function languageForFilename(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_LANGUAGE_MAP[ext] : undefined;
}

interface PrFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface PrMeta {
  title: string;
  body: string | null;
  htmlUrl: string;
}

interface Link {
  label: string;
  url: string;
  isImage: boolean;
}

const IMAGE_EXTENSION_RE = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i;
const CLAUDE_CODE_LINK_RE = /claude\.com\/claude-code/i;
const GITHUB_ATTACHMENT_RE = /^https:\/\/github\.com\/user-attachments\//;

// github.com/user-attachments images require an authenticated GitHub
// session to load, which a cross-origin <img> tag never has - route those
// through our own backend, which fetches them with `gh`'s auth instead.
function imageSrcFor(url: string): string {
  return GITHUB_ATTACHMENT_RE.test(url) ? `/api/attachment?url=${encodeURIComponent(url)}` : url;
}

// Order matters: <img> tags and markdown image syntax first (removing
// matched text as we go), so they don't also get picked up by the plain
// markdown-link or bare-URL passes that follow. Deduped by URL throughout.
function extractLinks(body: string | null): Link[] {
  if (!body) return [];

  const links: Link[] = [];
  const seen = new Set<string>();
  let remaining = body;

  const add = (label: string, url: string, isImage: boolean) => {
    if (seen.has(url) || CLAUDE_CODE_LINK_RE.test(url)) return;
    seen.add(url);
    links.push({ label, url, isImage });
  };

  for (const match of remaining.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) {
    const [full, url] = match;
    const alt = full.match(/\balt=["']([^"']*)["']/i)?.[1];
    add(alt || "Image", url, true);
    remaining = remaining.replace(full, "");
  }

  for (const match of remaining.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g)) {
    const [full, label, url] = match;
    add(label || "Image", url, true);
    remaining = remaining.replace(full, "");
  }

  for (const match of remaining.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)) {
    const [full, label, url] = match;
    add(label, url, IMAGE_EXTENSION_RE.test(url));
    remaining = remaining.replace(full, "");
  }

  for (const match of remaining.matchAll(/https?:\/\/[^\s)\]"'<>]+/g)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    add(url.replace(/^https?:\/\//, ""), url, IMAGE_EXTENSION_RE.test(url));
  }

  return links;
}

// Slices and the conversation don't depend on each other and run together;
// the summary waits for both so it can prefer them over a stale description,
// and the file notes, written per slice, run alongside it.
type PipelineStep = "slices" | "conversation" | "summary" | "notes";
type PipelineSteps = Record<PipelineStep, { status: "pending" | "active" | "done"; startedAt?: number }>;

// A background generation on the backend (see backend/src/generation.ts).
interface Generation {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  steps: PipelineSteps;
  results: {
    slices?: Slice[];
    conversation?: ConversationSummary;
    summary?: PrSummary;
    fileNotes?: Record<string, FileNote[]>;
  };
  error?: string;
}

function emptyGeneration(): Generation {
  return {
    id: "",
    status: "queued",
    steps: {
      slices: { status: "pending" },
      conversation: { status: "pending" },
      summary: { status: "pending" },
      notes: { status: "pending" },
    },
    results: {},
  };
}

function isGenerating(generation: Generation | null | undefined): boolean {
  return generation?.status === "queued" || generation?.status === "running";
}

function generationUrlFor(owner: string, repo: string, number: string): string {
  return `/api/pr/${owner}/${repo}/${number}/generation`;
}

interface ListedGeneration {
  owner: string;
  repo: string;
  number: string;
  generation: Generation;
}

const PIPELINE_STEPS: { step: PipelineStep; label: string }[] = [
  { step: "slices", label: "Breaking the PR into slices" },
  { step: "conversation", label: "Reading the review conversation" },
  { step: "summary", label: "Writing the summary" },
  { step: "notes", label: "Writing notes on tests and larger files" },
];

// Every hunk-addressable unit is keyed "filename#index"; files with no
// hunks to address individually (e.g. binary changes) fall back to a
// single "filename#file" key standing in for the whole file.
function fileHunkKeys(filename: string, hunkCount: number): string[] {
  if (hunkCount === 0) return [`${filename}#file`];
  return Array.from({ length: hunkCount }, (_, i) => `${filename}#${i}`);
}

function isFileReviewed(
  filename: string,
  hunkCount: number,
  reviewed: Record<string, boolean>,
): boolean {
  return fileHunkKeys(filename, hunkCount).every((k) => reviewed[k]);
}

function isSliceReviewed(slice: Slice, reviewed: Record<string, boolean>): boolean {
  return slice.hunks.length > 0 && slice.hunks.every((k) => reviewed[k]);
}

function isTestFile(filename: string): boolean {
  return (
    /\.(test|spec)\.[jt]sx?$/.test(filename) ||
    /(^|\/)(__tests__)\//.test(filename) ||
    /(^|\/)(tests?)\//.test(filename)
  );
}

function isGeneratedFile(filename: string): boolean {
  return (
    /\.snap$/.test(filename) ||
    /(^|\/)(generated|__generated__)\//.test(filename) ||
    /\.generated\./.test(filename) ||
    /package-lock\.json$/.test(filename) ||
    /(^|\/)(yarn|pnpm)-lock\.(json|yaml)$/.test(filename)
  );
}

// Core/foundational files first (smallest diffs, likely to establish
// vocabulary for the rest), then the meaty implementation, then tests,
// then generated/lockfile noise last.
function fileCategoryRank(filename: string): number {
  if (isGeneratedFile(filename)) return 2;
  if (isTestFile(filename)) return 1;
  return 0;
}

function orderFileGroups(
  byFile: Map<string, number[]>,
  files: PrFile[],
): [string, number[]][] {
  const sizeOf = (filename: string) => {
    const file = files.find((f) => f.filename === filename);
    return file ? file.additions + file.deletions : 0;
  };

  return [...byFile.entries()].sort(([aName], [bName]) => {
    const rankDiff = fileCategoryRank(aName) - fileCategoryRank(bName);
    return rankDiff !== 0 ? rankDiff : sizeOf(aName) - sizeOf(bName);
  });
}

function groupHunkRefsByFile(refs: string[]): Map<string, number[]> {
  const byFile = new Map<string, number[]>();
  for (const ref of refs) {
    const sep = ref.lastIndexOf("#");
    const filename = ref.slice(0, sep);
    const index = Number(ref.slice(sep + 1));
    if (Number.isNaN(index)) continue;
    if (!byFile.has(filename)) byFile.set(filename, []);
    byFile.get(filename)!.push(index);
  }
  return byFile;
}

function fileElementId(filename: string): string {
  return `file-${encodeURIComponent(filename)}`;
}

// Scrolls to an element that may not be rendered yet - a file that's still
// expanding, or a view that's still mounting - trying each frame for a while.
function scrollWhenReady(find: () => Element | null, block: ScrollLogicalPosition, then?: () => void) {
  let frames = 30;
  function attempt() {
    const el = find();
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block });
      then?.();
    } else if (frames-- > 0) {
      requestAnimationFrame(attempt);
    } else {
      then?.();
    }
  }
  requestAnimationFrame(attempt);
}

function scrollToNote(id: string, then?: () => void) {
  scrollWhenReady(() => document.querySelector(`[data-note-id="${id}"]`), "center", then);
}

interface FileTreeFolder {
  type: "folder";
  name: string;
  path: string;
  children: FileTreeEntry[];
}

interface FileTreeLeaf {
  type: "file";
  name: string;
  path: string;
  file: PrFile;
}

type FileTreeEntry = FileTreeFolder | FileTreeLeaf;

function sortTreeChildren(children: FileTreeEntry[]) {
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of children) {
    if (child.type === "folder") sortTreeChildren(child.children);
  }
}

function buildFileTree(files: PrFile[]): FileTreeFolder {
  const root: FileTreeFolder = { type: "folder", name: "", path: "", children: [] };

  for (const file of files) {
    const parts = file.filename.split("/");
    let current = root;
    let pathSoFar = "";

    parts.forEach((part, i) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const isLast = i === parts.length - 1;

      if (isLast) {
        current.children.push({ type: "file", name: part, path: pathSoFar, file });
        return;
      }

      let next = current.children.find(
        (c): c is FileTreeFolder => c.type === "folder" && c.name === part,
      );
      if (!next) {
        next = { type: "folder", name: part, path: pathSoFar, children: [] };
        current.children.push(next);
      }
      current = next;
    });
  }

  sortTreeChildren(root.children);
  return root;
}

function FileTreeNodes({
  entries,
  depth,
  isFileChecked,
  collapsedFolders,
  onToggleFolder,
  onToggleFile,
  onSelectFile,
  notesFor,
  onOpenUnread,
}: {
  entries: FileTreeEntry[];
  depth: number;
  isFileChecked: (filename: string) => boolean;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onToggleFile: (filename: string) => void;
  onSelectFile: (filename: string) => void;
  notesFor: (filename: string) => { count: number; unread: boolean; findings: number } | null;
  onOpenUnread: (filename: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const indent = 8 + depth * 16;

        if (entry.type === "folder") {
          const isCollapsed = collapsedFolders.has(entry.path);
          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() => onToggleFolder(entry.path)}
                style={{ paddingLeft: indent }}
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-3 text-left text-sm whitespace-nowrap text-muted-foreground hover:bg-muted"
              >
                {isCollapsed ? (
                  <ChevronRight className="size-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0" />
                )}
                <Folder className="size-3.5 shrink-0" />
                <span>{entry.name}</span>
              </button>
              {!isCollapsed && (
                <FileTreeNodes
                  entries={entry.children}
                  depth={depth + 1}
                  isFileChecked={isFileChecked}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  onToggleFile={onToggleFile}
                  onSelectFile={onSelectFile}
                  notesFor={notesFor}
                  onOpenUnread={onOpenUnread}
                />
              )}
            </div>
          );
        }

        const fileNotes = notesFor(entry.file.filename);
        return (
          <div
            key={entry.path}
            role="button"
            tabIndex={0}
            onClick={() => onSelectFile(entry.file.filename)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSelectFile(entry.file.filename);
            }}
            title={entry.file.filename}
            style={{ paddingLeft: indent }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 text-sm whitespace-nowrap hover:bg-muted"
          >
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isFileChecked(entry.file.filename)}
                onCheckedChange={() => onToggleFile(entry.file.filename)}
              />
            </span>
            <span>{entry.name}</span>
            {fileNotes && fileNotes.count > 0 && (
              <NoteCount
                count={fileNotes.count}
                unread={fileNotes.unread}
                ring="ring-sidebar"
                onClick={fileNotes.unread ? () => onOpenUnread(entry.file.filename) : undefined}
              />
            )}
            {fileNotes && <FindingCount count={fileNotes.findings} />}
          </div>
        );
      })}
    </>
  );
}

function FileTree({
  files,
  isFileChecked,
  onToggleFile,
  onSelectFile,
  notesFor,
  onOpenUnread,
}: {
  files: PrFile[];
  isFileChecked: (filename: string) => boolean;
  onToggleFile: (filename: string) => void;
  onSelectFile: (filename: string) => void;
  notesFor: (filename: string) => { count: number; unread: boolean; findings: number } | null;
  onOpenUnread: (filename: string) => void;
}) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const tree = buildFileTree(files);

  function toggleFolder(path: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <div className="flex w-max min-w-full flex-col gap-0.5">
        <FileTreeNodes
          entries={tree.children}
          depth={0}
          isFileChecked={isFileChecked}
          collapsedFolders={collapsedFolders}
          onToggleFolder={toggleFolder}
          onToggleFile={onToggleFile}
          onSelectFile={onSelectFile}
          notesFor={notesFor}
          onOpenUnread={onOpenUnread}
        />
      </div>
    </div>
  );
}

function buildDiffText(file: PrFile): string {
  const oldName = file.previous_filename ?? file.filename;
  const oldPath = file.status === "added" ? "/dev/null" : `a/${oldName}`;
  const newPath = file.status === "removed" ? "/dev/null" : `b/${file.filename}`;
  return [
    `diff --git a/${oldName} b/${file.filename}`,
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    file.patch ?? "",
  ].join("\n");
}

function countFileHunks(file: PrFile): number {
  if (!file.patch) return 0;
  try {
    const [parsed] = parseDiff(buildDiffText(file));
    return parsed?.hunks?.length ?? 0;
  } catch {
    return 0;
  }
}

interface LineEntry {
  content: string;
  lineNumber: number;
}

function normalizeForWhitespaceCompare(line: string): string {
  return line.replace(/\s+/g, "");
}

// Approximates git's "ignore whitespace" from the patch alone: realigns each
// hunk's full old/new line sequences with a whitespace-insensitive LCS diff
// (rather than just pairing up adjacent delete/insert blocks), so a line
// that only moved position or got reformatted shows as unchanged context —
// the same shape GitHub's own "hide whitespace" produces by re-diffing,
// not just filtering matching pairs.
function collapseWhitespaceOnlyChanges(hunks: HunkData[]): HunkData[] {
  return hunks.map((hunk) => {
    const oldEntries: LineEntry[] = [];
    const newEntries: LineEntry[] = [];

    for (const c of hunk.changes) {
      if (c.type === "delete") {
        oldEntries.push({ content: c.content, lineNumber: c.lineNumber });
      } else if (c.type === "insert") {
        newEntries.push({ content: c.content, lineNumber: c.lineNumber });
      } else {
        oldEntries.push({ content: c.content, lineNumber: c.oldLineNumber });
        newEntries.push({ content: c.content, lineNumber: c.newLineNumber });
      }
    }

    const groups = diffArrays(oldEntries, newEntries, {
      comparator: (a, b) =>
        normalizeForWhitespaceCompare(a.content) === normalizeForWhitespaceCompare(b.content),
    });

    const changes: ChangeData[] = [];
    let oldIdx = 0;

    for (const group of groups) {
      if (group.removed) {
        for (const entry of group.value) {
          changes.push({ type: "delete", isDelete: true, content: entry.content, lineNumber: entry.lineNumber });
        }
        oldIdx += group.value.length;
      } else if (group.added) {
        for (const entry of group.value) {
          changes.push({ type: "insert", isInsert: true, content: entry.content, lineNumber: entry.lineNumber });
        }
      } else {
        // jsdiff gives the new-side entry for a matched-but-non-identical pair;
        // pair it with the corresponding old entry via the running old index.
        group.value.forEach((newEntry, k) => {
          const oldEntry = oldEntries[oldIdx + k];
          changes.push({
            type: "normal",
            isNormal: true,
            content: newEntry.content,
            oldLineNumber: oldEntry.lineNumber,
            newLineNumber: newEntry.lineNumber,
          });
        });
        oldIdx += group.value.length;
      }
    }

    return { ...hunk, changes };
  });
}

// Shared by the full per-file view and the single-slice view: parses a
// file's patch into hunks, expands them with any unchanged lines the reviewer
// asked for (or that notes are on), lazily fetches the old file, and
// tokenizes. `enabled` gates the (relatively expensive) fetch + tokenize pass
// so a collapsed file in the full list skips both until expanded.
function useDiffRender(file: PrFile, hideWhitespace: boolean, prRef: PrRef, enabled: boolean, notes: Note[]) {
  const { parsed, diffType } = useMemo((): { parsed?: HunkData[]; diffType: DiffType } => {
    if (!file.patch) return { parsed: undefined, diffType: "modify" };
    try {
      const [parsedFile] = parseDiff(buildDiffText(file));
      let hunks = parsedFile?.hunks;
      if (hunks && hideWhitespace) hunks = collapseWhitespaceOnlyChanges(hunks);
      return { parsed: hunks, diffType: (parsedFile?.type as DiffType) ?? "modify" };
    } catch {
      return { parsed: undefined, diffType: "modify" };
    }
  }, [file, hideWhitespace]);

  const language = useMemo(() => languageForFilename(file.filename), [file.filename]);

  // The whole old file: highlighting context, and the unchanged lines that
  // expanding shows (they read the same in the new file). Fetched once the
  // file is on screen.
  const [oldContent, setOldContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !parsed || file.status === "added") return;
    if (oldContent !== undefined) return;

    let cancelled = false;
    const path = file.previous_filename ?? file.filename;

    fetch(
      `/api/pr/${prRef.owner}/${prRef.repo}/${prRef.number}/old-content?path=${encodeURIComponent(path)}`,
    )
      .then((res) => (res.ok ? res.json() : { content: null }))
      .then((data: { content: string | null }) => {
        if (!cancelled && data.content) setOldContent(data.content);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [enabled, parsed, file, prRef, oldContent]);

  const oldLines = useMemo(() => (oldContent === undefined ? null : fileLines(oldContent)), [oldContent]);
  const [requested, setRequested] = useState<Record<number, Expansion>>({});

  // What's actually shown: the lines asked for, plus any a note needs, kept
  // within each gap so neighbouring hunks never overlap.
  const expansion = useMemo((): Expansion[] => {
    if (!parsed || !oldLines) return [];
    const wanted = parsed.map((_, i) => ({ up: requested[i]?.up ?? 0, down: requested[i]?.down ?? 0 }));
    for (const note of notes) {
      const hunk = parsed[note.hunk];
      if (!hunk || note.path !== file.filename) continue;
      const needed = expansionFor(hunk, note.start, note.end);
      wanted[note.hunk] = {
        up: Math.max(wanted[note.hunk].up, needed.up),
        down: Math.max(wanted[note.hunk].down, needed.down),
      };
    }
    const shown: Expansion[] = [];
    parsed.forEach((_, i) => {
      const up = Math.min(wanted[i].up, gapAbove(parsed, i) - (shown[i - 1]?.down ?? 0));
      const down = Math.min(wanted[i].down, gapBelow(parsed, i, oldLines.length));
      shown.push({ up: Math.max(0, up), down: Math.max(0, down) });
    });
    return shown;
  }, [parsed, oldLines, requested, notes, file.filename]);

  const hunks = useMemo(
    () => (parsed && oldLines ? parsed.map((h, i) => expandHunk(h, expansion[i], oldLines)) : parsed),
    [parsed, oldLines, expansion],
  );

  const expander = useMemo(() => {
    if (!parsed || !oldLines) return null;
    return {
      above: (i: number) => gapAbove(parsed, i) - expansion[i].up - (expansion[i - 1]?.down ?? 0),
      below: (i: number) =>
        gapBelow(parsed, i, oldLines.length) - expansion[i].down - (expansion[i + 1]?.up ?? 0),
      expand: (i: number, direction: "up" | "down", count: number) =>
        // Grows from what's shown now, which may be more than was asked for
        // when a note needed extra lines.
        setRequested((prev) => ({
          ...prev,
          [i]: { up: prev[i]?.up ?? 0, down: prev[i]?.down ?? 0, [direction]: expansion[i][direction] + count },
        })),
    };
  }, [parsed, oldLines, expansion]);

  const tokens = useMemo(() => {
    if (!hunks || !enabled) return undefined;
    try {
      return language
        ? tokenize(hunks, {
            highlight: true,
            refractor,
            language,
            oldSource: oldContent,
            enhancers: [markEdits(hunks, { type: "block" })],
          })
        : tokenize(hunks, {
            highlight: false,
            enhancers: [markEdits(hunks, { type: "block" })],
          });
    } catch {
      return undefined;
    }
  }, [hunks, enabled, language, oldContent]);

  return { hunks, diffType, tokens, expander };
}

type Expander = NonNullable<ReturnType<typeof useDiffRender>["expander"]>;

// How many lines above a comment's own to show, as GitHub does.
const COMMENT_CONTEXT_LINES = 3;
// A comment on more lines than this shows only the ends of its range, with
// the middle folded away until asked for.
const COMMENT_LONG_RANGE = 10;
const COMMENT_RANGE_ENDS = 3;

// The snippet of diff a feedback comment sits on: its lines, highlighted,
// with a few above for context - kept within the hunk they start in.
function FeedbackContext({
  file,
  start,
  end,
  hideWhitespace,
}: {
  file: PrFile;
  start: LineRef;
  end: LineRef;
  hideWhitespace: boolean;
}) {
  const snippet = useMemo(() => {
    if (!file.patch) return null;
    try {
      const [parsed] = parseDiff(buildDiffText(file));
      let hunks = parsed?.hunks ?? [];
      if (hideWhitespace) hunks = collapseWhitespaceOnlyChanges(hunks);
      const flat = hunks.flatMap((hunk, h) => hunk.changes.map((change) => ({ change, h })));
      const from = flat.findIndex(({ change }) => matches(change, start));
      if (from < 0) return null;
      const found = flat.findIndex(({ change }, i) => i >= from && matches(change, end));
      const to = found < 0 ? from : found;
      const firstInHunk = flat.findIndex(({ h }) => h === flat[from].h);
      const shown = flat.slice(Math.max(firstInHunk, from - COMMENT_CONTEXT_LINES), to + 1).map(({ change }) => change);
      const hunk: HunkData = { ...hunks[flat[from].h], changes: shown };
      const rangeLength = to - from + 1;
      const hidden = rangeLength > COMMENT_LONG_RANGE ? rangeLength - 2 * COMMENT_RANGE_ENDS : 0;
      const language = languageForFilename(file.filename);
      let tokens;
      try {
        const enhancers = [markEdits([hunk], { type: "block" })];
        tokens = language
          ? tokenize([hunk], { highlight: true, refractor, language, enhancers })
          : tokenize([hunk], { highlight: false, enhancers });
      } catch {
        tokens = undefined;
      }
      // The folded version: context and the range's first lines, then its
      // last lines. Split by change count, from the end of `shown`.
      const tailStart = shown.length - COMMENT_RANGE_ENDS;
      const folded = hidden
        ? [
            { ...hunk, changes: shown.slice(0, tailStart - hidden) },
            { ...hunk, changes: shown.slice(tailStart) },
          ]
        : null;
      return {
        hunk,
        folded,
        hidden,
        tokens,
        selected: changeKeys(flat.slice(from, to + 1).map(({ change }) => change)),
        diffType: (parsed?.type as DiffType) ?? "modify",
      };
    } catch {
      return null;
    }
  }, [file, start, end, hideWhitespace]);
  const [unfolded, setUnfolded] = useState(false);

  if (!snippet) return null;
  const folded = snippet.folded && !unfolded ? snippet.folded : null;
  return (
    // A shade darker than the card around it, as GitHub sets code apart.
    <div className="feedback-snippet scrollbar-thin overflow-x-auto border-t bg-background text-xs">
      <Diff
        viewType="unified"
        diffType={snippet.diffType}
        hunks={folded ?? [snippet.hunk]}
        tokens={snippet.tokens}
        selectedChanges={snippet.selected}
      >
        {() =>
          folded
            ? [
                <Hunk key="head" hunk={folded[0]} />,
                <Decoration key="fold">
                  <button
                    type="button"
                    onClick={() => setUnfolded(true)}
                    className="flex w-full items-center gap-2 bg-[rgba(56,139,253,0.08)] px-4 py-1.5 text-left font-mono text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronsUpDown className="size-3.5" />
                    Show {snippet.hidden} more lines
                  </button>
                </Decoration>,
                <Hunk key="tail" hunk={folded[1]} />,
              ]
            : [<Hunk key="snippet" hunk={snippet.hunk} />]
        }
      </Diff>
    </div>
  );
}

// GitHub-style controls for showing unchanged lines: in a hunk's header for
// the gap above it, and after a hunk for the gap below it when the next hunk
// isn't shown here. ↓ grows the hunk above the gap, ↑ the one below it.
function HunkExpanders({
  expander,
  index,
  where,
  previousShown,
}: {
  expander: Expander | null;
  index: number;
  where: "above" | "below";
  previousShown?: boolean;
}) {
  if (!expander) return null;
  const remaining = where === "above" ? expander.above(index) : expander.below(index);
  if (remaining <= 0) return null;
  const button = (label: string, Icon: LucideIcon, onClick: () => void) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-reviewed/20 hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
  if (remaining <= EXPAND_STEP) {
    return button(`Show ${remaining} hidden ${remaining === 1 ? "line" : "lines"}`, ChevronsUpDown, () =>
      expander.expand(index, where === "above" ? "up" : "down", remaining),
    );
  }
  const more = `Show ${EXPAND_STEP} more lines`;
  if (where === "below") return button(more, ChevronDown, () => expander.expand(index, "down", EXPAND_STEP));
  return (
    <>
      {previousShown && button(more, ChevronDown, () => expander.expand(index - 1, "down", EXPAND_STEP))}
      {button(more, ChevronUp, () => expander.expand(index, "up", EXPAND_STEP))}
    </>
  );
}

interface NoteStatus {
  pending?: boolean;
  error?: string;
}

type NoteAnchor = Pick<Note, "path" | "hunk" | "start" | "end" | "code">;

interface NoteControls {
  status: Record<string, NoteStatus>;
  // Returns the new note's id.
  create: (anchor: NoteAnchor, text: string) => string;
  send: (id: string, text: string) => void;
  retry: (id: string) => void;
  remove: (id: string) => void;
  markRead: (id: string) => void;
}

const NO_NOTES: Note[] = [];
const NO_FINDINGS: FeedbackItem[] = [];
// Pins for agent findings are keyed apart from the reviewer's notes.
const FINDING_PIN = "finding:";
const NO_FILE_NOTES: FileNote[] = [];

// A file's note, at the top of its card so it's there even when the file is
// collapsed: what a test file tests, or what a large change amounts to.
function FileNoteBlock({ note }: { note: FileNote }) {
  const tests = note.kind === "tests";
  return (
    <div className="flex flex-col gap-2 border-b bg-background px-4 py-3">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {tests ? <FlaskConical className="size-3.5" /> : <Info className="size-3.5" />}
        {tests ? "What's tested" : "About these changes"}
      </span>
      <Markdown text={note.note} small />
      {note.quality && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium">Test quality:</span> {note.quality}
        </p>
      )}
    </div>
  );
}

// Where a drafted comment sits: on the lines of the threads it came from
// when they're all in one file (spanning them if there are several), and on
// the PR as a whole otherwise.
function placeFeedback(sources: Note[]): Pick<FeedbackItem, "path" | "start" | "end" | "noteIds"> {
  const noteIds = sources.map((n) => n.id);
  const paths = new Set(sources.map((n) => n.path));
  if (paths.size !== 1) return { noteIds };
  const ordered = [...sources].sort((a, b) => a.hunk - b.hunk || a.start.line - b.start.line);
  const last = [...sources].sort((a, b) => b.hunk - a.hunk || b.end.line - a.end.line)[0];
  return { path: ordered[0].path, start: ordered[0].start, end: last.end, noteIds };
}
const NO_KEYS: string[] = [];

// A file picked in the sidebar, for the view to expand - and, when the pick
// was an unread reply, the note to open. Cleared once it's been scrolled to.
// An agent review as the backend returns it.
interface AgentReviewBody extends Omit<AgentReviewState, "findingCount"> {
  id: string;
  findings: {
    id: string;
    path?: string;
    startLine?: number;
    endLine?: number;
    body: string;
    rationale?: string;
  }[];
}

interface RevealedFile {
  filename: string;
  noteId?: string;
  at: number;
}

// The pin for a selection that doesn't have a note yet.
const DRAFT_PIN = "draft";

// What one file's diff needs from the view around it to show notes.
interface FileNoteProps {
  notes: Note[];
  // The rows being selected in this file, or just selected when draftOpen.
  selectionKeys: string[] | null;
  draftOpen: boolean;
  openNoteId: string | null;
  noteControls: NoteControls;
  onOpenNote: (id: string | null) => void;
  onCloseDraft: () => void;
  onCreateNote: (anchor: NoteAnchor, text: string) => void;
  unsent: Record<string, string>;
  onUnsentChange: (id: string, text: string) => void;
  // Agent findings on this file's lines, pinned beside the reviewer's threads.
  findings: FeedbackItem[];
  onToggleFinding: (id: string) => void;
}

// A scrolling list of file diffs that notes can be made on: ⌥-drag draws a
// rectangle that snaps to the lines it covers, and letting go opens a panel
// to ask or comment about them. At most one panel is open at a time.
function useNoteSelection(
  notes: Note[],
  noteControls: NoteControls,
  reveal: RevealedFile | null,
  findings: FeedbackItem[],
  onToggleFinding: (id: string) => void,
) {
  const notesByFile = useMemo(() => {
    const grouped = new Map<string, Note[]>();
    for (const note of notes) grouped.set(note.path, [...(grouped.get(note.path) ?? []), note]);
    return grouped;
  }, [notes]);
  const findingsByFile = useMemo(() => {
    const grouped = new Map<string, FeedbackItem[]>();
    for (const finding of findings) {
      if (finding.path) grouped.set(finding.path, [...(grouped.get(finding.path) ?? []), finding]);
    }
    return grouped;
  }, [findings]);

  const contentRef = useRef<HTMLDivElement>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [selection, setSelection] = useState<{ path: string; keys: string[]; done: boolean } | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  // Typed but not yet sent, by note id (or DRAFT_PIN for a new selection).
  const [unsent, setUnsent] = useState<Record<string, string>>({});

  const [seenReveal, setSeenReveal] = useState(0);
  if (reveal && reveal.at !== seenReveal) {
    setSeenReveal(reveal.at);
    if (reveal.noteId) {
      setSelection(null);
      setOpenNoteId(reveal.noteId);
    }
  }

  function startSelecting(e: ReactPointerEvent<HTMLDivElement>) {
    const content = contentRef.current;
    if (!e.altKey || e.button !== 0 || !content) return;
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    let latest: { path: string; keys: string[] } | null = null;
    function onMove(ev: PointerEvent) {
      // A plain ⌥-click isn't a selection.
      if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      dragging = true;
      const rect = {
        left: Math.min(x0, ev.clientX),
        top: Math.min(y0, ev.clientY),
        right: Math.max(x0, ev.clientX),
        bottom: Math.max(y0, ev.clientY),
      };
      setDragRect({ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
      latest = rowsInRect(content!, rect);
      setSelection(latest && { ...latest, done: false });
      setOpenNoteId(null);
      setUnsent((prev) => ({ ...prev, [DRAFT_PIN]: "" }));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      setDragRect(null);
      if (dragging) setSelection(latest && { ...latest, done: true });
    }
    document.body.style.cursor = "crosshair";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    if (!openNoteId && !selection) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenNoteId(null);
      setSelection(null);
    }
    // Clicking away closes the panel too. A note keeps anything typed for
    // when it's reopened; a new selection with text typed stays open, since
    // closing it would lose the selection. ⌥-drag makes its own selection.
    function onPointerDown(e: PointerEvent) {
      if (e.altKey || (e.target as Element).closest("[data-note-layer]")) return;
      if (selection?.done && unsent[DRAFT_PIN]?.trim()) return;
      setOpenNoteId(null);
      setSelection(null);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openNoteId, selection, unsent]);

  function fileNoteProps(filename: string): FileNoteProps {
    return {
      notes: notesByFile.get(filename) ?? NO_NOTES,
      selectionKeys: selection?.path === filename ? selection.keys : null,
      draftOpen: !!selection?.done,
      openNoteId,
      noteControls,
      onOpenNote: (id) => {
        setSelection(null);
        setOpenNoteId(id);
      },
      onCloseDraft: () => setSelection(null),
      onCreateNote: (anchor, text) => {
        setSelection(null);
        setOpenNoteId(noteControls.create(anchor, text));
      },
      unsent,
      onUnsentChange: (id, text) => setUnsent((prev) => ({ ...prev, [id]: text })),
      findings: findingsByFile.get(filename) ?? NO_FINDINGS,
      onToggleFinding,
    };
  }

  const hint = (
    <span className="text-xs text-muted-foreground">
      <kbd className="rounded border px-1 font-mono text-[11px]">⌥</kbd> drag over code to ask or comment
    </span>
  );

  const dragOverlay = dragRect && (
    <div
      aria-hidden
      style={dragRect}
      className="pointer-events-none fixed z-40 rounded-sm border-[1.5px] border-dashed border-[rgba(145,152,161,0.6)]"
    />
  );

  return { contentRef, startSelecting, fileNoteProps, hint, dragOverlay };
}

// The nearest unread replies scrolled out of view above and below, pointed
// at from the pins' margin. A reply in a collapsed file has no pin, so its
// file stands in for it.
function useOffscreenUnread(
  scrollerRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  unread: Note[],
  onGoTo: (note: Note) => void,
) {
  const [state, setState] = useState<{
    above?: Note;
    below?: Note;
    left: number;
    top: number;
    bottom: number;
  } | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    let frame = 0;
    function measure() {
      frame = 0;
      const view = scroller!.getBoundingClientRect();
      let above: { note: Note; at: number } | undefined;
      let below: { note: Note; at: number } | undefined;
      for (const note of unread) {
        const el =
          document.querySelector(`[data-note-id="${note.id}"]`) ??
          content!.querySelector(`[data-note-path="${CSS.escape(note.path)}"]`);
        if (!el) continue;
        const box = el.getBoundingClientRect();
        if (box.bottom < view.top && (!above || box.bottom > above.at)) above = { note, at: box.bottom };
        if (box.top > view.bottom && (!below || box.top < below.at)) below = { note, at: box.top };
      }
      const next = above || below
        ? { above: above?.note, below: below?.note, left: content!.getBoundingClientRect().right + 5, top: view.top + 12, bottom: view.bottom - 12 }
        : null;
      setState((prev) =>
        prev?.above === next?.above && prev?.below === next?.below && prev?.left === next?.left &&
        prev?.top === next?.top && prev?.bottom === next?.bottom
          ? prev
          : next,
      );
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    measure();
    scroller.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(content);
    return () => {
      scroller.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollerRef, contentRef, unread]);

  if (!state) return null;
  const width = PIN_SIZE + 6;
  return (
    <>
      {state.above && (
        <OffscreenUnread
          direction="up"
          style={{ left: state.left, top: state.top, width }}
          onClick={() => onGoTo(state.above!)}
        />
      )}
      {state.below && (
        <OffscreenUnread
          direction="down"
          style={{ left: state.left, top: state.bottom, width, transform: "translateY(-100%)" }}
          onClick={() => onGoTo(state.below!)}
        />
      )}
    </>
  );
}

// The selected changes and the hunk they're anchored to: the one the
// selection starts in, when a joined block spans several.
function selectionIn(displayed: ShownHunk[], keys: string[] | null) {
  if (!keys?.length) return null;
  const wanted = new Set(keys);
  for (const block of displayed) {
    const changes = block.hunk.changes.filter((c) => wanted.has(getChangeKey(c)));
    if (changes.length === 0) continue;
    const first = getChangeKey(changes[0]);
    const part = block.parts.findIndex((p) => p.changes.some((c) => getChangeKey(c) === first));
    return { hunk: block.indices[Math.max(0, part)], changes };
  }
  return null;
}

// Notes on one file's diff: pins in the right margin level with the lines
// they're about, an outline around the selected lines, and the open panel.
// The caller puts wrapperRef and data-note-path on a relative element around
// the file, passes selectedChanges to its Diff, and renders overlay inside.
function useFileNotes(
  file: PrFile,
  displayed: ShownHunk[],
  {
    notes,
    selectionKeys,
    draftOpen,
    openNoteId,
    noteControls,
    onOpenNote,
    onCloseDraft,
    onCreateNote,
    unsent,
    onUnsentChange,
    findings,
    onToggleFinding,
  }: FileNoteProps,
  collapsed: boolean,
  tokens: unknown,
) {
  const selection = useMemo(() => selectionIn(displayed, selectionKeys), [selectionKeys, displayed]);

  const placedNotes = useMemo(
    () =>
      notes.flatMap((note) => {
        const shown = displayed.find((d) => d.indices.includes(note.hunk));
        const changes = shown ? changesBetween(shown.hunk, note.start, note.end) : [];
        return changes.length > 0 ? [{ note, keys: changeKeys(changes) }] : [];
      }),
    [notes, displayed],
  );

  // Findings sit on lines in the diff, so they're placed by their lines
  // alone, in whichever shown block has them.
  const placedFindings = useMemo(
    () =>
      findings.flatMap((finding) => {
        const { start, end } = finding;
        if (!start || !end) return [];
        for (const block of displayed) {
          const changes = changesBetween(block.hunk, start, end);
          if (changes.length > 0) return [{ id: `${FINDING_PIN}${finding.id}`, finding, keys: changeKeys(changes) }];
        }
        return [];
      }),
    [findings, displayed],
  );

  // Everything with a pin: the reviewer's notes and the agent's findings.
  const placedMarks = useMemo(
    () => [...placedNotes.map((p) => ({ id: p.note.id, keys: p.keys })), ...placedFindings.map((p) => ({ id: p.id, keys: p.keys }))],
    [placedNotes, placedFindings],
  );

  const openMark = placedMarks.find((p) => p.id === openNoteId);
  const selectedChanges = useMemo(
    () => (selection ? changeKeys(selection.changes) : (openMark?.keys ?? [])),
    [selection, openMark],
  );

  // Each pin sits level with the first line it's about. Rows can wrap, so
  // positions are measured rather than computed, and re-measured on resize.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pinTops, setPinTops] = useState<Record<string, number>>({});
  const [outline, setOutline] = useState<{ top: number; height: number } | null>(null);
  // Hovering a pin previews its note's lines with the same outline.
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredKeys = placedMarks.find((p) => p.id === hoveredId)?.keys;
  const outlineKeys = selectedChanges.length > 0 ? selectedChanges : (hoveredKeys ?? NO_KEYS);
  const outlinePreview = selectedChanges.length === 0;

  // A faint bar in the margin beside each note's lines, joining its pin to
  // what it's about. Notes on overlapping lines get their own lanes.
  const [bars, setBars] = useState<{ id: string; top: number; height: number; lane: number }[]>([]);
  const pinAnchors = useMemo(() => {
    const anchors = placedMarks.map((p) => ({ id: p.id, key: p.keys[0] }));
    if (selection && draftOpen) anchors.push({ id: DRAFT_PIN, key: getChangeKey(selection.changes[0]) });
    return anchors;
  }, [placedMarks, selection, draftOpen]);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    function measure() {
      const base = wrapper!.getBoundingClientRect().top;
      const found = pinAnchors
        .flatMap(({ id, key }) => {
          const cell = wrapper!.querySelector(`td[data-change-key="${key}"]`);
          return cell ? [{ id, top: cell.getBoundingClientRect().top - base }] : [];
        })
        .sort((a, b) => a.top - b.top);
      // Notes on the same or neighbouring lines stack rather than overlap.
      const next: Record<string, number> = {};
      let floor = -Infinity;
      for (const { id, top } of found) {
        next[id] = Math.max(top, floor);
        floor = next[id] + PIN_SIZE;
      }
      setPinTops((prev) => {
        const same =
          Object.keys(prev).length === found.length && found.every(({ id }) => prev[id] === next[id]);
        return same ? prev : next;
      });

      const spans = placedMarks
        .flatMap(({ id, keys }) => {
          const first = wrapper!.querySelector(`td[data-change-key="${keys[0]}"]`);
          const last = wrapper!.querySelector(`td[data-change-key="${keys[keys.length - 1]}"]`);
          if (!first || !last) return [];
          const top = first.getBoundingClientRect().top - base;
          return [{ id, top, height: last.getBoundingClientRect().bottom - base - top }];
        })
        .sort((a, b) => a.top - b.top);
      const laneEnds: number[] = [];
      const nextBars = spans.map((span) => {
        let lane = laneEnds.findIndex((end) => end <= span.top);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = span.top + span.height;
        return { ...span, lane };
      });
      setBars((prev) =>
        prev.length === nextBars.length &&
        prev.every((b, i) => b.id === nextBars[i].id && b.top === nextBars[i].top && b.height === nextBars[i].height && b.lane === nextBars[i].lane)
          ? prev
          : nextBars,
      );

      // An outline around the selected lines, which a tint alone can't do on
      // rows that are already coloured as added or deleted.
      const first = outlineKeys[0] && wrapper!.querySelector(`td[data-change-key="${outlineKeys[0]}"]`);
      const last =
        outlineKeys.length > 0 &&
        wrapper!.querySelector(`td[data-change-key="${outlineKeys[outlineKeys.length - 1]}"]`);
      if (first && last) {
        const top = first.getBoundingClientRect().top - base;
        const height = last.getBoundingClientRect().bottom - base - top;
        setOutline((prev) => (prev?.top === top && prev.height === height ? prev : { top, height }));
      } else {
        setOutline(null);
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [pinAnchors, placedMarks, outlineKeys, collapsed, tokens]);

  function panelTitle(lines: string) {
    return (
      <span title={file.filename}>
        {file.filename.split("/").pop()} · {lines}
      </span>
    );
  }

  function renderPanel(id: string) {
    if (id === DRAFT_PIN) {
      if (!selection) return null;
      const start = lineRefFor(selection.changes[0]);
      const end = lineRefFor(selection.changes[selection.changes.length - 1]);
      return (
        <NotePanel
          title={panelTitle(describeLines(start, end))}
          draft={unsent[DRAFT_PIN] ?? ""}
          onDraftChange={(text) => onUnsentChange(DRAFT_PIN, text)}
          messages={[]}
          pending={false}
          onSend={(text) =>
            onCreateNote(
              { path: file.filename, hunk: selection.hunk, start, end, code: diffLines(selection.changes) },
              text,
            )
          }
          onRetry={() => {}}
          onClose={onCloseDraft}
        />
      );
    }
    const placedFinding = placedFindings.find((p) => p.id === id);
    if (placedFinding) {
      const { finding } = placedFinding;
      return (
        <FindingPanel
          title={panelTitle(finding.start && finding.end ? describeLines(finding.start, finding.end) : "")}
          body={finding.body}
          rationale={finding.rationale}
          included={finding.included}
          onToggle={() => onToggleFinding(finding.id)}
          onClose={() => onOpenNote(null)}
        />
      );
    }
    const note = placedNotes.find((p) => p.note.id === id)?.note;
    if (!note) return null;
    const status = noteControls.status[id] ?? {};
    return (
      <NotePanel
        title={panelTitle(describeLines(note.start, note.end))}
        draft={unsent[id] ?? ""}
        onDraftChange={(text) => onUnsentChange(id, text)}
        messages={note.messages}
        pending={!!status.pending}
        error={status.error}
        onSend={(text) => noteControls.send(id, text)}
        onRetry={() => noteControls.retry(id)}
        onRead={() => noteControls.markRead(id)}
        onClose={() => onOpenNote(null)}
        onDelete={() => {
          noteControls.remove(id);
          onOpenNote(null);
        }}
      />
    );
  }

  const overlay = !collapsed && (
    <>
      {bars.map((bar) => (
        <div
          key={`bar-${bar.id}`}
          aria-hidden
          style={{ top: bar.top, height: bar.height, marginLeft: 3 + bar.lane * 3 }}
          className="pointer-events-none absolute left-full w-0.5 rounded-full bg-reviewed/50"
        />
      ))}
      {outline && (
        <div
          aria-hidden
          style={{ top: outline.top - 2, height: outline.height + 4 }}
          className={cn(
            "pointer-events-none absolute -inset-x-0.5 z-10 rounded-[4px] border-[1.5px]",
            outlinePreview
              ? "border-reviewed/60"
              : "border-reviewed shadow-[0_0_0_4px_rgba(68,147,248,0.14)]",
          )}
        />
      )}
      {Object.entries(pinTops).map(([id, top]) => {
        const open = id === DRAFT_PIN || id === openNoteId;
        const placed = placedNotes.find((p) => p.note.id === id);
        return (
          <div
            key={id}
            data-note-layer
            data-note-id={id}
            className="absolute left-full ml-2"
            style={{ top: top - 2 }}
          >
            <NotePin
              active={open}
              kind={id.startsWith(FINDING_PIN) ? "finding" : "note"}
              unread={!!placed && isUnread(placed.note)}
              onClick={() => (id === DRAFT_PIN ? onCloseDraft() : onOpenNote(open ? null : id))}
              onHover={(hovering) => setHoveredId(hovering ? id : null)}
            />
            {open && renderPanel(id)}
          </div>
        );
      })}
    </>
  );

  return {
    wrapperRef,
    selectedChanges,
    noteCount: placedNotes.length,
    // Findings on this file, including any about the file as a whole.
    findingCount: findings.length,
    firstUnreadId: placedNotes
      .filter((p) => isUnread(p.note))
      .sort((a, b) => a.note.hunk - b.note.hunk || a.note.start.line - b.note.start.line)[0]?.note.id,
    overlay,
  };
}

function SliceFileSection({
  file,
  hunkIndices,
  hideWhitespace,
  prRef,
  reviewed,
  onSetHunksReviewed,
  noteProps,
  revealAt,
  note,
  autoReviewed,
}: {
  file: PrFile;
  hunkIndices: number[];
  hideWhitespace: boolean;
  prRef: PrRef;
  reviewed: Record<string, boolean>;
  onSetHunksReviewed: (keys: string[], value: boolean) => void;
  noteProps: FileNoteProps;
  // When this file was last picked in the sidebar, or 0.
  revealAt: number;
  note?: FileNote;
  // Counted as reviewed because its note says what it tests.
  autoReviewed: boolean;
}) {
  const { hunks, diffType, tokens, expander } = useDiffRender(file, hideWhitespace, prRef, true, noteProps.notes);
  const hunkKey = (index: number) => `${file.filename}#${index}`;
  const keys = hunkIndices.map(hunkKey);
  // Scoped to the hunks this slice shows - the file may have others that
  // belong to different slices.
  const fileReviewed = keys.length > 0 && keys.every((k) => reviewed[k]);

  const [fileCollapsed, setFileCollapsed] = useState(fileReviewed);

  // Reviewed state drives the file's collapse in both directions: marking
  // reviewed folds it away, marking unreviewed brings it back. Manual
  // expand/collapse in between is left alone.
  const wasFileReviewed = useRef(fileReviewed);
  useEffect(() => {
    if (fileReviewed !== wasFileReviewed.current) setFileCollapsed(fileReviewed);
    wasFileReviewed.current = fileReviewed;
  }, [fileReviewed]);

  // Picking this file in the sidebar opens it: nobody navigates to a file to
  // look at it folded away. Adjusted during render, not in an effect.
  const [seenReveal, setSeenReveal] = useState(0);
  if (revealAt !== seenReveal) {
    setSeenReveal(revealAt);
    if (revealAt) setFileCollapsed(false);
  }

  const displayed = useMemo(
    () => (hunks ? shownHunks(hunks, hunkIndices, (i) => !!expander && expander.below(i) <= 0) : []),
    [hunks, hunkIndices, expander],
  );

  const { wrapperRef, selectedChanges, noteCount, findingCount, firstUnreadId, overlay } = useFileNotes(file, displayed, noteProps, fileCollapsed, tokens);

  return (
    <div ref={wrapperRef} data-note-path={file.filename} className="relative">
      <Card id={fileElementId(file.filename)} className="scroll-mt-4 gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setFileCollapsed((c) => !c)}
            aria-label={fileCollapsed ? "Expand file" : "Collapse file"}
            className="shrink-0 rounded text-muted-foreground hover:text-foreground"
          >
            {fileCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-mono text-xs font-medium",
              fileReviewed && "text-muted-foreground",
            )}
          >
            {file.filename}
          </span>
          {fileCollapsed && noteCount > 0 && (
            <NoteCount
              count={noteCount}
              unread={!!firstUnreadId}
              ring="ring-card"
              onClick={() => {
                setFileCollapsed(false);
                if (firstUnreadId) {
                  noteProps.onOpenNote(firstUnreadId);
                  scrollToNote(firstUnreadId);
                }
              }}
            />
          )}
          {fileCollapsed && <FindingCount count={findingCount} />}
          <span
            title={`This slice shows ${hunkIndices.length} of this file's ${hunks?.length ?? hunkIndices.length} hunks`}
            className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
          >
            {hunkIndices.length}/{hunks?.length ?? hunkIndices.length} hunks
          </span>
          <label
            title={autoReviewed ? "Auto-reviewed: its note below says what it tests" : undefined}
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Checkbox
              checked={fileReviewed}
              onCheckedChange={() => onSetHunksReviewed(keys, !fileReviewed)}
            />
            {autoReviewed ? "Auto-reviewed" : "Reviewed"}
          </label>
        </div>
        {note && <FileNoteBlock note={note} />}
        {!fileCollapsed &&
          (displayed.length > 0 ? (
            <div className="overflow-x-auto text-xs">
              <Diff
                viewType="unified"
                diffType={diffType}
                hunks={displayed.map((d) => d.hunk)}
                tokens={tokens}
                selectedChanges={selectedChanges}
              >
                {() =>
                  displayed.flatMap(({ index, indices, hunk }) => {
                    const key = hunkKey(index);
                    const isReviewed = indices.every((i) => reviewed[hunkKey(i)]);
                    const shown = new Set(hunkIndices);
                    const last = indices[indices.length - 1];
                    const footer = !shown.has(last + 1) && (expander?.below(last) ?? 0) > 0;
                    return [
                      <Decoration key={`decoration-${key}`}>
                        <div
                          className={cn(
                            "flex items-center gap-2 bg-[rgba(56,139,253,0.08)] px-4 py-1.5 font-mono text-xs",
                            isReviewed ? "text-muted-foreground" : "text-[#79c0ff]",
                          )}
                        >
                          <HunkExpanders
                            expander={expander}
                            index={index}
                            where="above"
                            previousShown={shown.has(index - 1)}
                          />
                          <span className="min-w-0 flex-1 truncate">{hunk.content}</span>
                          {isReviewed && <Check className="size-3.5 shrink-0 text-reviewed" />}
                        </div>
                      </Decoration>,
                      <Hunk key={key} hunk={hunk} />,
                      ...(footer
                        ? [
                            <Decoration key={`below-${key}`}>
                              <div className="flex items-center gap-2 bg-[rgba(56,139,253,0.08)] px-4 py-1 font-mono text-xs text-muted-foreground">
                                <HunkExpanders expander={expander} index={last} where="below" />
                              </div>
                            </Decoration>,
                          ]
                        : []),
                    ];
                  })
                }
              </Diff>
            </div>
          ) : (
            <div className="p-4 text-sm italic text-muted-foreground">No matching hunks.</div>
          ))}
      </Card>
      {overlay}
    </div>
  );
}

// The rows a dragged rectangle covers, snapped to whole lines and kept to a
// single block of the diff - the one it covers most. Hunks join into one
// block once the gap between them is fully expanded.
function rowsInRect(
  container: HTMLElement,
  rect: { left: number; top: number; right: number; bottom: number },
): { path: string; keys: string[] } | null {
  let best: { path: string; keys: string[] } | null = null;
  for (const tbody of container.querySelectorAll<HTMLElement>("tbody.diff-hunk")) {
    const box = tbody.getBoundingClientRect();
    if (box.bottom < rect.top || box.top > rect.bottom || box.right < rect.left || box.left > rect.right) {
      continue;
    }
    const path = tbody.closest<HTMLElement>("[data-note-path]")?.dataset.notePath;
    if (!path) continue;
    const keys = [...tbody.querySelectorAll<HTMLElement>("tr.diff-line")].flatMap((row) => {
      const r = row.getBoundingClientRect();
      if (r.bottom <= rect.top || r.top >= rect.bottom) return [];
      const key = row.querySelector<HTMLElement>("[data-change-key]")?.dataset.changeKey;
      return key ? [key] : [];
    });
    if (keys.length > (best?.keys.length ?? 0)) best = { path, keys };
  }
  return best;
}

function SliceView({
  slice,
  files,
  hideWhitespace,
  viewOptions,
  prRef,
  reviewed,
  index,
  total,
  onToggleSlice,
  onSetHunksReviewed,
  onMarkReviewed,
  onPrev,
  onNext,
  notes,
  noteControls,
  revealedFile,
  onRevealNote,
  fileNotes,
  autoReviewedKeys,
  findings,
  onToggleFinding,
}: {
  slice: Slice;
  files: PrFile[];
  hideWhitespace: boolean;
  viewOptions: ReactNode;
  prRef: PrRef;
  reviewed: Record<string, boolean>;
  index: number;
  total: number;
  onToggleSlice: (slice: Slice) => void;
  onSetHunksReviewed: (keys: string[], value: boolean) => void;
  onMarkReviewed: () => void;
  onPrev: () => void;
  onNext: () => void;
  notes: Note[];
  noteControls: NoteControls;
  revealedFile: RevealedFile | null;
  onRevealNote: (note: Note) => void;
  fileNotes: FileNote[];
  // Hunks counting as reviewed only because their test file's note says what
  // it tests.
  autoReviewedKeys: Set<string>;
  findings: FeedbackItem[];
  onToggleFinding: (id: string) => void;
}) {
  const byFile = useMemo(() => groupHunkRefsByFile(slice.hunks), [slice]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const unreadHere = useMemo(
    () => notes.filter((n) => isUnread(n) && slice.hunks.includes(`${n.path}#${n.hunk}`)),
    [notes, slice],
  );
  const { contentRef, startSelecting, fileNoteProps, hint, dragOverlay } = useNoteSelection(
    notes,
    noteControls,
    revealedFile,
    findings,
    onToggleFinding,
  );
  const offscreenUnread = useOffscreenUnread(scrollerRef, contentRef, unreadHere, onRevealNote);
  const orderedFileGroups = useMemo(() => orderFileGroups(byFile, files), [byFile, files]);
  const done = isSliceReviewed(slice, reviewed);
  const [compact, setCompact] = useState(false);

  // Hysteresis keeps the header from flickering at the threshold, and the
  // "room" check skips compacting when the diff barely scrolls - shrinking
  // the header would just hand that room straight back.
  function onScroll(e: UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const room = el.scrollHeight - el.clientHeight;
    setCompact((was) => (was ? el.scrollTop > 4 : el.scrollTop > 48 && room > 240));
  }

  const actions = (
    <div className="flex shrink-0 items-center gap-2">
      <Button variant="outline" size={compact ? "sm" : "default"} onClick={onPrev} disabled={index === 0}>
        ← Prev
      </Button>
      <Button
        variant="outline"
        size={compact ? "sm" : "default"}
        onClick={onNext}
        disabled={index === total - 1}
      >
        Next →
      </Button>
      {done ? (
        <Button variant="outline" size={compact ? "sm" : "default"} onClick={() => onToggleSlice(slice)}>
          <Check className="text-reviewed" />
          Reviewed
        </Button>
      ) : (
        <Button
          size={compact ? "sm" : "default"}
          onClick={onMarkReviewed}
          className="bg-reviewed-strong px-4 text-white hover:bg-[#388bfd]"
        >
          Mark reviewed
          <kbd className="font-mono text-[11px] opacity-70">↵</kbd>
        </Button>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header
        className={cn(
          "shrink-0 border-b px-10 transition-[padding,border-color] duration-200",
          compact ? "border-border py-3" : "border-transparent pt-10 pb-8",
        )}
      >
        {compact ? (
          <div className="flex items-center gap-6">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold">{slice.title}</h2>
              {slice.summary && (
                <p className="truncate text-sm text-muted-foreground">{plainText(slice.summary)}</p>
              )}
            </div>
            {actions}
          </div>
        ) : (
          <>
            <div className="mb-12 flex justify-end">{actions}</div>
            <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight text-balance">
              {slice.title}
            </h2>
            {slice.summary && (
              <div className="mt-4 text-foreground">
                <Markdown text={slice.summary} size="lg" />
              </div>
            )}
          </>
        )}
      </header>
      <div
        ref={scrollerRef}
        data-note-scroller
        onScroll={onScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pb-12 [scrollbar-gutter:stable]"
      >
        <div
          ref={contentRef}
          onPointerDown={startSelecting}
          className="flex flex-col gap-6"
        >
          <div className="-mb-2 flex items-center justify-between gap-4">
            {hint}
            {viewOptions}
          </div>
          {orderedFileGroups.map(([filename, hunkIndices]) => {
            const file = files.find((f) => f.filename === filename);
            if (!file) return null;
            return (
              <SliceFileSection
                key={`${slice.id}:${filename}`}
                file={file}
                hunkIndices={hunkIndices}
                hideWhitespace={hideWhitespace}
                prRef={prRef}
                reviewed={reviewed}
                onSetHunksReviewed={onSetHunksReviewed}
                noteProps={fileNoteProps(filename)}
                revealAt={revealedFile?.filename === filename ? revealedFile.at : 0}
                note={fileNotes.find((n) => n.path === filename)}
                autoReviewed={hunkIndices.every((i) => autoReviewedKeys.has(`${filename}#${i}`))}
              />
            );
          })}
        </div>
      </div>
      {dragOverlay}
      {offscreenUnread}
    </div>
  );
}

function SidebarNav({
  allSlices,
  reviewed,
  activeSliceId,
  overviewActive,
  allFilesActive,
  onSelectOverview,
  onResumeSlices,
  onSelectSlice,
  onToggleSlice,
  onSelectAllFiles,
  activeView,
  onSelectView,
  sliceMarkers,
  yourFeedbackCount,
  agentFeedbackCount,
  busy,
  reviewState,
}: {
  allSlices: Slice[];
  reviewed: Record<string, boolean>;
  activeSliceId: string | null;
  overviewActive: boolean;
  allFilesActive: boolean;
  onSelectOverview: () => void;
  onResumeSlices: () => void;
  onSelectSlice: (id: string) => void;
  onToggleSlice: (slice: Slice) => void;
  onSelectAllFiles: () => void;
  activeView: View;
  onSelectView: (view: FeedbackView) => void;
  // What's on each slice's lines, by slice id.
  sliceMarkers: Record<string, SliceMarkerCounts>;
  // How many drafted comments are ticked to include.
  yourFeedbackCount: number;
  agentFeedbackCount: number;
  // Feedback steps with work in progress: drafting, reviewing, preparing.
  busy: Partial<Record<FeedbackView, boolean>>;
  reviewState: "none" | "ready" | "posted";
}) {
  const rowClass = (active: boolean) =>
    cn(
      "-mx-2.5 flex items-start gap-3 rounded-md border px-2.5 py-2",
      active ? "border-border bg-background/60" : "border-transparent",
    );
  const topLevelClass = (active: boolean) =>
    cn(
      "min-w-0 flex-1 text-left text-[15px] font-medium hover:text-foreground",
      active ? "text-foreground" : "text-foreground/80",
    );
  const sliceLabelClass = (active: boolean) =>
    cn(
      "min-w-0 flex-1 text-left text-sm leading-snug hover:text-foreground",
      active ? "font-medium text-foreground" : "text-muted-foreground",
    );
  const topLevelIcon = "mt-0.5 size-4 shrink-0 text-muted-foreground";

  return (
    <nav className="flex flex-col gap-1">
      <div className={rowClass(overviewActive)}>
        <BookOpen className={topLevelIcon} />
        <button type="button" onClick={onSelectOverview} className={topLevelClass(overviewActive)}>
          Overview
        </button>
      </div>

      <div className="mt-2 flex flex-col">
        <div className={rowClass(false)}>
          <ListChecks className={topLevelIcon} />
          <button
            type="button"
            onClick={onResumeSlices}
            title="Go to the first slice you haven't reviewed"
            className={topLevelClass(false)}
          >
            Slices
          </button>
        </div>
        <ol className="flex flex-col gap-0.5 pl-3">
          {allSlices.map((slice) => {
            const done = isSliceReviewed(slice, reviewed);
            const current = activeSliceId === slice.id;
            return (
              <li key={slice.id} className={rowClass(current)}>
                <button
                  type="button"
                  onClick={() => onToggleSlice(slice)}
                  aria-label={done ? `Mark "${slice.title}" unreviewed` : `Mark "${slice.title}" reviewed`}
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    done
                      ? "border-reviewed-strong bg-reviewed-strong text-white"
                      : current
                        ? "border-foreground/70"
                        : "border-muted-foreground/40 hover:border-muted-foreground",
                  )}
                >
                  {done && <Check className="size-2.5" strokeWidth={3.5} />}
                </button>
                <button type="button" onClick={() => onSelectSlice(slice.id)} className={sliceLabelClass(current)}>
                  {slice.title}
                </button>
                <SliceMarkers markers={sliceMarkers[slice.id]} />
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-2 flex flex-col">
        <div className={rowClass(false)}>
          <MessagesSquare className={topLevelIcon} />
          <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground/80">Feedback</span>
        </div>
        <ol className="flex flex-col gap-0.5 pl-3">
          {(
            [
              { id: "your-feedback", label: "Your feedback", Icon: User, count: yourFeedbackCount },
              { id: "agent-feedback", label: "Agent feedback", Icon: Bot, count: agentFeedbackCount },
              { id: "post-review", label: "Post review", Icon: Send, count: 0 },
            ] as const
          ).map(({ id, label, Icon, count }) => (
            <li key={id} className={rowClass(activeView === id)}>
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => onSelectView(id)} className={sliceLabelClass(activeView === id)}>
                {label}
              </button>
              {busy[id] ? (
                <Loader2 aria-label="Working" className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
              ) : id === "post-review" && reviewState === "posted" ? (
                <span title="This review has been posted" className="mt-0.5 flex items-center gap-1 text-xs text-reviewed">
                  <Check className="size-3.5" />
                  Posted
                </span>
              ) : id === "post-review" && reviewState === "ready" ? (
                <span title="Prepared and ready to post" className="mt-0.5 text-xs text-muted-foreground">
                  Ready
                </span>
              ) : (
                count > 0 && (
                  <span
                    title={`${count} ticked to include`}
                    className="mt-0.5 text-xs text-muted-foreground tabular-nums"
                  >
                    {count}
                  </span>
                )
              )}
            </li>
          ))}
        </ol>
      </div>

      <div className={cn(rowClass(allFilesActive), "mt-5")}>
        <Files className={topLevelIcon} />
        <button type="button" onClick={onSelectAllFiles} className={topLevelClass(allFilesActive)}>
          All files
        </button>
      </div>
    </nav>
  );
}

interface SliceMarkerCounts {
  threads: number;
  unread: boolean;
  findings: number;
}

// What's waiting in a slice, beside its title: the reviewer's threads (with
// the unread dot when a reply is new) and the agent's findings.
function SliceMarkers({ markers }: { markers?: SliceMarkerCounts }) {
  if (!markers || (markers.threads === 0 && markers.findings === 0)) return null;
  return (
    <span className="mt-0.5 flex shrink-0 items-center gap-2 text-[11px] tabular-nums">
      {markers.threads > 0 && (
        <span
          title={`${markers.threads} ${markers.threads === 1 ? "thread" : "threads"}${markers.unread ? ", with an unread reply" : ""}`}
          className="flex items-center gap-1 text-reviewed"
        >
          <CommentIcon className="size-3" unread={markers.unread} ring="ring-sidebar" />
          {markers.threads}
        </span>
      )}
      {markers.findings > 0 && (
        <span
          title={`${markers.findings} agent ${markers.findings === 1 ? "finding" : "findings"}`}
          className="flex items-center gap-1 text-muted-foreground"
        >
          <Bot className="size-3" />
          {markers.findings}
        </span>
      )}
    </span>
  );
}

function ViewOptions({
  hideWhitespace,
  onHideWhitespaceChange,
  autoReviewTests,
  onAutoReviewTestsChange,
}: {
  hideWhitespace: boolean;
  onHideWhitespaceChange: (value: boolean) => void;
  autoReviewTests: boolean;
  onAutoReviewTestsChange: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-muted-foreground"
      >
        <SlidersHorizontal />
        View
        <ChevronDown />
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-20 mt-1 w-56 rounded-lg border bg-popover p-1.5 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={hideWhitespace} onCheckedChange={onHideWhitespaceChange} />
            Hide whitespace
          </label>
          <label
            title="Count test files as reviewed once their note says what they test. Your own ticks always win."
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox checked={autoReviewTests} onCheckedChange={onAutoReviewTestsChange} />
            Auto-review tests
          </label>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function GenerationStatus({
  generation,
  now,
  onStop,
}: {
  generation: Generation;
  now: number;
  onStop: () => void;
}) {
  if (generation.status === "failed" || generation.status === "stopped") {
    return (
      <span className={cn("text-sm", generation.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
        {generation.status === "failed" ? "Preparing failed" : "Preparing stopped"}
      </span>
    );
  }
  const active = PIPELINE_STEPS.filter(({ step }) => generation.steps[step].status === "active");
  const startedAt = Math.min(...active.map(({ step }) => generation.steps[step].startedAt ?? now));
  return (
    <span className="flex items-center gap-3 text-sm">
      <Loader2 className="size-4 animate-spin text-reviewed motion-reduce:animate-none" />
      <span className="text-muted-foreground">
        {generation.status === "queued"
          ? "Queued"
          : `${active.map(({ label }) => label).join(" and ") || "Preparing"} · ${formatElapsed(now - startedAt)}`}
      </span>
      <Button size="sm" variant="ghost" onClick={onStop}>
        Stop
      </Button>
    </span>
  );
}

function SavedPrRow({
  saved,
  generation,
  now,
  disabled,
  onOpen,
  onStop,
  onDelete,
}: {
  saved: SavedPr;
  generation: Generation | undefined;
  now: number;
  disabled: boolean;
  onOpen: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const { owner, repo, number, record } = saved;
  const slices = record.slices;
  const reviewedSlices = slices?.filter((slice) => isSliceReviewed(slice, record.reviewed)).length ?? 0;

  return (
    <li className="flex items-center gap-4 rounded-lg border border-transparent px-3 py-3 hover:border-border hover:bg-card">
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className="min-w-0 flex-1 text-left disabled:opacity-50"
      >
        <div className="truncate text-[15px] font-medium">
          {record.title ?? `${owner}/${repo} #${number}`}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {owner}/{repo} #{number}
        </div>
      </button>
      {generation ? (
        <span className="shrink-0">
          <GenerationStatus generation={generation} now={now} onStop={onStop} />
        </span>
      ) : (
        <>
          <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
            {slices ? `${reviewedSlices}/${slices.length} slices` : "No slices yet"}
          </span>
          <span className="w-24 shrink-0 text-right text-sm text-muted-foreground">
            {record.lastOpenedAt ? formatRelativeTime(record.lastOpenedAt) : ""}
          </span>
        </>
      )}
      <div className="flex w-28 shrink-0 justify-end">
        {confirming ? (
          <div className="flex items-center gap-1 text-sm">
            <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive">
              Delete?
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} className="text-muted-foreground">
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => setConfirming(true)}
            aria-label={`Delete saved review of ${owner}/${repo} #${number}`}
            title="Delete this saved review"
            className="text-muted-foreground"
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  );
}

function StartPage({
  prUrl,
  onPrUrlChange,
  onSubmit,
  onOpenSaved,
  loading,
  error,
}: {
  prUrl: string;
  onPrUrlChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onOpenSaved: (ref: PrRef) => void;
  loading: boolean;
  error: string | null;
}) {
  const [saved, setSaved] = useState<SavedPr[] | null>(null);
  const [generations, setGenerations] = useState<ListedGeneration[]>([]);
  const [now, setNow] = useState(() => Date.now());
  // Generation states whose results are already saved, so each is written once.
  const collected = useRef(new Set<string>());

  // Reads saved reviews and the backend's generations together. Results of
  // a generation that stopped, failed or finished while nobody was looking
  // are saved here; a finished one is then dropped from the backend, since
  // everything it produced now lives in the browser.
  const refresh = useCallback(async () => {
    const listed = await fetch("/api/generations")
      .then((res) => readOk<{ generations: ListedGeneration[] }>(res))
      .then((body) => body.generations)
      .catch(() => [] as ListedGeneration[]);

    for (const { owner, repo, number, generation } of listed) {
      if (isGenerating(generation)) continue;
      const mark = `${generation.id}:${generation.status}`;
      if (collected.current.has(mark)) continue;
      collected.current.add(mark);
      const { slices, conversation, summary } = generation.results;
      if (slices) await persistSlices(owner, repo, number, slices);
      if (conversation) await persistConversation(owner, repo, number, conversation);
      if (summary) await persistSummary(owner, repo, number, summary);
      if (generation.status === "done") {
        await fetch(generationUrlFor(owner, repo, number), { method: "DELETE" }).catch(() => {});
      }
    }

    const list = await listSavedPrs().catch(() => [] as SavedPr[]);
    // A generation can exist for a PR with no saved row yet.
    for (const { owner, repo, number } of listed) {
      if (!list.some((s) => s.owner === owner && s.repo === repo && s.number === number)) {
        list.push({ owner, repo, number, record: { reviewed: {}, slices: null, summary: null, conversation: null, fileNotes: null, notes: [], feedback: {} } });
      }
    }
    setSaved(list.sort((a, b) => (b.record.lastOpenedAt ?? 0) - (a.record.lastOpenedAt ?? 0)));
    setGenerations(listed.filter(({ generation }) => generation.status !== "done"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const anyActive = generations.some(({ generation }) => isGenerating(generation));
  useEffect(() => {
    if (!anyActive) return;
    const poll = setInterval(refresh, 2000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [anyActive, refresh]);

  function generationFor(target: SavedPr): Generation | undefined {
    return generations.find(
      (g) => g.owner === target.owner && g.repo === target.repo && g.number === target.number,
    )?.generation;
  }

  async function stopFor(target: SavedPr) {
    await fetch(`${generationUrlFor(target.owner, target.repo, target.number)}/stop`, { method: "POST" }).catch(
      () => {},
    );
    await refresh();
  }

  async function deleteSaved(target: SavedPr) {
    const url = generationUrlFor(target.owner, target.repo, target.number);
    if (isGenerating(generationFor(target))) await fetch(`${url}/stop`, { method: "POST" }).catch(() => {});
    await fetch(url, { method: "DELETE" }).catch(() => {});
    await deleteSavedPr(target.owner, target.repo, target.number);
    await refresh();
  }

  return (
    <div className="scrollbar-thin relative h-screen overflow-y-auto px-6 [scrollbar-gutter:stable]">
      <div className="absolute top-5 right-6 w-72">
        <ModelPicker />
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-12 pt-[18vh] pb-16">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Review a pull request</h1>
          <p className="text-sm text-muted-foreground">
            Paste a GitHub PR link. It'll be broken into slices you can review one at a time.
          </p>
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="https://github.com/owner/repo/pull/123"
              value={prUrl}
              onChange={(e) => onPrUrlChange(e.target.value)}
            />
            <Button type="submit" disabled={loading}>
              {loading ? "Loading…" : "Load PR"}
            </Button>
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
        </form>

        {saved && saved.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">Recent reviews</h2>
            <ul className="-mx-3 flex flex-col">
              {saved.map((entry) => (
                <SavedPrRow
                  key={`${entry.owner}/${entry.repo}/${entry.number}`}
                  saved={entry}
                  generation={generationFor(entry)}
                  now={now}
                  disabled={loading}
                  onOpen={() => onOpenSaved({ owner: entry.owner, repo: entry.repo, number: entry.number })}
                  onStop={() => stopFor(entry)}
                  onDelete={() => deleteSaved(entry)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

interface ModelOption {
  id: string;
  label: string;
  group: "endpoint" | "claude-code";
}

// Which model Docent uses: one the endpoint in backend/.env offers, or one of
// Claude Code's when it's installed, which runs calls through `claude -p`
// on the reviewer's own login. Saved by the backend, used from the next call.
function ModelPicker() {
  const [state, setState] = useState<{ options: ModelOption[]; selected: string; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => readOk<{ options: ModelOption[]; selected: string; error?: string }>(res))
      .then(setState)
      .catch((err) => setState({ options: [], selected: "", error: (err as Error).message }));
  }, []);

  async function choose(model: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/models/selected", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const { selected } = await readOk<{ selected: string }>(res);
      setState((prev) => prev && { ...prev, selected });
    } catch (err) {
      setState((prev) => prev && { ...prev, error: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;
  const endpoint = state.options.filter((o) => o.group === "endpoint");
  const claude = state.options.filter((o) => o.group === "claude-code");
  // The one in use stays listed even if nothing offers it now (the endpoint
  // is down, say), so it's clear what Docent is set to.
  const missing = state.selected && !state.options.some((o) => o.id === state.selected);
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Model</span>
        <select
          value={state.selected}
          disabled={saving || state.options.length + (missing ? 1 : 0) === 0}
          onChange={(e) => choose(e.target.value)}
          className="min-w-0 flex-1 rounded-md border bg-card px-2.5 py-1.5 font-mono text-[13px] outline-none focus:border-reviewed disabled:opacity-60"
        >
          {missing && <option value={state.selected}>{state.selected} (unavailable)</option>}
          {endpoint.length > 0 && (
            <optgroup label="Endpoint (backend/.env)">
              {endpoint.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {claude.length > 0 && (
            <optgroup label="Claude Code (your login)">
              {claude.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {state.error && (
        <p className="text-right text-xs text-muted-foreground">
          Couldn't list the endpoint's models ({state.error}). Check it's running, and the settings in backend/.env.
        </p>
      )}
    </div>
  );
}

function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: Link[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const image = images[index];
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/80 p-6"
      onClick={onClose}
    >
      <img
        src={imageSrcFor(image.url)}
        alt={image.label}
        className="max-h-[80vh] max-w-[90vw] rounded-lg object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onIndexChange(index - 1)}
          disabled={index === 0}
        >
          Prev
        </Button>
        <span className="text-sm text-white">
          {index + 1} / {images.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onIndexChange(index + 1)}
          disabled={index === images.length - 1}
        >
          Next
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

// Public GitHub avatars load without auth; bots and deleted users sometimes
// 404, so fall back to an initial.
function Avatar({ login, size }: { login: string; size: "sm" | "md" }) {
  const [failed, setFailed] = useState(false);
  const px = size === "md" ? 32 : 24;
  const box = size === "md" ? "size-8 text-sm" : "size-6 text-xs";
  if (failed) {
    return (
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground uppercase",
          box,
        )}
      >
        {login.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={`https://github.com/${encodeURIComponent(login)}.png?size=${px * 2}`}
      alt=""
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-muted", box)}
    />
  );
}

const VERDICT_STYLES: Record<NonNullable<ReviewerConversation["verdict"]>, string> = {
  approved: "border-[#3fb950]/40 text-[#3fb950]",
  "changes requested": "border-[#f85149]/40 text-[#f85149]",
  commented: "border-border text-muted-foreground",
};

const OUTCOME_STYLES: Record<ReplyOutcome, string> = {
  actioned: "border-reviewed/40 text-reviewed",
  answered: "border-reviewed/40 text-reviewed",
  acknowledged: "border-border text-muted-foreground",
  mixed: "border-border text-muted-foreground",
  refuted: "border-[#e3b341]/40 text-[#e3b341]",
};

function Tag({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={cn("rounded-full border px-2 py-px text-[11px] font-medium", className)}>
      {children}
    </span>
  );
}

function Bubble({
  login,
  label,
  tag,
  children,
  muted = false,
}: {
  login: string;
  label?: string;
  tag?: ReactNode;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <article className="flex gap-3 rounded-xl border bg-card p-4">
      <Avatar login={login} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{login}</span>
          {label && <span className="text-muted-foreground">{label}</span>}
          {tag}
        </div>
        <div className={cn("mt-1 text-[15px] leading-relaxed", muted && "text-muted-foreground")}>
          {children}
        </div>
      </div>
    </article>
  );
}

// Replies sit below their reviewer's bubble, indented and joined by an
// elbow line running down from the reviewer's avatar, so top-level bubbles
// stay easy to scan while the thread is still easy to follow.
function ConversationThread({ entry, prAuthor }: { entry: ReviewerConversation; prAuthor: string }) {
  return (
    <div className="flex flex-col gap-3">
      <Bubble
        login={entry.reviewer}
        tag={entry.verdict && <Tag className={VERDICT_STYLES[entry.verdict]}>{entry.verdict}</Tag>}
      >
        <Markdown text={entry.summary} />
      </Bubble>
      {entry.replies.length > 0 ? (
        <div className="flex flex-col gap-3 pl-14">
          {entry.replies.map((reply, i) => {
            const isLast = i === entry.replies.length - 1;
            return (
              <div
                key={i}
                className={cn(
                  "relative",
                  "before:absolute before:-top-3 before:-left-6 before:h-[44px] before:w-5 before:rounded-bl-lg before:border-b before:border-l before:border-muted-foreground/40",
                  !isLast &&
                    "after:absolute after:top-8 after:-bottom-3 after:-left-6 after:border-l after:border-muted-foreground/40",
                )}
              >
                <Bubble
                  login={reply.from === "author" ? prAuthor : entry.reviewer}
                  label={reply.from === "author" ? "author" : undefined}
                  tag={reply.outcome && <Tag className={OUTCOME_STYLES[reply.outcome]}>{reply.outcome}</Tag>}
                  muted
                >
                  <Markdown text={reply.summary} />
                </Bubble>
              </div>
            );
          })}
        </div>
      ) : (
        // Only worth saying for an actual review - an automated PR summary
        // from a bot isn't waiting on a response.
        entry.verdict && (
          <p className="pl-14 text-sm text-muted-foreground">No response from {prAuthor} yet.</p>
        )
      )}
    </div>
  );
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// Shown instead of the overview while a PR is generated for the first time,
// so the page doesn't look finished while it's still empty.
function PreparingView({
  prRef,
  title,
  fileCount,
  generation,
  onStop,
  onResume,
}: {
  prRef: PrRef;
  title: string | undefined;
  fileCount: number;
  generation: Generation | null;
  onStop: () => void;
  onResume: () => void;
}) {
  const steps = generation?.steps ?? null;
  const error = generation?.status === "failed" ? (generation.error ?? "Something went wrong.") : null;
  const stopped = generation?.status === "stopped";
  const queued = generation?.status === "queued";
  const running = isGenerating(generation);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <div className="flex h-full items-center justify-center px-10">
      <div className="flex w-full max-w-lg flex-col gap-8">
        <div>
          <div className="text-sm font-medium text-reviewed">
            {error
              ? "Preparing this review failed"
              : stopped
                ? "You stopped preparing this review"
                : queued
                  ? "Waiting for another review to finish"
                  : "Preparing your review"}
          </div>
          <h1 className="mt-3 text-[26px] leading-[1.2] font-semibold tracking-tight text-balance">
            {title ?? "Pull request"}
          </h1>
          <div className="mt-2 font-mono text-sm text-muted-foreground">
            {prRef.owner}/{prRef.repo} #{prRef.number}
          </div>
        </div>

        <ol className="flex flex-col gap-4 text-[15px]">
          <li className="flex items-center gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-reviewed-strong text-white">
              <Check className="size-3" strokeWidth={3.5} />
            </span>
            <span>Fetched the PR and its {fileCount} {fileCount === 1 ? "file" : "files"}</span>
          </li>
          {PIPELINE_STEPS.map(({ step, label }) => {
            const state = steps?.[step];
            const done = state?.status === "done";
            const active = state?.status === "active";
            const failed = active && !!error;
            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full",
                    done && "bg-reviewed-strong text-white",
                    !done && !active && "border-[1.5px] border-muted-foreground/40",
                  )}
                >
                  {done ? (
                    <Check className="size-3" strokeWidth={3.5} />
                  ) : failed ? (
                    <CircleAlert className="size-5 text-destructive" />
                  ) : active ? (
                    <Loader2 className="size-5 animate-spin text-reviewed motion-reduce:animate-none" />
                  ) : null}
                </span>
                <span className={cn(!done && !active && "text-muted-foreground", active && "font-medium")}>
                  {label}
                </span>
                {active && !failed && state.startedAt && (
                  <span className="ml-auto font-mono text-sm text-muted-foreground tabular-nums">
                    {formatElapsed(now - state.startedAt)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        {error ? (
          <div className="flex flex-col gap-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
            <div className="flex items-start gap-3 text-[15px]">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                Generation failed. <span className="text-muted-foreground">{error}</span>
              </span>
            </div>
            <Button variant="outline" onClick={onResume} className="self-start">
              Try again
            </Button>
          </div>
        ) : stopped ? (
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={onResume}>
              Resume
            </Button>
            <span className="text-sm text-muted-foreground">Steps that already finished are kept.</span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={onStop}>
              Stop
            </Button>
            <span className="text-sm text-muted-foreground">
              This keeps going if you leave. You can browse the files from the sidebar in the meantime.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function LandingView({
  prRef,
  prMeta,
  generation,
  onStopGeneration,
  summary,
  conversation,
  onRegenerate,
  hasSlices,
  hasProgress,
  onStartReviewing,
}: {
  prRef: PrRef;
  prMeta: PrMeta | null;
  generation: Generation | null;
  onStopGeneration: () => void;
  summary: PrSummary | null;
  conversation: ConversationSummary | null;
  onRegenerate: () => void;
  hasSlices: boolean;
  hasProgress: boolean;
  onStartReviewing: () => void;
}) {
  const running = isGenerating(generation);
  const pipelineError = generation?.status === "failed" ? (generation.error ?? "Something went wrong.") : null;
  const stageLabel =
    generation?.status === "queued"
      ? "Waiting for another review to finish…"
      : generation?.status === "running"
        ? PIPELINE_STEPS.filter(({ step }) => generation.steps[step].status === "active")
            .map(({ label }) => label)
            .join(" and ") + "…"
        : null;

  const links = useMemo(() => extractLinks(prMeta?.body ?? null), [prMeta]);
  const imageLinks = useMemo(() => links.filter((l) => l.isImage), [links]);
  const plainLinks = useMemo(() => links.filter((l) => !l.isImage), [links]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const hasConversation = !!conversation && (conversation.reviewers.length > 0 || !!conversation.authorNotes);

  const summarySections: { heading: string; body: string; Icon: LucideIcon; color: string }[] = summary
    ? [
        { heading: "What", body: summary.what, Icon: Package, color: "text-[#79c0ff]" },
        { heading: "Why", body: summary.why, Icon: Lightbulb, color: "text-[#e3b341]" },
        ...(summary.how
          ? [{ heading: "How", body: summary.how, Icon: Wrench, color: "text-[#d2a8ff]" }]
          : []),
      ].filter((section) => section.body)
    : [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Same header shape as a slice, so the actions sit where Mark reviewed does. */}
      <header className="flex shrink-0 justify-end gap-2 border-b border-transparent px-10 pt-10">
        <Button variant="outline" onClick={onRegenerate} disabled={running}>
          {running ? "Generating…" : "Regenerate review"}
        </Button>
        {prMeta && (
          <a href={prMeta.htmlUrl} target="_blank" rel="noreferrer">
            <Button variant="outline">View in GitHub</Button>
          </a>
        )}
        {hasSlices && (
          <Button onClick={onStartReviewing} className="bg-reviewed-strong px-4 text-white hover:bg-[#388bfd]">
            {hasProgress ? "Continue reviewing →" : "Start reviewing →"}
          </Button>
        )}
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pt-12 pb-16 [scrollbar-gutter:stable]">
        <div className="mx-auto max-w-[860px]">
          <h1 className="text-[28px] leading-[1.2] font-semibold tracking-tight text-balance">
            {prMeta?.title ?? "Pull request"}
          </h1>
          <div className="mt-2 font-mono text-sm text-muted-foreground">
            {prRef.owner}/{prRef.repo} #{prRef.number}
          </div>

          {stageLabel && (
            <div className="mt-8 flex items-center gap-3 rounded-lg border border-reviewed/40 bg-reviewed/10 px-4 py-3 text-[15px]">
              <Loader2 className="size-4 shrink-0 animate-spin text-reviewed motion-reduce:animate-none" />
              <span className="flex-1">
                Regenerating the review · <span className="text-muted-foreground">{stageLabel}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={onStopGeneration}>
                Stop
              </Button>
            </div>
          )}
          {pipelineError && !stageLabel && (
            <div className="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-[15px]">
              Regenerating the review failed: <span className="text-muted-foreground">{pipelineError}</span>
            </div>
          )}

          <div className="mt-12 flex flex-col gap-10">
            {summarySections.length > 0
              ? summarySections.map((section) => (
                  <section key={section.heading}>
                    <h2 className={cn("flex items-center gap-2.5 text-xl font-semibold tracking-tight", section.color)}>
                      <section.Icon className="size-5" strokeWidth={2.25} />
                      {section.heading}
                    </h2>
                    <div className="mt-3">
                      <Markdown text={section.body} size="lg" />
                    </div>
                  </section>
                ))
              : !running && (
                  <p className="text-[15px] text-muted-foreground">
                    No summary yet. Regenerate the review to write one.
                  </p>
                )}
          </div>

          {links.length > 0 && (
            <section className="mt-16 border-t pt-14">
              <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                <ImageIcon className="size-5 text-muted-foreground" strokeWidth={2.25} />
                {imageLinks.length > 0 ? "Media" : "Links"}
              </h2>
              {imageLinks.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-3">
                  {imageLinks.map((link, i) => (
                    <button
                      key={link.url}
                      type="button"
                      onClick={() => setLightboxIndex(i)}
                      className="aspect-[3/2] w-[168px] max-w-full overflow-hidden rounded-lg border hover:border-muted-foreground"
                    >
                      <img src={imageSrcFor(link.url)} alt={link.label} className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {plainLinks.length > 0 && (
                <ul className="mt-5 flex flex-col gap-1.5">
                  {plainLinks.map((link) => (
                    <li key={link.url} className="truncate">
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[15px] text-[#79c0ff] hover:underline"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {(hasConversation || !running) && (
            <section className="mt-16 border-t pt-14">
              <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
                <MessagesSquare className="size-5 text-muted-foreground" strokeWidth={2.25} />
                Conversation
              </h2>
              {conversation && hasConversation ? (
                <div className="mt-5 flex flex-col gap-5">
                  {conversation.reviewers.map((entry) => (
                    <ConversationThread key={entry.reviewer} entry={entry} prAuthor={conversation.prAuthor} />
                  ))}
                  {conversation.authorNotes && (
                    <Bubble login={conversation.prAuthor} label="author notes" muted>
                      <Markdown text={conversation.authorNotes} />
                    </Bubble>
                  )}
                </div>
              ) : (
                !running && (
                  <p className="mt-3 text-[15px] text-muted-foreground">
                    {conversation ? "No reviews or comments yet." : "Regenerate the review to summarize the conversation."}
                  </p>
                )
              )}
            </section>
          )}
        </div>
      </div>

      {lightboxIndex !== null && (
        <ImageLightbox
          images={imageLinks}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}

function FileDiff({
  file,
  reviewed,
  hideWhitespace,
  prRef,
  onToggle,
  noteProps,
  revealAt,
}: {
  file: PrFile;
  reviewed: boolean;
  hideWhitespace: boolean;
  prRef: PrRef;
  onToggle: () => void;
  noteProps: FileNoteProps;
  // When this file was last picked in the sidebar, or 0.
  revealAt: number;
}) {
  const [collapsed, setCollapsed] = useState(reviewed);
  const wasReviewed = useRef(reviewed);

  useEffect(() => {
    if (wasReviewed.current !== reviewed) {
      setCollapsed(reviewed);
    }
    wasReviewed.current = reviewed;
  }, [reviewed]);

  // Picking this file in the sidebar opens it: nobody navigates to a file to
  // look at it folded away. Adjusted during render, not in an effect.
  const [seenReveal, setSeenReveal] = useState(0);
  if (revealAt !== seenReveal) {
    setSeenReveal(revealAt);
    if (revealAt) setCollapsed(false);
  }

  const { hunks, diffType, tokens, expander } = useDiffRender(file, hideWhitespace, prRef, !collapsed, noteProps.notes);
  const displayed = useMemo(
    () =>
      hunks
        ? shownHunks(
            hunks,
            hunks.map((_, i) => i),
            (i) => !!expander && expander.below(i) <= 0,
          )
        : [],
    [hunks, expander],
  );
  const { wrapperRef, selectedChanges, noteCount, findingCount, firstUnreadId, overlay } = useFileNotes(file, displayed, noteProps, collapsed, tokens);

  return (
    <div ref={wrapperRef} data-note-path={file.filename} className="relative">
      <Card id={fileElementId(file.filename)} className="scroll-mt-6 gap-0 overflow-hidden py-0">
        <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand diff" : "Collapse diff"}
            className="shrink-0 rounded text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
            {file.filename}
          </span>
          {collapsed && noteCount > 0 && (
            <NoteCount
              count={noteCount}
              unread={!!firstUnreadId}
              ring="ring-card"
              onClick={() => {
                setCollapsed(false);
                if (firstUnreadId) {
                  noteProps.onOpenNote(firstUnreadId);
                  scrollToNote(firstUnreadId);
                }
              }}
            />
          )}
          {collapsed && <FindingCount count={findingCount} />}
          <Badge variant="outline" className="border-[#3fb950]/40 bg-[#3fb950]/10 text-[#3fb950]">
            +{file.additions}
          </Badge>
          <Badge variant="outline" className="border-[#f85149]/40 bg-[#f85149]/10 text-[#f85149]">
            -{file.deletions}
          </Badge>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={reviewed} onCheckedChange={onToggle} />
            Reviewed
          </label>
        </div>
        {!collapsed &&
          (hunks && hunks.length > 0 ? (
            <div className="overflow-x-auto text-xs">
              <Diff
                viewType="unified"
                diffType={diffType}
                hunks={displayed.map((d) => d.hunk)}
                tokens={tokens}
                selectedChanges={selectedChanges}
              >
                {() =>
                  displayed.flatMap(({ index, indices, hunk }) => {
                    const last = indices[indices.length - 1];
                    return [
                      <Decoration key={`decoration-${index}`}>
                        <div className="flex items-center gap-2 bg-[rgba(56,139,253,0.1)] px-4 py-1.5 font-mono text-xs text-[#79c0ff]">
                          <HunkExpanders expander={expander} index={index} where="above" previousShown={index > 0} />
                          <span className="min-w-0 flex-1 truncate">{hunk.content}</span>
                        </div>
                      </Decoration>,
                      <Hunk key={`hunk-${index}`} hunk={hunk} />,
                      ...(last === (hunks?.length ?? 0) - 1 && (expander?.below(last) ?? 0) > 0
                        ? [
                            <Decoration key="below-last">
                              <div className="flex items-center gap-2 bg-[rgba(56,139,253,0.1)] px-4 py-1 font-mono text-xs text-muted-foreground">
                                <HunkExpanders expander={expander} index={last} where="below" />
                              </div>
                            </Decoration>,
                          ]
                        : []),
                    ];
                  })
                }
              </Diff>
            </div>
          ) : (
            <div className="p-4 text-sm italic text-muted-foreground">
              No diff available for this file.
            </div>
          ))}
      </Card>
      {overlay}
    </div>
  );
}

function AllFilesView({
  files,
  reviewedFileCount,
  isReviewed,
  hideWhitespace,
  viewOptions,
  prRef,
  onToggleFile,
  notes,
  noteControls,
  revealedFile,
  onRevealNote,
  findings,
  onToggleFinding,
}: {
  files: PrFile[];
  reviewedFileCount: number;
  isReviewed: (filename: string) => boolean;
  hideWhitespace: boolean;
  viewOptions: ReactNode;
  prRef: PrRef;
  onToggleFile: (filename: string) => void;
  notes: Note[];
  noteControls: NoteControls;
  revealedFile: RevealedFile | null;
  onRevealNote: (note: Note) => void;
  findings: FeedbackItem[];
  onToggleFinding: (id: string) => void;
}) {
  const { contentRef, startSelecting, fileNoteProps, hint, dragOverlay } = useNoteSelection(
    notes,
    noteControls,
    revealedFile,
    findings,
    onToggleFinding,
  );
  const scrollerRef = useRef<HTMLDivElement>(null);
  const unreadHere = useMemo(() => notes.filter(isUnread), [notes]);
  const offscreenUnread = useOffscreenUnread(scrollerRef, contentRef, unreadHere, onRevealNote);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 px-10 pt-10 pb-6">
        <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight">All files</h2>
        <p className="mt-2 text-[15px] text-muted-foreground tabular-nums">
          {reviewedFileCount} of {files.length} files reviewed
        </p>
      </header>
      <div
        ref={scrollerRef}
        data-note-scroller
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pb-12 [scrollbar-gutter:stable]"
      >
        <div
          ref={contentRef}
          onPointerDown={startSelecting}
          className="flex flex-col gap-4"
        >
          <div className="-mb-2 flex items-center justify-between gap-4">
            {hint}
            {viewOptions}
          </div>
          {files.map((file) => (
            <FileDiff
              key={file.filename}
              file={file}
              reviewed={isReviewed(file.filename)}
              hideWhitespace={hideWhitespace}
              prRef={prRef}
              onToggle={() => onToggleFile(file.filename)}
              noteProps={fileNoteProps(file.filename)}
              revealAt={revealedFile?.filename === file.filename ? revealedFile.at : 0}
            />
          ))}
        </div>
      </div>
      {dragOverlay}
      {offscreenUnread}
    </div>
  );
}

const PR_URL_RE = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

interface PrRef {
  owner: string;
  repo: string;
  number: string;
}

function parsePrUrl(url: string): PrRef | null {
  const match = url.trim().match(PR_URL_RE);
  if (!match) return null;
  const [, owner, repo, number] = match;
  return { owner, repo, number };
}

const AUTO_REVIEW_TESTS_KEY = "docent:auto-review-tests";

// On unless turned off.
function readAutoReviewTests(): boolean {
  try {
    return localStorage.getItem(AUTO_REVIEW_TESTS_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeAutoReviewTests(value: boolean) {
  try {
    localStorage.setItem(AUTO_REVIEW_TESTS_KEY, String(value));
  } catch {
    // ignore, e.g. private browsing
  }
}

const SIDEBAR_WIDTH_KEY = "docent:sidebar-width";
const SIDEBAR_MIN = 240;
const SIDEBAR_MAX = 520;
const SIDEBAR_DEFAULT = 300;

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));
}

function readStoredSidebarWidth(): number {
  try {
    const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return stored ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT;
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function writeStoredSidebarWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
  } catch {
    // ignore, e.g. private browsing
  }
}

async function readOk<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

type FeedbackView = "your-feedback" | "agent-feedback" | "post-review";
type View = "landing" | "slice" | "files" | FeedbackView;

// Each view has its own address, so reload, Back and links all land where
// they should: /pr/owner/repo/123 is the Overview, and the rest hang off it.
const VIEW_PATHS: Record<Exclude<View, "landing" | "slice">, string> = {
  files: "files",
  "your-feedback": "feedback/yours",
  "agent-feedback": "feedback/agent",
  "post-review": "review",
};

interface Route {
  prRef: PrRef | null;
  view: View;
  sliceId: string | null;
}

function parseRoute(pathname: string): Route {
  const pr = matchPath({ path: "/pr/:owner/:repo/:number/*" }, pathname);
  if (!pr?.params.owner || !pr.params.repo || !pr.params.number) return { prRef: null, view: "landing", sliceId: null };
  const prRef = { owner: pr.params.owner, repo: pr.params.repo, number: pr.params.number };
  const rest = pr.params["*"] ?? "";
  const slice = rest.match(/^slices\/([^/]+)$/);
  if (slice) return { prRef, view: "slice", sliceId: decodeURIComponent(slice[1]) };
  const view = (Object.keys(VIEW_PATHS) as (keyof typeof VIEW_PATHS)[]).find((v) => VIEW_PATHS[v] === rest);
  return { prRef, view: view ?? "landing", sliceId: null };
}

function pathFor(ref: PrRef, view: View, sliceId?: string): string {
  const base = `/pr/${ref.owner}/${ref.repo}/${ref.number}`;
  if (view === "slice" && sliceId) return `${base}/slices/${encodeURIComponent(sliceId)}`;
  if (view === "landing" || view === "slice") return base;
  return `${base}/${VIEW_PATHS[view]}`;
}

function App() {
  const [prUrl, setPrUrl] = useState("");
  const [prRef, setPrRef] = useState<PrRef | null>(null);
  const [prMeta, setPrMeta] = useState<PrMeta | null>(null);
  const [files, setFiles] = useState<PrFile[] | null>(null);
  // What the reviewer ticked. What counts as reviewed also includes test
  // files auto-reviewed from their notes; see `reviewed` below.
  const [storedReviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [fileNotes, setFileNotes] = useState<Record<string, FileNote[]> | null>(null);
  const [autoReviewTests, setAutoReviewTests] = useState(readAutoReviewTests);
  const [slices, setSlices] = useState<Slice[] | null>(null);
  const [summary, setSummary] = useState<PrSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [revealedFile, setRevealedFile] = useState<RevealedFile | null>(null);
  const [feedback, setFeedback] = useState<Partial<Record<FeedbackKind, FeedbackDraft>>>({});
  const [draftStatus, setDraftStatus] = useState<Partial<Record<FeedbackKind, DraftStatus>>>({});
  const [agentReview, setAgentReview] = useState<AgentReviewState | null>(null);
  const [agentError, setAgentError] = useState<string | undefined>(undefined);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft | undefined>(undefined);
  const [prepareStatus, setPrepareStatus] = useState<DraftStatus>({});
  const [reviewer, setReviewer] = useState<{ viewer: string; author: string } | null>(null);
  // Replies in flight and failed ones, by note id. Not saved: a reply lost
  // to a reload is retried by asking again.
  const [noteStatus, setNoteStatus] = useState<Record<string, NoteStatus>>({});
  // The latest status of this PR's background generation, if it has one
  // that hasn't been collected yet (running, queued, stopped or failed).
  const [generation, setGeneration] = useState<Generation | null>(null);
  // True while a PR is being generated for the first time (or retried after
  // that failed): the overview shows the preparation screen instead of a
  // half-empty page. A regenerate of an existing review keeps the overview.
  const [preparing, setPreparing] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const route = useMemo(() => parseRoute(location.pathname), [location.pathname]);
  const view = route.view;
  const activeSliceId = route.sliceId;

  function setView(next: View) {
    if (prRef) navigate(pathFor(prRef, next));
  }

  function openSlice(id: string | null | undefined) {
    if (prRef && id) navigate(pathFor(prRef, "slice", id));
  }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideWhitespace, setHideWhitespace] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth);

  function startSidebarResize(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    let latest = startWidth;
    function onMove(ev: PointerEvent) {
      latest = clampSidebarWidth(startWidth + ev.clientX - startX);
      setSidebarWidth(latest);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      writeStoredSidebarWidth(latest);
    }
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const fileHunkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const file of files ?? []) counts[file.filename] = countFileHunks(file);
    return counts;
  }, [files]);

  const everythingElse = useMemo((): Slice => {
    const claimed = new Set((slices ?? []).flatMap((slice) => slice.hunks));
    const hunks = (files ?? []).flatMap((file) =>
      fileHunkKeys(file.filename, fileHunkCounts[file.filename] ?? 0).filter((k) => !claimed.has(k)),
    );
    return {
      id: "everything-else",
      title: "Everything else",
      summary: "Hunks not covered by any slice above.",
      hunks,
    };
  }, [files, slices, fileHunkCounts]);

  const allSlices = useMemo(() => {
    if (slices === null) return [];
    return everythingElse.hunks.length > 0 ? [...slices, everythingElse] : slices;
  }, [slices, everythingElse]);
  // Test files with a note saying what they test count as reviewed while
  // "Auto-review tests" is on - unless the reviewer has ticked or unticked
  // them, which always wins. Worked out here, never saved, so turning the
  // option off brings them straight back.
  const autoReviewedKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!autoReviewTests || !fileNotes) return keys;
    for (const slice of slices ?? []) {
      for (const note of fileNotes[slice.id] ?? []) {
        if (note.kind !== "tests") continue;
        for (const hunk of slice.hunks) {
          if (hunk.startsWith(`${note.path}#`) && !(hunk in storedReviewed)) keys.add(hunk);
        }
      }
    }
    return keys;
  }, [autoReviewTests, fileNotes, slices, storedReviewed]);

  const reviewed = useMemo(() => {
    if (autoReviewedKeys.size === 0) return storedReviewed;
    const merged = { ...storedReviewed };
    for (const key of autoReviewedKeys) merged[key] = true;
    return merged;
  }, [storedReviewed, autoReviewedKeys]);

  // For each slice: the reviewer's threads and the agent's findings on its
  // lines. A finding belongs to the slice whose hunk its first line is in; one
  // about a whole file, to every slice with that file; one about the whole
  // PR, to none.
  const sliceMarkers = useMemo(() => {
    const hunksByFile = new Map<string, HunkData[]>();
    const hunksOf = (path: string) => {
      if (!hunksByFile.has(path)) {
        const file = files?.find((f) => f.filename === path);
        let hunks: HunkData[] = [];
        try {
          hunks = file?.patch ? (parseDiff(buildDiffText(file))[0]?.hunks ?? []) : [];
        } catch {
          hunks = [];
        }
        hunksByFile.set(path, hunks);
      }
      return hunksByFile.get(path)!;
    };
    const findingRefs = (feedback.agent?.items ?? []).map((item) => {
      if (!item.path) return [];
      const hunks = hunksOf(item.path);
      if (!item.start) return hunks.map((_, i) => `${item.path}#${i}`);
      const start = item.start;
      const at = hunks.findIndex((h) => h.changes.some((c) => matches(c, start)));
      return at >= 0 ? [`${item.path}#${at}`] : [];
    });
    const markers: Record<string, SliceMarkerCounts> = {};
    for (const slice of allSlices) {
      const refs = new Set(slice.hunks);
      const threads = notes.filter((n) => refs.has(`${n.path}#${n.hunk}`));
      markers[slice.id] = {
        threads: threads.length,
        unread: threads.some(isUnread),
        findings: findingRefs.filter((r) => r.some((ref) => refs.has(ref))).length,
      };
    }
    return markers;
  }, [allSlices, notes, feedback.agent, files]);

  const activeSliceIndex = activeSliceId ? allSlices.findIndex((i) => i.id === activeSliceId) : -1;
  const activeSlice = activeSliceIndex >= 0 ? allSlices[activeSliceIndex] : null;

  const generationUrl = (ref: PrRef) => generationUrlFor(ref.owner, ref.repo, ref.number);

  // Results the browser has already copied out of the current generation, so
  // each one is saved once however many times it's polled.
  const collected = useRef<{ id: string; steps: Set<PipelineStep> } | null>(null);

  function collectGeneration(ref: PrRef, next: Generation) {
    if (collected.current?.id !== next.id) collected.current = { id: next.id, steps: new Set() };
    const done = collected.current.steps;
    const { slices, conversation, summary, fileNotes } = next.results;
    if (fileNotes && !done.has("notes")) {
      done.add("notes");
      setFileNotes(fileNotes);
      persistFileNotes(ref.owner, ref.repo, ref.number, fileNotes);
    }
    if (slices && !done.has("slices")) {
      done.add("slices");
      setSlices(slices);
      persistSlices(ref.owner, ref.repo, ref.number, slices);
    }
    if (conversation && !done.has("conversation")) {
      done.add("conversation");
      setConversation(conversation);
      persistConversation(ref.owner, ref.repo, ref.number, conversation);
    }
    if (summary && !done.has("summary")) {
      done.add("summary");
      setSummary(summary);
      persistSummary(ref.owner, ref.repo, ref.number, summary);
    }
    if (next.status === "done") {
      setGeneration(null);
      setPreparing(false);
      fetch(generationUrl(ref), { method: "DELETE" }).catch(() => {});
    } else {
      setGeneration(next);
    }
  }

  // Starts a background generation, or attaches to one already running for
  // this PR. Steps with a result in `reuse` are skipped; the summary is always
  // rewritten, since it's written from the other two.
  async function startGeneration(
    ref: PrRef,
    {
      firstRun,
      reuse,
    }: {
      firstRun: boolean;
      reuse?: {
        slices: Slice[] | null;
        conversation: ConversationSummary | null;
        fileNotes?: Record<string, FileNote[]> | null;
      };
    },
  ) {
    setPreparing(firstRun);
    try {
      const res = await fetch(generationUrl(ref), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reuse: { slices: reuse?.slices, conversation: reuse?.conversation, fileNotes: reuse?.fileNotes },
        }),
      });
      const body = await readOk<{ generation: Generation }>(res);
      collectGeneration(ref, body.generation);
    } catch (err) {
      setGeneration((prev) => ({
        ...(prev ?? emptyGeneration()),
        status: "failed",
        error: (err as Error).message,
      }));
    }
  }

  async function stopGeneration(ref: PrRef) {
    try {
      const res = await fetch(`${generationUrl(ref)}/stop`, { method: "POST" });
      const body = await readOk<{ generation: Generation | null }>(res);
      if (body.generation) setGeneration(body.generation);
    } catch {
      // The next check-in will show whatever state it's really in.
    }
  }

  const generationActive = isGenerating(generation);
  useEffect(() => {
    if (!prRef || !generationActive) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(generationUrl(prRef));
        const body = await readOk<{ generation: Generation | null }>(res);
        if (cancelled) return;
        if (body.generation) {
          collectGeneration(prRef, body.generation);
        } else {
          // Jobs only live as long as the backend process.
          setGeneration((prev) =>
            prev && { ...prev, status: "failed", error: "The backend restarted, so this run was lost." },
          );
        }
      } catch {
        // A missed check-in is fine; the next one catches up.
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // Re-arm when the PR changes or a new generation starts.
  }, [prRef, generationActive, generation?.id]);

  async function loadPrByRef(ref: PrRef) {
    setError(null);
    setGeneration(null);
    setPreparing(false);
    setLoading(true);
    setFiles(null);
    setPrMeta(null);
    setSlices(null);
    setSummary(null);
    setConversation(null);
    setFileNotes(null);
    setNotes([]);
    setNoteStatus({});
    setFeedback({});
    setDraftStatus({});
    setAgentReview(null);
    setAgentError(undefined);
    agentCollected.current = null;
    setReviewDraft(undefined);
    setPrepareStatus({});
    setReviewer(null);

    try {
      const [filesRes, prRecord, generationRes] = await Promise.all([
        fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}`),
        getPrRecord(ref.owner, ref.repo, ref.number),
        fetch(generationUrl(ref))
          .then((res) => readOk<{ generation: Generation | null }>(res))
          .catch(() => ({ generation: null })),
      ]);
      if (!filesRes.ok) {
        const body = await filesRes.json();
        throw new Error(body.error ?? "Failed to fetch PR");
      }
      const { files, meta } = await filesRes.json();

      setPrRef(ref);
      setFiles(files);
      setPrMeta(meta ?? null);
      setReviewed(prRecord.reviewed);
      setSlices(prRecord.slices);
      setSummary(prRecord.summary);
      setConversation(prRecord.conversation);
      setFileNotes(prRecord.fileNotes);
      setNotes(prRecord.notes);
      setFeedback(prRecord.feedback);
      setReviewDraft(prRecord.review);
      fetch(agentReviewUrl(ref))
        .then((res) => readOk<{ review: AgentReviewBody | null }>(res))
        .then(({ review }) => review && collectAgentReview(ref, review))
        .catch(() => {});
      markPrOpened(ref.owner, ref.repo, ref.number, meta?.title).catch(() => {});

      const existing = generationRes.generation;
      if (existing) {
        // A generation from an earlier visit: pick up what it finished while
        // we were away. A stopped or failed one stays that way until resumed.
        setPreparing(!prRecord.summary && !existing.results.summary);
        collectGeneration(ref, existing);
      } else if (!prRecord.slices || !prRecord.conversation || !prRecord.summary || !prRecord.fileNotes) {
        startGeneration(ref, {
          firstRun: !prRecord.summary,
          reuse: { slices: prRecord.slices, conversation: prRecord.conversation, fileNotes: prRecord.fileNotes },
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function loadPr(e: FormEvent) {
    e.preventDefault();
    const ref = parsePrUrl(prUrl);
    if (!ref) {
      setError("Enter a GitHub PR URL, e.g. https://github.com/owner/repo/pull/123");
      return;
    }
    navigate(pathFor(ref, "landing"));
  }

  // The PR in the address is the one that's open: going to a PR's address
  // loads it, and leaving for the start page closes it.
  const routePrKey = route.prRef ? `${route.prRef.owner}/${route.prRef.repo}/${route.prRef.number}` : null;
  useEffect(() => {
    if (!route.prRef) {
      clearPr();
      return;
    }
    setPrUrl(`https://github.com/${route.prRef.owner}/${route.prRef.repo}/pull/${route.prRef.number}`);
    loadPrByRef(route.prRef);
    // Keyed on the PR, not the view: moving between a PR's views keeps it open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routePrKey]);

  function clearPr() {
    setPrUrl("");
    setPrRef(null);
    setPrMeta(null);
    setFiles(null);
    setReviewed({});
    setSlices(null);
    setSummary(null);
    setConversation(null);
    setFileNotes(null);
    setNotes([]);
    setNoteStatus({});
    setFeedback({});
    setDraftStatus({});
    setAgentReview(null);
    setAgentError(undefined);
    agentCollected.current = null;
    setReviewDraft(undefined);
    setPrepareStatus({});
    setReviewer(null);
    setGeneration(null);
    setPreparing(false);
    setError(null);
  }

  // Replies can land after the reviewer has moved to another PR; they're
  // saved either way, but only shown if this PR is still open.
  const openPrKey = useRef<string | null>(null);
  useEffect(() => {
    openPrKey.current = prRef ? `${prRef.owner}/${prRef.repo}/${prRef.number}` : null;
  }, [prRef]);

  function noteReplyContext(note: Note) {
    const file = files?.find((f) => f.filename === note.path);
    const slice = allSlices.find((s) => s.hunks.includes(`${note.path}#${note.hunk}`));
    return {
      path: note.path,
      lines: describeLines(note.start, note.end),
      code: note.code,
      fileDiff: file?.patch ?? note.code,
      prTitle: prMeta?.title,
      prWhat: summary?.what,
      sliceTitle: slice?.title,
      sliceSummary: slice?.summary,
    };
  }

  async function requestNoteReply(ref: PrRef, note: Note) {
    const key = `${ref.owner}/${ref.repo}/${ref.number}`;
    const setStatus = (status: NoteStatus) => {
      if (openPrKey.current === key) setNoteStatus((prev) => ({ ...prev, [note.id]: status }));
    };
    setStatus({ pending: true });
    try {
      const res = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/notes/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: noteReplyContext(note),
          messages: note.messages.map(({ role, text }) => ({ role, text })),
        }),
      });
      const { text } = await readOk<{ text: string }>(res);
      const updated = await appendNoteMessage(ref.owner, ref.repo, ref.number, note.id, {
        role: "assistant",
        text,
        at: Date.now(),
      });
      if (updated && openPrKey.current === key) {
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
      }
      setStatus({});
    } catch (err) {
      setStatus({ error: (err as Error).message });
    }
  }

  const noteControls: NoteControls = {
    status: noteStatus,
    create(anchor, text) {
      const now = Date.now();
      const note: Note = { id: crypto.randomUUID(), ...anchor, messages: [{ role: "user", text, at: now }], createdAt: now };
      if (prRef) {
        setNotes((prev) => [...prev, note]);
        persistNote(prRef.owner, prRef.repo, prRef.number, note)
          .then(() => requestNoteReply(prRef, note))
          .catch((err) => setNoteStatus((prev) => ({ ...prev, [note.id]: { error: (err as Error).message } })));
      }
      return note.id;
    },
    send(id, text) {
      const note = notes.find((n) => n.id === id);
      if (!prRef || !note) return;
      const updated = { ...note, messages: [...note.messages, { role: "user" as const, text, at: Date.now() }] };
      setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
      persistNote(prRef.owner, prRef.repo, prRef.number, updated)
        .then(() => requestNoteReply(prRef, updated))
        .catch((err) => setNoteStatus((prev) => ({ ...prev, [id]: { error: (err as Error).message } })));
    },
    retry(id) {
      const note = notes.find((n) => n.id === id);
      if (prRef && note) requestNoteReply(prRef, note);
    },
    remove(id) {
      if (!prRef) return;
      setNotes((prev) => prev.filter((n) => n.id !== id));
      persistDeleteNote(prRef.owner, prRef.repo, prRef.number, id).catch(() => {});
    },
    markRead(id) {
      const note = notes.find((n) => n.id === id);
      if (!prRef || !note || !isUnread(note)) return;
      const readAt = Date.now();
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
      persistNoteRead(prRef.owner, prRef.repo, prRef.number, id, readAt).catch(() => {});
    },
  };

  async function setHunksReviewed(keys: string[], value: boolean) {
    if (!prRef || keys.length === 0) return;
    setReviewed((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = value;
      return next;
    });
    await persistReviewedHunks(prRef.owner, prRef.repo, prRef.number, keys, value);
  }

  function toggleFile(filename: string) {
    const keys = fileHunkKeys(filename, fileHunkCounts[filename] ?? 0);
    const currentlyReviewed = keys.every((k) => reviewed[k]);
    setHunksReviewed(keys, !currentlyReviewed);
  }

  function toggleSlice(slice: Slice) {
    setHunksReviewed(slice.hunks, !isSliceReviewed(slice, reviewed));
  }

  // Marking a slice reviewed moves straight on to the next one; Next alone
  // moves on without marking, which is why there's no separate Skip.
  function markActiveSliceReviewed() {
    if (!activeSlice) return;
    setHunksReviewed(activeSlice.hunks, true);
    const next = allSlices[activeSliceIndex + 1];
    if (next) openSlice(next.id);
  }

  useEffect(() => {
    if (view !== "slice" || !activeSlice) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, a, [role=button], [contenteditable]")) return;
      if (activeSlice && isSliceReviewed(activeSlice, reviewed)) return;
      e.preventDefault();
      markActiveSliceReviewed();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // The sidebar's file list follows the view: in a slice it lists just that
  // slice's files and scrolls within the slice; anywhere else it lists every
  // file, and picking one opens All files at that file.
  const fileListMode: "slice" | "all" = view === "slice" && activeSlice ? "slice" : "all";
  const sliceHunkKeysByFile = useMemo(() => {
    const byFile = new Map<string, string[]>();
    if (!activeSlice) return byFile;
    for (const [filename, indices] of groupHunkRefsByFile(activeSlice.hunks)) {
      byFile.set(filename, indices.map((i) => `${filename}#${i}`));
    }
    return byFile;
  }, [activeSlice]);
  const listedFiles =
    fileListMode === "slice"
      ? (files ?? []).filter((f) => sliceHunkKeysByFile.has(f.filename))
      : (files ?? []);

  // Picking a file in the sidebar opens it where it's shown: within the
  // current slice or All files, and from anywhere else, All files.
  function revealFile(filename: string, noteId?: string) {
    setRevealedFile({ filename, noteId, at: Date.now() });
    if (view !== "slice" && view !== "files") setView("files");
    const done = () => setRevealedFile(null);
    if (noteId) scrollToNote(noteId, done);
    else scrollWhenReady(() => document.getElementById(fileElementId(filename)), "start", done);
  }

  function selectListedFile(filename: string) {
    revealFile(filename);
  }

  const listedNotes = useMemo(() => {
    const fileOrder = new Map((files ?? []).map((f, i) => [f.filename, i]));
    return [...notes].sort(
      (a, b) =>
        (fileOrder.get(a.path) ?? 0) - (fileOrder.get(b.path) ?? 0) ||
        a.hunk - b.hunk ||
        a.start.line - b.start.line,
    );
  }, [notes, files]);

  // From the Feedback list: to the slice the note's lines are in, so the
  // review stays in its guided order, or All files if no slice has them.
  function openListedNote(note: Note) {
    const slice = allSlices.find((s) => s.hunks.includes(`${note.path}#${note.hunk}`));
    if (slice) {
      openSlice(slice.id);
    } else {
      setView("files");
    }
    setRevealedFile({ filename: note.path, noteId: note.id, at: Date.now() });
    scrollToNote(note.id, () => setRevealedFile(null));
  }

  async function draftFeedback(kind: FeedbackKind) {
    if (!prRef) return;
    const ref = prRef;
    const key = `${ref.owner}/${ref.repo}/${ref.number}`;
    const here = () => openPrKey.current === key;
    setDraftStatus((prev) => ({ ...prev, [kind]: { pending: true } }));
    try {
      let draft: FeedbackDraft;
      if (kind === "yours") {
        const threads = listedNotes;
        const res = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/feedback/yours`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prTitle: prMeta?.title,
            threads: threads.map((n) => ({
              path: n.path,
              lines: describeLines(n.start, n.end),
              code: n.code,
              messages: n.messages.map(({ role, text }) => ({ role, text })),
            })),
          }),
        });
        const { comments } = await readOk<{ comments: { threads: number[]; body: string; rationale?: string }[] }>(res);
        draft = {
          items: comments.map(({ threads: indices, body, rationale }) => ({
            id: crypto.randomUUID(),
            body,
            rationale,
            included: true,
            ...placeFeedback(indices.map((i) => threads[i]).filter(Boolean)),
          })),
          draftedAt: Date.now(),
          basedOn: Object.fromEntries(threads.map((n) => [n.id, n.messages.length])),
        };
      } else {
        return;
      }
      await persistFeedback(ref.owner, ref.repo, ref.number, kind, draft);
      if (here()) {
        setFeedback((prev) => ({ ...prev, [kind]: draft }));
        setDraftStatus((prev) => ({ ...prev, [kind]: {} }));
      }
    } catch (err) {
      if (here()) setDraftStatus((prev) => ({ ...prev, [kind]: { error: (err as Error).message } }));
    }
  }

  const agentReviewUrl = (ref: PrRef) => `/api/pr/${ref.owner}/${ref.repo}/${ref.number}/agent-review`;
  // The findings already copied into the agent draft, by review.
  const agentCollected = useRef<{ id: string; count: number } | null>(null);

  // Copies an agent review's findings into the agent draft as they arrive,
  // keeping any the reviewer has already unticked, and lets the backend
  // forget the review once it's over.
  function collectAgentReview(ref: PrRef, review: AgentReviewBody) {
    setAgentReview({
      source: review.source,
      status: review.status,
      progress: review.progress,
      findingCount: review.findings.length,
      error: review.error,
    });
    const seen = agentCollected.current;
    const fresh = seen?.id !== review.id || seen.count !== review.findings.length;
    if (fresh) {
      agentCollected.current = { id: review.id, count: review.findings.length };
      setFeedback((prev) => {
        const included = new Map((prev.agent?.items ?? []).map((i) => [i.id, i.included]));
        const draft: FeedbackDraft = {
          items: review.findings.map((f) => ({
            id: f.id,
            body: f.body,
            rationale: f.rationale,
            included: included.get(f.id) ?? true,
            path: f.path,
            ...(f.startLine
              ? {
                  start: { side: "new" as const, line: f.startLine },
                  end: { side: "new" as const, line: f.endLine ?? f.startLine },
                }
              : {}),
          })),
          draftedAt: Date.now(),
        };
        persistFeedback(ref.owner, ref.repo, ref.number, "agent", draft).catch(() => {});
        return { ...prev, agent: draft };
      });
    }
    if (review.status !== "running") fetch(agentReviewUrl(ref), { method: "DELETE" }).catch(() => {});
  }

  async function startAgentReview(mode: "builtin" | "external") {
    if (!prRef) return;
    const ref = prRef;
    setAgentError(undefined);
    try {
      const res = await fetch(agentReviewUrl(ref), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, context: { title: prMeta?.title, summary, slices: allSlices } }),
      });
      const { review } = await readOk<{ review: AgentReviewBody }>(res);
      agentCollected.current = null;
      collectAgentReview(ref, review);
    } catch (err) {
      setAgentError((err as Error).message);
    }
  }

  async function endAgentReview(action: "stop" | "finish") {
    if (!prRef) return;
    try {
      const res = await fetch(`${agentReviewUrl(prRef)}/${action}`, { method: "POST" });
      const { review } = await readOk<{ review: AgentReviewBody | null }>(res);
      if (review) collectAgentReview(prRef, review);
    } catch {
      // The next check-in shows whatever state it's really in.
    }
  }

  const agentRunning = agentReview?.status === "running";
  useEffect(() => {
    if (!prRef || !agentRunning) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { review } = await readOk<{ review: AgentReviewBody | null }>(await fetch(agentReviewUrl(prRef)));
        if (cancelled) return;
        if (review) collectAgentReview(prRef, review);
        else setAgentReview((prev) => prev && { ...prev, status: "failed", error: "The backend restarted, so this review was lost." });
      } catch {
        // A missed check-in is fine; the next one catches up.
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [prRef, agentRunning]);

  function renderFeedbackContext(item: Pick<FeedbackItem, "path" | "start" | "end">) {
    const file = item.path ? files?.find((f) => f.filename === item.path) : undefined;
    return file && item.start && item.end ? (
      <FeedbackContext file={file} start={item.start} end={item.end} hideWhitespace={hideWhitespace} />
    ) : null;
  }

  // Everything ticked in the two Feedback steps: what a review is made from.
  const reviewCandidates = useMemo(
    (): ReviewCandidate[] =>
      (["yours", "agent"] as const).flatMap((source) =>
        (feedback[source]?.items ?? []).filter((item) => item.included).map((item) => ({ item, source })),
      ),
    [feedback],
  );

  function saveReview(next: ReviewDraft | undefined) {
    if (!prRef) return;
    setReviewDraft(next);
    persistReviewDraft(prRef.owner, prRef.repo, prRef.number, next).catch(() => {});
  }

  async function prepareReview() {
    if (!prRef) return;
    const ref = prRef;
    const candidates = reviewCandidates;
    setPrepareStatus({ pending: true });
    try {
      const res = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/review/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: candidates.map(({ item, source }) => ({
            id: item.id,
            source,
            location: item.path
              ? `${item.path}${item.start && item.end ? ` ${describeLines(item.start, item.end)}` : ""}`
              : "the PR as a whole",
            body: item.body,
            inline: isInlineComment(item),
          })),
        }),
      });
      const prepared = await readOk<{
        comments: { from: string[]; body: string }[];
        dropped: { from: string[]; reason: string }[];
        body: string;
      }>(res);
      const byId = new Map(candidates.map((c) => [c.item.id, c.item]));
      const next: ReviewDraft = {
        preparedAt: Date.now(),
        basedOn: candidates.map((c) => c.item.id),
        // A combined comment sits on the lines of the first item it came
        // from that has any.
        comments: prepared.comments.map(({ from, body }) => {
          const anchor = from.map((id) => byId.get(id)).find((item) => item?.path);
          return {
            id: crypto.randomUUID(),
            body,
            included: true,
            from,
            path: anchor?.path,
            start: anchor?.start,
            end: anchor?.end,
          };
        }),
        dropped: prepared.dropped,
        summary: prepared.body,
        event: reviewDraft?.event ?? "COMMENT",
      };
      if (openPrKey.current === `${ref.owner}/${ref.repo}/${ref.number}`) {
        saveReview(next);
        setPrepareStatus({});
      }
    } catch (err) {
      setPrepareStatus({ error: (err as Error).message });
    }
  }

  function reviewRequest(draft: ReviewDraft, dryRun: boolean) {
    if (!prRef) throw new Error("No PR open.");
    return fetch(`/api/pr/${prRef.owner}/${prRef.repo}/${prRef.number}/review/post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dryRun,
        event: draft.event,
        summary: draft.summary,
        comments: draft.comments
          .filter((c) => c.included && c.body.trim())
          .map(({ body, path, start, end }) => ({ body, path, start, end })),
      }),
    });
  }

  async function previewReview(): Promise<ReviewPayload> {
    if (!reviewDraft) throw new Error("Nothing prepared yet.");
    const { payload } = await readOk<{ payload: ReviewPayload }>(await reviewRequest(reviewDraft, true));
    return payload;
  }

  async function postReview() {
    if (!reviewDraft || !prRef) return;
    const ref = prRef;
    // A little before now, allowing for the clocks here and at GitHub.
    const since = Date.now() - 30_000;
    try {
      const { url } = await readOk<{ url: string }>(await reviewRequest(reviewDraft, false));
      saveReview({ ...reviewDraft, posted: { at: Date.now(), url } });
    } catch (err) {
      // The post can succeed and its answer still be lost on the way back.
      // Only report a failure once GitHub confirms nothing arrived.
      const found = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/review/posted-since?since=${since}`)
        .then((res) => readOk<{ url: string | null }>(res))
        .then((r) => r.url)
        .catch(() => null);
      if (!found) throw err;
      saveReview({ ...reviewDraft, posted: { at: Date.now(), url: found } });
    }
  }

  // GitHub takes a comment on lines only if they're in the PR's diff as it
  // stands - not lines the reviewer expanded, and not a whole file.
  function isInlineComment(comment: Pick<ReviewComment, "path" | "start" | "end">): boolean {
    const file = comment.path ? files?.find((f) => f.filename === comment.path) : undefined;
    const { start, end } = comment;
    if (!file?.patch || !start || !end) return false;
    try {
      const changes = (parseDiff(buildDiffText(file))[0]?.hunks ?? []).flatMap((h) => h.changes);
      return changes.some((c) => matches(c, start)) && changes.some((c) => matches(c, end));
    } catch {
      return false;
    }
  }

  // A comment set aside as already said, back in the review as it was.
  function restoreDropped(index: number) {
    if (!reviewDraft) return;
    const dropped = reviewDraft.dropped[index];
    const items = new Map(reviewCandidates.map((c) => [c.item.id, c.item]));
    const sources = dropped.from.map((id) => items.get(id)).filter((i): i is FeedbackItem => !!i);
    if (sources.length === 0) return;
    const anchor = sources.find((i) => i.path);
    const text = sources.map((i) => i.body).join("\n\n");
    // With no lines to sit on, it goes in the review's body like the others.
    if (!anchor || !isInlineComment(anchor)) {
      saveReview({
        ...reviewDraft,
        dropped: reviewDraft.dropped.filter((_, i) => i !== index),
        summary: [reviewDraft.summary.trim(), text].filter(Boolean).join("\n\n"),
      });
      return;
    }
    saveReview({
      ...reviewDraft,
      dropped: reviewDraft.dropped.filter((_, i) => i !== index),
      comments: [
        ...reviewDraft.comments,
        {
          id: crypto.randomUUID(),
          body: text,
          included: true,
          from: dropped.from,
          path: anchor?.path,
          start: anchor?.start,
          end: anchor?.end,
        },
      ],
    });
  }

  // Who's reviewing, to know whether this is their own PR.
  useEffect(() => {
    if (view !== "post-review" || !prRef || reviewer) return;
    fetch(`/api/pr/${prRef.owner}/${prRef.repo}/${prRef.number}/review/viewer`)
      .then((res) => readOk<{ viewer: string; author: string }>(res))
      .then(setReviewer)
      .catch(() => {});
  }, [view, prRef, reviewer]);

  function toggleFeedbackItem(kind: FeedbackKind, id: string) {
    const draft = feedback[kind];
    if (!prRef || !draft) return;
    const next = { ...draft, items: draft.items.map((i) => (i.id === id ? { ...i, included: !i.included } : i)) };
    setFeedback((prev) => ({ ...prev, [kind]: next }));
    persistFeedback(prRef.owner, prRef.repo, prRef.number, kind, next).catch(() => {});
  }

  function openUnreadIn(filename: string) {
    const sliceKeys = fileListMode === "slice" ? sliceHunkKeysByFile.get(filename) : undefined;
    const first = notes
      .filter((n) => n.path === filename && isUnread(n) && (!sliceKeys || sliceKeys.includes(`${n.path}#${n.hunk}`)))
      .sort((a, b) => a.hunk - b.hunk || a.start.line - b.start.line)[0];
    revealFile(filename, first?.id);
  }

  // In a slice, a file's checkbox covers only the hunks that slice shows -
  // the same scope as the file's own header - so it agrees with what's on
  // screen even when the file's other hunks belong to other slices.
  function listedFileKeys(filename: string): string[] {
    if (fileListMode === "slice") return sliceHunkKeysByFile.get(filename) ?? [];
    return fileHunkKeys(filename, fileHunkCounts[filename] ?? 0);
  }

  function isListedFileChecked(filename: string): boolean {
    const keys = listedFileKeys(filename);
    return keys.length > 0 && keys.every((k) => reviewed[k]);
  }

  // Scoped the same way as the checkboxes: in a slice, only threads on the
  // lines that slice shows.
  function listedFileNotes(filename: string) {
    const sliceKeys = fileListMode === "slice" ? sliceHunkKeysByFile.get(filename) : undefined;
    const fileNotes = notes.filter(
      (n) => n.path === filename && (!sliceKeys || sliceKeys.includes(`${n.path}#${n.hunk}`)),
    );
    const findings = (feedback.agent?.items ?? []).filter((f) => {
      if (f.path !== filename) return false;
      // In a slice, only findings on the lines it shows, or on the whole file.
      if (!sliceKeys || !f.start) return true;
      const start = f.start;
      const file = files?.find((x) => x.filename === filename);
      let hunks: HunkData[] = [];
      try {
        hunks = file?.patch ? (parseDiff(buildDiffText(file))[0]?.hunks ?? []) : [];
      } catch {
        hunks = [];
      }
      const at = hunks.findIndex((h) => h.changes.some((c) => matches(c, start)));
      return at >= 0 && sliceKeys.includes(`${filename}#${at}`);
    }).length;
    return fileNotes.length > 0 || findings > 0
      ? { count: fileNotes.length, unread: fileNotes.some(isUnread), findings }
      : null;
  }

  function toggleListedFile(filename: string) {
    setHunksReviewed(listedFileKeys(filename), !isListedFileChecked(filename));
  }

  function resumeSlices() {
    const next = allSlices.find((slice) => !isSliceReviewed(slice, reviewed)) ?? allSlices[0];
    if (!next) {
      setView("landing");
      return;
    }
    openSlice(next.id);
  }

  const reviewedFileCount = (files ?? []).filter((file) =>
    isFileReviewed(file.filename, fileHunkCounts[file.filename] ?? 0, reviewed),
  ).length;

  if (!files || !prRef) {
    return (
      <StartPage
        prUrl={prUrl}
        onPrUrlChange={setPrUrl}
        onSubmit={loadPr}
        onOpenSaved={(ref) => navigate(pathFor(ref, "landing"))}
        loading={loading}
        error={error}
      />
    );
  }

  const viewOptions = (
    <ViewOptions
      hideWhitespace={hideWhitespace}
      onHideWhitespaceChange={setHideWhitespace}
      autoReviewTests={autoReviewTests}
      onAutoReviewTestsChange={(value) => {
        setAutoReviewTests(value);
        writeAutoReviewTests(value);
      }}
    />
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside
        style={{ width: sidebarWidth }}
        className="sticky top-0 flex h-screen shrink-0 flex-col border-r bg-sidebar"
      >
        <div className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pt-8 pb-6">
          <SidebarNav
            allSlices={allSlices}
            reviewed={reviewed}
            activeSliceId={view === "slice" ? activeSliceId : null}
            overviewActive={view === "landing"}
            allFilesActive={view === "files"}
            onSelectOverview={() => setView("landing")}
            onResumeSlices={resumeSlices}
            onSelectSlice={openSlice}
            onToggleSlice={toggleSlice}
            onSelectAllFiles={() => setView("files")}
            activeView={view}
            onSelectView={setView}
            sliceMarkers={sliceMarkers}
            yourFeedbackCount={feedback.yours?.items.filter((i) => i.included).length ?? 0}
            agentFeedbackCount={feedback.agent?.items.filter((i) => i.included).length ?? 0}
            busy={{
              "your-feedback": !!draftStatus.yours?.pending,
              "agent-feedback": agentReview?.status === "running",
              "post-review": !!prepareStatus.pending,
            }}
            reviewState={reviewDraft?.posted ? "posted" : reviewDraft ? "ready" : "none"}
          />

          {listedFiles.length > 0 && (
            <div className="border-t pt-6">
              <FileTree
                files={listedFiles}
                isFileChecked={isListedFileChecked}
                onToggleFile={toggleListedFile}
                onSelectFile={selectListedFile}
                notesFor={listedFileNotes}
                onOpenUnread={openUnreadIn}
              />
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={() => navigate("/")}
            title="Leave this PR and go back to the start page. Your progress is kept."
            className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-[15px] font-medium text-foreground/80 hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4 text-muted-foreground" />
            Exit review
          </button>
        </footer>
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startSidebarResize}
        onDoubleClick={() => {
          setSidebarWidth(SIDEBAR_DEFAULT);
          writeStoredSidebarWidth(SIDEBAR_DEFAULT);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const next = clampSidebarWidth(sidebarWidth + (e.key === "ArrowRight" ? 16 : -16));
          setSidebarWidth(next);
          writeStoredSidebarWidth(next);
        }}
        className="sticky top-0 z-20 -ml-1.5 h-screen w-3 shrink-0 cursor-col-resize outline-none after:mx-auto after:block after:h-full after:w-px after:bg-transparent after:transition-colors hover:after:bg-reviewed focus-visible:after:bg-reviewed"
      />

      <main className="-ml-1.5 flex h-screen min-w-0 flex-1 flex-col">
        {view === "slice" && activeSlice ? (
          <SliceView
            key={activeSlice.id}
            slice={activeSlice}
            files={files}
            hideWhitespace={hideWhitespace}
            viewOptions={viewOptions}
            prRef={prRef}
            reviewed={reviewed}
            index={activeSliceIndex}
            total={allSlices.length}
            onToggleSlice={toggleSlice}
            onSetHunksReviewed={setHunksReviewed}
            onMarkReviewed={markActiveSliceReviewed}
            onPrev={() => openSlice(allSlices[activeSliceIndex - 1]?.id)}
            onNext={() => openSlice(allSlices[activeSliceIndex + 1]?.id)}
            notes={notes}
            noteControls={noteControls}
            revealedFile={revealedFile}
            onRevealNote={(note) => revealFile(note.path, note.id)}
            fileNotes={fileNotes?.[activeSlice.id] ?? NO_FILE_NOTES}
            autoReviewedKeys={autoReviewedKeys}
            findings={feedback.agent?.items ?? NO_FINDINGS}
            onToggleFinding={(id) => toggleFeedbackItem("agent", id)}
          />
        ) : view === "landing" && preparing ? (
          <PreparingView
            prRef={prRef}
            title={prMeta?.title}
            fileCount={files.length}
            generation={generation}
            onStop={() => stopGeneration(prRef)}
            onResume={() => startGeneration(prRef, { firstRun: true, reuse: { slices, conversation, fileNotes } })}
          />
        ) : view === "your-feedback" ? (
          <YourFeedbackView
            notes={listedNotes}
            draft={feedback.yours}
            status={draftStatus.yours ?? {}}
            onDraft={() => draftFeedback("yours")}
            onToggle={(id) => toggleFeedbackItem("yours", id)}
            onOpenNote={openListedNote}
            renderContext={renderFeedbackContext}
          />
        ) : view === "agent-feedback" ? (
          <AgentFeedbackView
            pr={`${prRef.owner}/${prRef.repo}#${prRef.number}`}
            draft={feedback.agent}
            review={agentReview}
            error={agentError}
            onRunBuiltin={() => startAgentReview("builtin")}
            onUseOwnAgent={() => startAgentReview("external")}
            onStop={() => endAgentReview("stop")}
            onFinish={() => endAgentReview("finish")}
            onToggle={(id) => toggleFeedbackItem("agent", id)}
            onOpen={(item) => item.path && revealFile(item.path)}
            renderContext={renderFeedbackContext}
          />
        ) : view === "post-review" ? (
          <PostReviewView
            pr={`${prRef.owner}/${prRef.repo}#${prRef.number}`}
            candidates={reviewCandidates}
            draft={reviewDraft}
            status={prepareStatus}
            viewer={reviewer?.viewer}
            isOwnPr={!!reviewer && reviewer.viewer === reviewer.author}
            onPrepare={prepareReview}
            onUpdate={(update) => reviewDraft && saveReview(update(reviewDraft))}
            avatar={reviewer ? <Avatar login={reviewer.viewer} size="sm" /> : null}
            isInline={isInlineComment}
            onRestore={restoreDropped}
            onPreview={previewReview}
            onPost={postReview}
            onStartOver={() => saveReview(undefined)}
            renderContext={renderFeedbackContext}
          />
        ) : view === "files" ? (
          <AllFilesView
            files={files}
            reviewedFileCount={reviewedFileCount}
            isReviewed={(filename) => isFileReviewed(filename, fileHunkCounts[filename] ?? 0, reviewed)}
            hideWhitespace={hideWhitespace}
            viewOptions={viewOptions}
            prRef={prRef}
            onToggleFile={toggleFile}
            notes={notes}
            noteControls={noteControls}
            revealedFile={revealedFile}
            onRevealNote={(note) => revealFile(note.path, note.id)}
            findings={feedback.agent?.items ?? NO_FINDINGS}
            onToggleFinding={(id) => toggleFeedbackItem("agent", id)}
          />
        ) : (
          <LandingView
            prRef={prRef}
            prMeta={prMeta}
            generation={generation}
            onStopGeneration={() => stopGeneration(prRef)}
            summary={summary}
            conversation={conversation}
            onRegenerate={() => startGeneration(prRef, { firstRun: false })}
            hasSlices={slices !== null && slices.length > 0}
            hasProgress={Object.values(reviewed).some(Boolean)}
            onStartReviewing={resumeSlices}
          />
        )}
      </main>
    </div>
  );
}

export default App;
