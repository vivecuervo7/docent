import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { diffArrays } from "diff";
import { BookOpen, Check, CircleAlert, ChevronDown, ChevronRight, Files, Folder, Lightbulb, Image as ImageIcon, ListChecks, Loader2, LogOut, MessagesSquare, Package, SlidersHorizontal, Trash2, Wrench, type LucideIcon } from "lucide-react";
import {
  Decoration,
  Diff,
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
  deleteSavedPr,
  getPrRecord,
  listSavedPrs,
  markPrOpened,
  saveConversation as persistConversation,
  saveSlices as persistSlices,
  saveSummary as persistSummary,
  setHunksReviewed as persistReviewedHunks,
  type ConversationSummary,
  type ReplyOutcome,
  type ReviewerConversation,
  type Slice,
  type PrSummary,
  type SavedPr,
} from "./prDb";

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
// the summary waits for both so it can prefer them over a stale description.
type PipelineStep = "slices" | "conversation" | "summary";
type PipelineSteps = Record<PipelineStep, { status: "pending" | "active" | "done"; startedAt?: number }>;

// A background generation on the backend (see backend/src/generation.ts).
interface Generation {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "stopped";
  steps: PipelineSteps;
  results: { slices?: Slice[]; conversation?: ConversationSummary; summary?: PrSummary };
  error?: string;
}

function emptyGeneration(): Generation {
  return {
    id: "",
    status: "queued",
    steps: { slices: { status: "pending" }, conversation: { status: "pending" }, summary: { status: "pending" } },
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

function scrollToFile(filename: string) {
  document
    .getElementById(fileElementId(filename))
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
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
}: {
  entries: FileTreeEntry[];
  depth: number;
  isFileChecked: (filename: string) => boolean;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onToggleFile: (filename: string) => void;
  onSelectFile: (filename: string) => void;
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
                />
              )}
            </div>
          );
        }

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
}: {
  files: PrFile[];
  isFileChecked: (filename: string) => boolean;
  onToggleFile: (filename: string) => void;
  onSelectFile: (filename: string) => void;
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
// file's patch into hunks, lazily fetches old-file context for syntax
// highlighting, and tokenizes. `enabled` gates the (relatively expensive)
// context fetch + tokenize pass so a collapsed file in the full list skips
// both until expanded.
function useDiffRender(file: PrFile, hideWhitespace: boolean, prRef: PrRef, enabled: boolean) {
  const { hunks, diffType } = useMemo((): { hunks?: HunkData[]; diffType: DiffType } => {
    if (!file.patch) return { hunks: undefined, diffType: "modify" };
    try {
      const [parsed] = parseDiff(buildDiffText(file));
      let hunks = parsed?.hunks;
      if (hunks && hideWhitespace) hunks = collapseWhitespaceOnlyChanges(hunks);
      return { hunks, diffType: (parsed?.type as DiffType) ?? "modify" };
    } catch {
      return { hunks: undefined, diffType: "modify" };
    }
  }, [file, hideWhitespace]);

  const language = useMemo(() => languageForFilename(file.filename), [file.filename]);

  // Fetched lazily, only once enabled and there's a language worth
  // highlighting, since it's the full old file's content, not just the diff.
  const [oldContent, setOldContent] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled || !hunks || !language || file.status === "added") return;
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
  }, [enabled, hunks, language, file, prRef, oldContent]);

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

  return { hunks, diffType, tokens };
}

