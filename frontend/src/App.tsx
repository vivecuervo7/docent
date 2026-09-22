import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { diffArrays } from "diff";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";

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

interface Idea {
  id: string;
  title: string;
  summary: string;
  hunks: string[];
}

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
  fileHunkCounts,
  reviewed,
  collapsedFolders,
  onToggleFolder,
  onToggleFile,
}: {
  entries: FileTreeEntry[];
  depth: number;
  fileHunkCounts: Record<string, number>;
  reviewed: Record<string, boolean>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onToggleFile: (filename: string) => void;
}) {
  return (
    <>
      {entries.map((entry) => {
        const indent = 8 + depth * 14;

        if (entry.type === "folder") {
          const isCollapsed = collapsedFolders.has(entry.path);
          return (
            <div key={entry.path}>
              <button
                type="button"
                onClick={() => onToggleFolder(entry.path)}
                style={{ paddingLeft: indent }}
                className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-3 text-left text-xs whitespace-nowrap text-muted-foreground hover:bg-muted"
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
                  fileHunkCounts={fileHunkCounts}
                  reviewed={reviewed}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  onToggleFile={onToggleFile}
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
            onClick={() => scrollToFile(entry.file.filename)}
            onKeyDown={(e) => {
              if (e.key === "Enter") scrollToFile(entry.file.filename);
            }}
            title={entry.file.filename}
            style={{ paddingLeft: indent }}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md py-1.5 pr-3 text-xs whitespace-nowrap hover:bg-muted"
          >
            <span onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={isFileReviewed(
                  entry.file.filename,
                  fileHunkCounts[entry.file.filename] ?? 0,
                  reviewed,
                )}
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

function TableOfContents({
  files,
  fileHunkCounts,
  reviewed,
  onToggleFile,
}: {
  files: PrFile[];
  fileHunkCounts: Record<string, number>;
  reviewed: Record<string, boolean>;
  onToggleFile: (filename: string) => void;
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
    <nav className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        Files
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex w-max min-w-full flex-col gap-0.5 p-1">
          <FileTreeNodes
            entries={tree.children}
            depth={0}
            fileHunkCounts={fileHunkCounts}
            reviewed={reviewed}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            onToggleFile={onToggleFile}
          />
        </div>
      </ScrollArea>
    </nav>
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
}: {
  file: PrFile;
  hunkIndices: number[];
  hideWhitespace: boolean;
  prRef: PrRef;
}) {
  const { hunks, diffType, tokens } = useDiffRender(file, hideWhitespace, prRef, true);

  const displayedHunks = useMemo(() => {
    if (!hunks) return undefined;
    return hunkIndices.map((i) => hunks[i]).filter((h): h is HunkData => !!h);
  }, [hunks, hunkIndices]);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-b bg-muted/50 px-4 py-2 font-mono text-xs font-medium">
        {file.filename}
      </div>
      {displayedHunks && displayedHunks.length > 0 ? (
        <div className="overflow-x-auto text-xs">
          <Diff viewType="unified" diffType={diffType} hunks={displayedHunks} tokens={tokens}>
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
        <div className="p-4 text-sm italic text-muted-foreground">No matching hunks.</div>
      )}
    </Card>
  );
}

function IdeaView({
  idea,
  files,
  hideWhitespace,
  prRef,
  reviewed,
  index,
  total,
  onToggleIdea,
  onPrev,
  onNext,
  onClose,
}: {
  idea: Idea;
  files: PrFile[];
  hideWhitespace: boolean;
  prRef: PrRef;
  reviewed: Record<string, boolean>;
  index: number;
  total: number;
  onToggleIdea: (idea: Idea) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const byFile = useMemo(() => groupHunkRefsByFile(idea.hunks), [idea]);
  const orderedFileGroups = useMemo(() => orderFileGroups(byFile, files), [byFile, files]);
  const done = isIdeaReviewed(idea, reviewed);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPrev} disabled={index === 0}>
          Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          Idea {index + 1} / {total}
        </span>
        <Button variant="outline" size="sm" onClick={onNext} disabled={index === total - 1}>
          Next
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto">
          Back to files
        </Button>
      </div>
      <Card className="gap-2 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{idea.title}</div>
            <p className="mt-1 text-sm text-muted-foreground">{idea.summary}</p>
          </div>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox checked={done} onCheckedChange={() => onToggleIdea(idea)} />
            Reviewed
          </label>
        </div>
      </Card>
      {orderedFileGroups.map(([filename, hunkIndices]) => {
        const file = files.find((f) => f.filename === filename);
        if (!file) return null;
        return (
          <IdeaFileSection
            key={filename}
            file={file}
            hunkIndices={hunkIndices}
            hideWhitespace={hideWhitespace}
            prRef={prRef}
          />
        );
      })}
    </div>
  );
}

function IdeasPanel({
  ideas,
  everythingElse,
  reviewed,
  loading,
  activeIdeaId,
  onGenerate,
  onSelectIdea,
  onToggleIdea,
}: {
  ideas: Idea[] | null;
  everythingElse: Idea;
  reviewed: Record<string, boolean>;
  loading: boolean;
  activeIdeaId: string | null;
  onGenerate: () => void;
  onSelectIdea: (id: string) => void;
  onToggleIdea: (idea: Idea) => void;
}) {
  const all = everythingElse.hunks.length > 0 ? [...(ideas ?? []), everythingElse] : (ideas ?? []);

  return (
    <div className="flex flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">Ideas</span>
        <Button size="sm" variant="outline" onClick={onGenerate} disabled={loading}>
          {loading ? "Generating…" : ideas ? "Regenerate" : "Generate"}
        </Button>
      </div>
      {all.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">
          {loading ? "Decomposing PR into ideas…" : "No ideas generated yet."}
        </div>
      ) : (
        <div className="flex flex-col gap-0.5 p-1">
          {all.map((idea) => {
            const doneCount = idea.hunks.filter((k) => reviewed[k]).length;
            const done = doneCount === idea.hunks.length;
            return (
              <button
                key={idea.id}
                type="button"
                onClick={() => onSelectIdea(idea.id)}
                className={cn(
                  "flex flex-col gap-1 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                  activeIdeaId === idea.id && "bg-muted",
                )}
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={done} onCheckedChange={() => onToggleIdea(idea)} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{idea.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {doneCount}/{idea.hunks.length}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
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
    if (!wasReviewed.current && reviewed) {
      setCollapsed(true);
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

const STORAGE_KEY = "codetour-pr:last-pr-url";

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

function App() {
  const [prUrl, setPrUrl] = useState("");
  const [prRef, setPrRef] = useState<PrRef | null>(null);
  const [files, setFiles] = useState<PrFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [activeIdeaId, setActiveIdeaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideWhitespace, setHideWhitespace] = useState(true);

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

  async function loadPrByRef(ref: PrRef) {
    setError(null);
    setLoading(true);
    setFiles(null);
    setIdeas(null);
    setActiveIdeaId(null);

    try {
      const [filesRes, reviewRes, ideasRes] = await Promise.all([
        fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}`),
        fetch(`/api/review/${ref.owner}/${ref.repo}/${ref.number}`),
        fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}/ideas`),
      ]);
      if (!filesRes.ok) {
        const body = await filesRes.json();
        throw new Error(body.error ?? "Failed to fetch PR");
      }
      const { files } = await filesRes.json();
      const reviewState = await reviewRes.json();
      const ideasState = await ideasRes.json();
      setPrRef(ref);
      setFiles(files);
      setReviewed(reviewState);
      setIdeas(ideasState.ideas ?? null);
      writeStoredPrUrl(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`);
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
    setFiles(null);
    setReviewed({});
    setIdeas(null);
    setActiveIdeaId(null);
    setError(null);
  }

  async function setHunksReviewed(keys: string[], value: boolean) {
    if (!prRef || keys.length === 0) return;
    setReviewed((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = value;
      return next;
    });
    await fetch(`/api/review/${prRef.owner}/${prRef.repo}/${prRef.number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, reviewed: value }),
    });
  }

  function toggleFile(filename: string) {
    const keys = fileHunkKeys(filename, fileHunkCounts[filename] ?? 0);
    const currentlyReviewed = keys.every((k) => reviewed[k]);
    setHunksReviewed(keys, !currentlyReviewed);
  }

  function toggleIdea(idea: Idea) {
    setHunksReviewed(idea.hunks, !isIdeaReviewed(idea, reviewed));
  }

  async function generateIdeas() {
    if (!prRef) return;
    setIdeasLoading(true);
    try {
      const res = await fetch(`/api/pr/${prRef.owner}/${prRef.repo}/${prRef.number}/ideas`, {
        method: "POST",
      });
      const body = await res.json();
      setIdeas(body.ideas ?? null);
    } finally {
      setIdeasLoading(false);
    }
  }

  const reviewedFileCount = (files ?? []).filter((file) =>
    isFileReviewed(file.filename, fileHunkCounts[file.filename] ?? 0, reviewed),
  ).length;

  return (
    <div className="w-full p-6">
      <form onSubmit={loadPr} className="mb-6 flex gap-2 max-w-3xl">
        <Input
          placeholder="https://github.com/owner/repo/pull/123"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load PR"}
        </Button>
        <Button type="button" variant="outline" onClick={clearPr} disabled={!files}>
          Clear
        </Button>
      </form>

      {error && <div className="mb-4 text-sm text-destructive">{error}</div>}

      {files && (
        <div className="mb-4 flex items-center gap-4 text-sm">
          <span className="font-medium">{reviewedFileCount} / {files.length} files reviewed</span>
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox checked={hideWhitespace} onCheckedChange={setHideWhitespace} />
            Hide whitespace
          </label>
        </div>
      )}

      {files && prRef && (
        <div className="grid grid-cols-[300px_1fr] items-start gap-6">
          <div className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col gap-4 self-start">
            <IdeasPanel
              ideas={ideas}
              everythingElse={everythingElse}
              reviewed={reviewed}
              loading={ideasLoading}
              activeIdeaId={activeIdeaId}
              onGenerate={generateIdeas}
              onSelectIdea={setActiveIdeaId}
              onToggleIdea={toggleIdea}
            />
            <TableOfContents
              files={files}
              fileHunkCounts={fileHunkCounts}
              reviewed={reviewed}
              onToggleFile={toggleFile}
            />
          </div>
          {activeIdea ? (
            <IdeaView
              idea={activeIdea}
              files={files}
              hideWhitespace={hideWhitespace}
              prRef={prRef}
              reviewed={reviewed}
              index={activeIdeaIndex}
              total={allIdeas.length}
              onToggleIdea={toggleIdea}
              onPrev={() => setActiveIdeaId(allIdeas[activeIdeaIndex - 1]?.id ?? null)}
              onNext={() => setActiveIdeaId(allIdeas[activeIdeaIndex + 1]?.id ?? null)}
              onClose={() => setActiveIdeaId(null)}
            />
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
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
          )}
        </div>
      )}
    </div>
  );
}

export default App;
