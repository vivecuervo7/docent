import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type UIEvent } from "react";
import { diffArrays } from "diff";
import { BookOpen, Check, ChevronDown, ChevronRight, Files, Folder, Lightbulb, Image as ImageIcon, ListChecks, LogOut, MessagesSquare, Package, SlidersHorizontal, Wrench, type LucideIcon } from "lucide-react";
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
  getPrRecord,
  saveConversation as persistConversation,
  saveIdeas as persistIdeas,
  saveSummary as persistSummary,
  setHunksReviewed as persistReviewedHunks,
  type ConversationSummary,
  type ReplyOutcome,
  type ReviewerConversation,
  type Idea,
  type PrSummary,
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

type PipelineStage = "ideas" | "summary" | "conversation" | null;

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

function isIdeaReviewed(idea: Idea, reviewed: Record<string, boolean>): boolean {
  return idea.hunks.length > 0 && idea.hunks.every((k) => reviewed[k]);
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

// Shared by the full per-file view and the single-idea view: parses a
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

function IdeaFileSection({
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
  // Scoped to the hunks this idea shows - the file may have others that
  // belong to different ideas.
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
          title={`This idea shows ${hunkIndices.length} of this file's ${hunks?.length ?? hunkIndices.length} hunks`}
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

function IdeaView({
  idea,
  files,
  hideWhitespace,
  viewOptions,
  prRef,
  reviewed,
  index,
  total,
  onToggleIdea,
  onSetHunksReviewed,
  onMarkReviewed,
  onPrev,
  onNext,
}: {
  idea: Idea;
  files: PrFile[];
  hideWhitespace: boolean;
  viewOptions: ReactNode;
  prRef: PrRef;
  reviewed: Record<string, boolean>;
  index: number;
  total: number;
  onToggleIdea: (idea: Idea) => void;
  onSetHunksReviewed: (keys: string[], value: boolean) => void;
  onMarkReviewed: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const byFile = useMemo(() => groupHunkRefsByFile(idea.hunks), [idea]);
  const orderedFileGroups = useMemo(() => orderFileGroups(byFile, files), [byFile, files]);
  const done = isIdeaReviewed(idea, reviewed);
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
        <Button variant="outline" size={compact ? "sm" : "default"} onClick={() => onToggleIdea(idea)}>
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
              <h2 className="truncate text-base font-semibold">{idea.title}</h2>
              {idea.summary && (
                <p className="truncate text-sm text-muted-foreground">{idea.summary}</p>
              )}
            </div>
            {actions}
          </div>
        ) : (
          <>
            <div className="mb-12 flex justify-end">{actions}</div>
            <h2 className="text-[28px] leading-[1.2] font-semibold tracking-tight text-balance">
              {idea.title}
            </h2>
            {idea.summary && (
              <p className="mt-4 text-[17px] leading-[1.65] text-foreground">
                {idea.summary}
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
              <IdeaFileSection
                key={`${idea.id}:${filename}`}
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
  allIdeas,
  reviewed,
  loading,
  activeIdeaId,
  overviewActive,
  allFilesActive,
  onSelectOverview,
  onResumeIdeas,
  onSelectIdea,
  onToggleIdea,
  onSelectAllFiles,
}: {
  allIdeas: Idea[];
  reviewed: Record<string, boolean>;
  loading: boolean;
  activeIdeaId: string | null;
  overviewActive: boolean;
  allFilesActive: boolean;
  onSelectOverview: () => void;
  onResumeIdeas: () => void;
  onSelectIdea: (id: string) => void;
  onToggleIdea: (idea: Idea) => void;
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
  const ideaLabelClass = (active: boolean) =>
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
            onClick={onResumeIdeas}
            disabled={allIdeas.length === 0}
            title="Go to the first idea you haven't reviewed"
            className={topLevelClass(false)}
          >
            Ideas
          </button>
        </div>
        <ol className="flex flex-col gap-0.5 pl-3">
          {allIdeas.length === 0 ? (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">
              {loading ? "Breaking the PR into ideas…" : "No ideas yet."}
            </li>
          ) : (
            allIdeas.map((idea) => {
              const done = isIdeaReviewed(idea, reviewed);
              const current = activeIdeaId === idea.id;
              return (
                <li key={idea.id} className={rowClass(current)}>
                  <button
                    type="button"
                    onClick={() => onToggleIdea(idea)}
                    aria-label={done ? `Mark "${idea.title}" unreviewed` : `Mark "${idea.title}" reviewed`}
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
                  <button type="button" onClick={() => onSelectIdea(idea.id)} className={ideaLabelClass(current)}>
                    {idea.title}
                  </button>
                </li>
              );
            })
          )}
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

function StartPage({
  prUrl,
  onPrUrlChange,
  onSubmit,
  loading,
  error,
}: {
  prUrl: string;
  onPrUrlChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={onSubmit} className="flex w-full max-w-xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Review a pull request</h1>
        <p className="text-sm text-muted-foreground">
          Paste a GitHub PR link. It'll be broken into ideas you can review one at a time.
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

function LandingView({
  prRef,
  prMeta,
  pipelineStage,
  summary,
  conversation,
  onRegenerate,
  hasIdeas,
  hasProgress,
  onStartReviewing,
}: {
  prRef: PrRef;
  prMeta: PrMeta | null;
  pipelineStage: PipelineStage;
  summary: PrSummary | null;
  conversation: ConversationSummary | null;
  onRegenerate: () => void;
  hasIdeas: boolean;
  hasProgress: boolean;
  onStartReviewing: () => void;
}) {
  const stageLabel =
    pipelineStage === "ideas"
      ? "Breaking the PR into ideas…"
      : pipelineStage === "summary"
        ? "Summarizing the PR…"
        : pipelineStage === "conversation"
          ? "Reading the conversation…"
          : null;

  const links = useMemo(() => extractLinks(prMeta?.body ?? null), [prMeta]);
  const imageLinks = useMemo(() => links.filter((l) => l.isImage), [links]);
  const plainLinks = useMemo(() => links.filter((l) => !l.isImage), [links]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

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
      {/* Same header shape as an idea, so the actions sit where Mark reviewed does. */}
      <header className="flex shrink-0 justify-end gap-2 border-b border-transparent px-10 pt-10">
        <Button variant="outline" onClick={onRegenerate} disabled={pipelineStage !== null}>
          {pipelineStage !== null ? "Generating…" : "Regenerate review"}
        </Button>
        {prMeta && (
          <a href={prMeta.htmlUrl} target="_blank" rel="noreferrer">
            <Button variant="outline">View in GitHub</Button>
          </a>
        )}
        {hasIdeas && (
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
            <p className="mt-4 flex items-center gap-2.5 text-[15px] text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-reviewed motion-reduce:animate-none" />
              {stageLabel}
            </p>
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
              : pipelineStage === null && (
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

          <section className="mt-16 border-t pt-14">
            <h2 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <MessagesSquare className="size-5 text-muted-foreground" strokeWidth={2.25} />
              Conversation
            </h2>
            {conversation && (conversation.reviewers.length > 0 || conversation.authorNotes) ? (
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
              pipelineStage === null && (
                <p className="mt-3 text-[15px] text-muted-foreground">
                  {conversation ? "No reviews or comments yet." : "Regenerate the review to summarize the conversation."}
                </p>
              )
            )}
          </section>
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

type View = "landing" | "idea" | "files";

function App() {
  const [prUrl, setPrUrl] = useState("");
  const [prRef, setPrRef] = useState<PrRef | null>(null);
  const [prMeta, setPrMeta] = useState<PrMeta | null>(null);
  const [files, setFiles] = useState<PrFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [summary, setSummary] = useState<PrSummary | null>(null);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>(null);
  const [view, setView] = useState<View>("landing");
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
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

  const everythingElse = useMemo((): Idea => {
    const claimed = new Set((ideas ?? []).flatMap((idea) => idea.hunks));
    const hunks = (files ?? []).flatMap((file) =>
      fileHunkKeys(file.filename, fileHunkCounts[file.filename] ?? 0).filter((k) => !claimed.has(k)),
    );
    return {
      id: "everything-else",
      title: "Everything else",
      summary: "Hunks not covered by any idea above.",
      hunks,
    };
  }, [files, ideas, fileHunkCounts]);

  const allIdeas = useMemo(
    () => (everythingElse.hunks.length > 0 ? [...(ideas ?? []), everythingElse] : (ideas ?? [])),
    [ideas, everythingElse],
  );
  const activeIdeaIndex = activeIdeaId ? allIdeas.findIndex((i) => i.id === activeIdeaId) : -1;
  const activeIdea = activeIdeaIndex >= 0 ? allIdeas[activeIdeaIndex] : null;

  async function fetchIdeasFor(ref: PrRef): Promise<Idea[]> {
    const res = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/ideas`, {
      method: "POST",
    });
    const body = await res.json();
    const ideas: Idea[] = body.ideas ?? [];
    await persistIdeas(ref.owner, ref.repo, ref.number, ideas);
    return ideas;
  }

  async function fetchSummaryFor(ref: PrRef, ideasForSummary: Idea[]): Promise<PrSummary | null> {
    const res = await fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/overview/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideas: ideasForSummary }),
    });
    const body = await res.json();
    if (!body.summary) return null;
    const { what, why, how } = body.summary;
    const summary = { what, why, how };
    await persistSummary(ref.owner, ref.repo, ref.number, summary);
    return summary;
  }

  async function fetchConversationFor(ref: PrRef): Promise<ConversationSummary | null> {
    const res = await fetch(
      `/api/pr/${ref.owner}/${ref.repo}/${ref.number}/overview/conversation`,
      { method: "POST" },
    );
    const body = await res.json();
    const conversation: ConversationSummary | undefined = body.conversation;
    if (!conversation) return null;
    await persistConversation(ref.owner, ref.repo, ref.number, conversation);
    return conversation;
  }

  async function runFullPipeline(ref: PrRef) {
    setPipelineStage("ideas");
    const generatedIdeas = await fetchIdeasFor(ref);
    setIdeas(generatedIdeas);
    setPipelineStage("summary");
    setSummary(await fetchSummaryFor(ref, generatedIdeas));
    setPipelineStage("conversation");
    setConversation(await fetchConversationFor(ref));
    setPipelineStage(null);
  }

  async function loadPrByRef(ref: PrRef) {
    setError(null);
    setLoading(true);
    setFiles(null);
    setPrMeta(null);
    setIdeas(null);
    setSummary(null);
    setConversation(null);
    setActiveIdeaId(null);
    setView("landing");

    try {
      const [filesRes, prRecord] = await Promise.all([
        fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}`),
        getPrRecord(ref.owner, ref.repo, ref.number),
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
      setIdeas(prRecord.ideas);
      setSummary(prRecord.summary);
      setConversation(prRecord.conversation);
      writeStoredPrUrl(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`);

      if (!prRecord.ideas) {
        // Fire and forget - this can take minutes; don't block the initial load on it.
        runFullPipeline(ref);
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
    setIdeas(null);
    setSummary(null);
    setConversation(null);
    setPipelineStage(null);
    setActiveIdeaId(null);
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

  function toggleIdea(idea: Idea) {
    setHunksReviewed(idea.hunks, !isIdeaReviewed(idea, reviewed));
  }

  // Marking an idea reviewed moves straight on to the next one; Next alone
  // moves on without marking, which is why there's no separate Skip.
  function markActiveIdeaReviewed() {
    if (!activeIdea) return;
    setHunksReviewed(activeIdea.hunks, true);
    const next = allIdeas[activeIdeaIndex + 1];
    if (next) setActiveIdeaId(next.id);
  }

  useEffect(() => {
    if (view !== "idea" || !activeIdea) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, button, a, [role=button], [contenteditable]")) return;
      if (activeIdea && isIdeaReviewed(activeIdea, reviewed)) return;
      e.preventDefault();
      markActiveIdeaReviewed();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // The sidebar's file list follows the view: in an idea it lists just that
  // idea's files and scrolls within the idea; anywhere else it lists every
  // file, and picking one opens All files at that file.
  const fileListMode: "idea" | "all" = view === "idea" && activeIdea ? "idea" : "all";
  const ideaHunkKeysByFile = useMemo(() => {
    const byFile = new Map<string, string[]>();
    if (!activeIdea) return byFile;
    for (const [filename, indices] of groupHunkRefsByFile(activeIdea.hunks)) {
      byFile.set(filename, indices.map((i) => `${filename}#${i}`));
    }
    return byFile;
  }, [activeIdea]);
  const listedFiles =
    fileListMode === "idea"
      ? (files ?? []).filter((f) => ideaHunkKeysByFile.has(f.filename))
      : (files ?? []);

  const pendingFileScroll = useRef<string | null>(null);
  useEffect(() => {
    if (view !== "files" || !pendingFileScroll.current) return;
    const filename = pendingFileScroll.current;
    pendingFileScroll.current = null;
    requestAnimationFrame(() => scrollToFile(filename));
  }, [view]);

  function selectListedFile(filename: string) {
    if (view === "idea" || view === "files") {
      scrollToFile(filename);
      return;
    }
    pendingFileScroll.current = filename;
    setView("files");
  }

  // In an idea, a file's checkbox covers only the hunks that idea shows -
  // the same scope as the file's own header - so it agrees with what's on
  // screen even when the file's other hunks belong to other ideas.
  function listedFileKeys(filename: string): string[] {
    if (fileListMode === "idea") return ideaHunkKeysByFile.get(filename) ?? [];
    return fileHunkKeys(filename, fileHunkCounts[filename] ?? 0);
  }

  function isListedFileChecked(filename: string): boolean {
    const keys = listedFileKeys(filename);
    return keys.length > 0 && keys.every((k) => reviewed[k]);
  }

  function toggleListedFile(filename: string) {
    setHunksReviewed(listedFileKeys(filename), !isListedFileChecked(filename));
  }

  function resumeIdeas() {
    const next = allIdeas.find((idea) => !isIdeaReviewed(idea, reviewed)) ?? allIdeas[0];
    if (!next) return;
    setActiveIdeaId(next.id);
    setView("idea");
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
            allIdeas={allIdeas}
            reviewed={reviewed}
            loading={pipelineStage === "ideas"}
            activeIdeaId={view === "idea" ? activeIdeaId : null}
            overviewActive={view === "landing"}
            allFilesActive={view === "files"}
            onSelectOverview={() => setView("landing")}
            onResumeIdeas={resumeIdeas}
            onSelectIdea={(id) => {
              setActiveIdeaId(id);
              setView("idea");
            }}
            onToggleIdea={toggleIdea}
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
        {view === "idea" && activeIdea ? (
          <IdeaView
            key={activeIdea.id}
            idea={activeIdea}
            files={files}
            hideWhitespace={hideWhitespace}
            viewOptions={viewOptions}
            prRef={prRef}
            reviewed={reviewed}
            index={activeIdeaIndex}
            total={allIdeas.length}
            onToggleIdea={toggleIdea}
            onSetHunksReviewed={setHunksReviewed}
            onMarkReviewed={markActiveIdeaReviewed}
            onPrev={() => setActiveIdeaId(allIdeas[activeIdeaIndex - 1]?.id ?? null)}
            onNext={() => setActiveIdeaId(allIdeas[activeIdeaIndex + 1]?.id ?? null)}
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
            pipelineStage={pipelineStage}
            summary={summary}
            conversation={conversation}
            onRegenerate={() => runFullPipeline(prRef)}
            hasIdeas={ideas !== null && ideas.length > 0}
            hasProgress={Object.values(reviewed).some(Boolean)}
            onStartReviewing={resumeIdeas}
          />
        )}
      </main>
    </div>
  );
}

export default App;