function SliceFileSection({
  file,
  hunkIndices,
  hideWhitespace,
  prRef,
  reviewed,
  onSetHunksReviewed,
}: {
  file: PrFile;
  hunkIndices: number[];
  hideWhitespace: boolean;
  prRef: PrRef;
  reviewed: Record<string, boolean>;
  onSetHunksReviewed: (keys: string[], value: boolean) => void;
}) {
  const { hunks, diffType, tokens } = useDiffRender(file, hideWhitespace, prRef, true);
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

  const displayed = useMemo(() => {
    if (!hunks) return [];
    return hunkIndices
      .map((index) => ({ index, hunk: hunks[index] }))
      .filter((h): h is { index: number; hunk: HunkData } => !!h.hunk);
  }, [hunks, hunkIndices]);

  return (
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
        <span
          title={`This slice shows ${hunkIndices.length} of this file's ${hunks?.length ?? hunkIndices.length} hunks`}
          className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
        >
          {hunkIndices.length}/{hunks?.length ?? hunkIndices.length} hunks
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={fileReviewed}
            onCheckedChange={() => onSetHunksReviewed(keys, !fileReviewed)}
          />
          Reviewed
        </label>
      </div>
      {!fileCollapsed &&
        (displayed.length > 0 ? (
          <div className="overflow-x-auto text-xs">
            <Diff
              viewType="unified"
              diffType={diffType}
              hunks={displayed.map((d) => d.hunk)}
              tokens={tokens}
            >
              {() =>
                displayed.flatMap(({ index, hunk }) => {
                  const key = hunkKey(index);
                  const isReviewed = !!reviewed[key];
                  return [
                    <Decoration key={`decoration-${key}`}>
                      <div
                        className={cn(
                          "flex items-center gap-2 bg-[rgba(56,139,253,0.08)] px-4 py-1.5 font-mono text-xs",
                          isReviewed ? "text-muted-foreground" : "text-[#79c0ff]",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{hunk.content}</span>
                        {isReviewed && <Check className="size-3.5 shrink-0 text-reviewed" />}
                      </div>
                    </Decoration>,
                    <Hunk key={key} hunk={hunk} />,
                  ];
                })
              }
            </Diff>
          </div>
        ) : (
          <div className="p-4 text-sm italic text-muted-foreground">No matching hunks.</div>
        ))}
    </Card>
  );
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
}) {
  const byFile = useMemo(() => groupHunkRefsByFile(slice.hunks), [slice]);
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
                <p className="truncate text-sm text-muted-foreground">{slice.summary}</p>
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
              <p className="mt-4 text-[17px] leading-[1.65] text-foreground">
                {slice.summary}
              </p>
            )}
          </>
        )}
      </header>
      <div
        onScroll={onScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pb-12 [scrollbar-gutter:stable]"
      >
        <div className="flex flex-col gap-6">
          <div className="-mb-2 flex justify-end">{viewOptions}</div>
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
              />
            );
          })}
        </div>
      </div>
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
              </li>
            );
          })}
        </ol>
      </div>

      <div className={cn(rowClass(allFilesActive), "mt-2")}>
        <Files className={topLevelIcon} />
        <button type="button" onClick={onSelectAllFiles} className={topLevelClass(allFilesActive)}>
          All files
        </button>
      </div>
    </nav>
  );
}

function ViewOptions({
  hideWhitespace,
  onHideWhitespaceChange,
}: {
  hideWhitespace: boolean;
  onHideWhitespaceChange: (value: boolean) => void;
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
        <div className="absolute top-full right-0 z-20 mt-1 w-48 rounded-lg border bg-popover p-1.5 shadow-lg">
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={hideWhitespace} onCheckedChange={onHideWhitespaceChange} />
            Hide whitespace
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
        list.push({ owner, repo, number, record: { reviewed: {}, slices: null, summary: null, conversation: null } });
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
    <div className="scrollbar-thin h-screen overflow-y-auto px-6 [scrollbar-gutter:stable]">
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
        <p className={cn("mt-1 text-[15px] leading-relaxed", muted && "text-muted-foreground")}>
          {children}
        </p>
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
        {entry.summary}
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
                  {reply.summary}
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
                    <p className="mt-3 text-[17px] leading-[1.65]">{section.body}</p>
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
                      {conversation.authorNotes}
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
}: {
  file: PrFile;
  reviewed: boolean;
  hideWhitespace: boolean;
  prRef: PrRef;
  onToggle: () => void;
}) {
  const [collapsed, setCollapsed] = useState(reviewed);
  const wasReviewed = useRef(reviewed);

  useEffect(() => {
    if (wasReviewed.current !== reviewed) {
      setCollapsed(reviewed);
    }
    wasReviewed.current = reviewed;
  }, [reviewed]);

  const { hunks, diffType, tokens } = useDiffRender(file, hideWhitespace, prRef, !collapsed);

  return (
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
            <Diff viewType="unified" diffType={diffType} hunks={hunks} tokens={tokens}>
              {(hunks) =>
                hunks.flatMap((hunk) => [
                  <Decoration key={`decoration-${hunk.content}`}>
                    <div className="bg-[rgba(56,139,253,0.1)] px-4 py-1.5 font-mono text-xs text-[#79c0ff]">
                      {hunk.content}
                    </div>
                  </Decoration>,
                  <Hunk key={hunk.content} hunk={hunk} />,
                ])
              }
            </Diff>
          </div>
        ) : (
          <div className="p-4 text-sm italic text-muted-foreground">
            No diff available for this file.
          </div>
        ))}
    </Card>
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

const STORAGE_KEY = "docent:last-pr-url";

function readStoredPrUrl(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredPrUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    // ignore, e.g. private browsing
  }
}

function clearStoredPrUrl() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
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

type View = "landing" | "slice" | "files";

function App() {
  const [prUrl, setPrUrl] = useState("");
  const [prRef, setPrRef] = useState<PrRef | null>(null);
  const [prMeta, setPrMeta] = useState<PrMeta | null>(null);
  const [files, setFiles] = useState<PrFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [slices, setSlices] = useState<Slice[] | null>(null);
  const [summary, setSummary] = useState<PrSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  // The latest status of this PR's background generation, if it has one
  // that hasn't been collected yet (running, queued, stopped or failed).
  const [generation, setGeneration] = useState<Generation | null>(null);
  // True while a PR is being generated for the first time (or retried after
  // that failed): the overview shows the preparation screen instead of a
  // half-empty page. A regenerate of an existing review keeps the overview.
  const [preparing, setPreparing] = useState(false);
  const [view, setView] = useState<View>("landing");
  const [activeSliceId, setActiveSliceId] = useState<string | null>(null);
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
  const activeSliceIndex = activeSliceId ? allSlices.findIndex((i) => i.id === activeSliceId) : -1;
  const activeSlice = activeSliceIndex >= 0 ? allSlices[activeSliceIndex] : null;

  const generationUrl = (ref: PrRef) => generationUrlFor(ref.owner, ref.repo, ref.number);

  // Results the browser has already copied out of the current generation, so
  // each one is saved once however many times it's polled.
  const collected = useRef<{ id: string; steps: Set<PipelineStep> } | null>(null);

  function collectGeneration(ref: PrRef, next: Generation) {
    if (collected.current?.id !== next.id) collected.current = { id: next.id, steps: new Set() };
    const done = collected.current.steps;
    const { slices, conversation, summary } = next.results;
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
      reuse?: { slices: Slice[] | null; conversation: ConversationSummary | null };
    },
  ) {
    setPreparing(firstRun);
    try {
      const res = await fetch(generationUrl(ref), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reuse: { slices: reuse?.slices, conversation: reuse?.conversation } }),
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
    setActiveSliceId(null);
    setView("landing");

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
      writeStoredPrUrl(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`);
      markPrOpened(ref.owner, ref.repo, ref.number, meta?.title).catch(() => {});

      const existing = generationRes.generation;
      if (existing) {
        // A generation from an earlier visit: pick up what it finished while
        // we were away. A stopped or failed one stays that way until resumed.
        setPreparing(!prRecord.summary && !existing.results.summary);
        collectGeneration(ref, existing);
      } else if (!prRecord.slices || !prRecord.conversation || !prRecord.summary) {
        startGeneration(ref, {
          firstRun: !prRecord.summary,
          reuse: { slices: prRecord.slices, conversation: prRecord.conversation },
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPr(e: FormEvent) {
    e.preventDefault();
    const ref = parsePrUrl(prUrl);
    if (!ref) {
      setError("Enter a GitHub PR URL, e.g. https://github.com/owner/repo/pull/123");
      return;
    }
    await loadPrByRef(ref);
  }

  useEffect(() => {
    const stored = readStoredPrUrl();
    if (!stored) return;
    const ref = parsePrUrl(stored);
    if (!ref) return;
    setPrUrl(stored);
    loadPrByRef(ref);
    // Only ever run once, on mount, to restore the last loaded PR.
  }, []);

  function clearPr() {
    clearStoredPrUrl();
    setPrUrl("");
    setPrRef(null);
    setPrMeta(null);
    setFiles(null);
    setReviewed({});
    setSlices(null);
    setSummary(null);
    setConversation(null);
    setGeneration(null);
    setPreparing(false);
    setActiveSliceId(null);
    setView("landing");
    setError(null);
  }

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
    if (next) setActiveSliceId(next.id);
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

  const pendingFileScroll = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "files" || !pendingFileScroll.current) return;
    const filename = pendingFileScroll.current;
    pendingFileScroll.current = null;
    requestAnimationFrame(() => scrollToFile(filename));
  }, [view]);

  function selectListedFile(filename: string) {
    if (view === "slice" || view === "files") {
      scrollToFile(filename);
      return;
    }
    pendingFileScroll.current = filename;
    setView("files");
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

  function toggleListedFile(filename: string) {
    setHunksReviewed(listedFileKeys(filename), !isListedFileChecked(filename));
  }

  function resumeSlices() {
    const next = allSlices.find((slice) => !isSliceReviewed(slice, reviewed)) ?? allSlices[0];
    if (!next) {
      setView("landing");
      return;
    }
    setActiveSliceId(next.id);
    setView("slice");
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
        onOpenSaved={(ref) => {
          setPrUrl(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`);
          loadPrByRef(ref);
        }}
        loading={loading}
        error={error}
      />
    );
  }

  const viewOptions = (
    <ViewOptions hideWhitespace={hideWhitespace} onHideWhitespaceChange={setHideWhitespace} />
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
            onSelectSlice={(id) => {
              setActiveSliceId(id);
              setView("slice");
            }}
            onToggleSlice={toggleSlice}
            onSelectAllFiles={() => setView("files")}
          />

          {listedFiles.length > 0 && (
            <div className="border-t pt-6">
              <FileTree
                files={listedFiles}
                isFileChecked={isListedFileChecked}
                onToggleFile={toggleListedFile}
                onSelectFile={selectListedFile}
              />
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={clearPr}
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
            onPrev={() => setActiveSliceId(allSlices[activeSliceIndex - 1]?.id ?? null)}
            onNext={() => setActiveSliceId(allSlices[activeSliceIndex + 1]?.id ?? null)}
          />
        ) : view === "landing" && preparing ? (
          <PreparingView
            prRef={prRef}
            title={prMeta?.title}
            fileCount={files.length}
            generation={generation}
            onStop={() => stopGeneration(prRef)}
            onResume={() => startGeneration(prRef, { firstRun: true, reuse: { slices, conversation } })}
          />
        ) : view === "files" ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="shrink-0 px-10 pt-10 pb-6">
              <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight">All files</h2>
              <p className="mt-2 text-[15px] text-muted-foreground tabular-nums">
                {reviewedFileCount} of {files.length} files reviewed
              </p>
            </header>
            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-10 pb-12 [scrollbar-gutter:stable]">
              <div className="flex flex-col gap-4">
                <div className="-mb-2 flex justify-end">{viewOptions}</div>
                {files.map((file) => (
                  <FileDiff
                    key={file.filename}
                    file={file}
                    reviewed={isFileReviewed(file.filename, fileHunkCounts[file.filename] ?? 0, reviewed)}
                    hideWhitespace={hideWhitespace}
                    prRef={prRef}
                    onToggle={() => toggleFile(file.filename)}
                  />
                ))}
              </div>
            </div>
          </div>
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
