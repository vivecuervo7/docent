import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PrFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
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
  reviewed,
  collapsedFolders,
  onToggleFolder,
  onToggleReviewed,
}: {
  entries: FileTreeEntry[];
  depth: number;
  reviewed: Record<string, boolean>;
  collapsedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onToggleReviewed: (filename: string) => void;
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
                  reviewed={reviewed}
                  collapsedFolders={collapsedFolders}
                  onToggleFolder={onToggleFolder}
                  onToggleReviewed={onToggleReviewed}
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
                checked={!!reviewed[entry.file.filename]}
                onCheckedChange={() => onToggleReviewed(entry.file.filename)}
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
  reviewed,
  onToggleReviewed,
}: {
  files: PrFile[];
  reviewed: Record<string, boolean>;
  onToggleReviewed: (filename: string) => void;
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
    <nav className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col self-start rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        Files
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex w-max min-w-full flex-col gap-0.5 p-1">
          <FileTreeNodes
            entries={tree.children}
            depth={0}
            reviewed={reviewed}
            collapsedFolders={collapsedFolders}
            onToggleFolder={toggleFolder}
            onToggleReviewed={onToggleReviewed}
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

type DeleteChange = Extract<ChangeData, { type: "delete" }>;
type InsertChange = Extract<ChangeData, { type: "insert" }>;

function normalizeForWhitespaceCompare(line: string): string {
  return line.replace(/\s+/g, "");
}

// Approximates git's "ignore whitespace" from the patch alone: a hunk's
// consecutive delete/insert block collapses into unchanged lines only when
// it's a *pure* reflow (same line count, every line pairs up once whitespace
// is stripped) — collapsing some pairs but not others would mean moving an
// insert out of its block to sit next to its paired delete, which reorders
// the block and scrambles any real change mixed in with it. A block that
// isn't a pure reflow is left exactly as it was.
function collapseWhitespaceOnlyChanges(hunks: HunkData[]): HunkData[] {
  return hunks.map((hunk) => {
    const changes: ChangeData[] = [];
    const src = hunk.changes;
    let i = 0;

    while (i < src.length) {
      if (src[i].type !== "delete") {
        changes.push(src[i]);
        i++;
        continue;
      }

      const deletes: DeleteChange[] = [];
      while (i < src.length && src[i].type === "delete") {
        deletes.push(src[i] as DeleteChange);
        i++;
      }
      const inserts: InsertChange[] = [];
      while (i < src.length && src[i].type === "insert") {
        inserts.push(src[i] as InsertChange);
        i++;
      }

      const isPureReflow =
        deletes.length === inserts.length &&
        deletes.every(
          (del, idx) =>
            normalizeForWhitespaceCompare(del.content) ===
            normalizeForWhitespaceCompare(inserts[idx].content),
        );

      if (isPureReflow) {
        deletes.forEach((del, idx) => {
          const ins = inserts[idx];
          changes.push({
            type: "normal",
            isNormal: true,
            content: ins.content,
            oldLineNumber: del.lineNumber,
            newLineNumber: ins.lineNumber,
          });
        });
      } else {
        changes.push(...deletes, ...inserts);
      }
    }

    return { ...hunk, changes };
  });
}

function FileDiff({
  file,
  reviewed,
  hideWhitespace,
  onToggle,
}: {
  file: PrFile;
  reviewed: boolean;
  hideWhitespace: boolean;
  onToggle: () => void;
}) {
  let hunks;
  let diffType: DiffType = "modify";

  if (file.patch) {
    try {
      const [parsed] = parseDiff(buildDiffText(file));
      hunks = parsed?.hunks;
      diffType = (parsed?.type as DiffType) ?? diffType;
    } catch {
      hunks = undefined;
    }
  }

  if (hunks && hideWhitespace) {
    hunks = collapseWhitespaceOnlyChanges(hunks);
  }

  let tokens;
  if (hunks) {
    try {
      tokens = tokenize(hunks, {
        highlight: false,
        enhancers: [markEdits(hunks, { type: "block" })],
      });
    } catch {
      tokens = undefined;
    }
  }

  const [collapsed, setCollapsed] = useState(reviewed);
  const wasReviewed = useRef(reviewed);

  useEffect(() => {
    if (!wasReviewed.current && reviewed) {
      setCollapsed(true);
    }
    wasReviewed.current = reviewed;
  }, [reviewed]);

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideWhitespace, setHideWhitespace] = useState(true);

  async function loadPrByRef(ref: PrRef) {
    setError(null);
    setLoading(true);
    setFiles(null);

    try {
      const [filesRes, reviewRes] = await Promise.all([
        fetch(`/api/pr/${ref.owner}/${ref.repo}/${ref.number}`),
        fetch(`/api/review/${ref.owner}/${ref.repo}/${ref.number}`),
      ]);
      if (!filesRes.ok) {
        const body = await filesRes.json();
        throw new Error(body.error ?? "Failed to fetch PR");
      }
      const { files } = await filesRes.json();
      const reviewState = await reviewRes.json();
      setPrRef(ref);
      setFiles(files);
      setReviewed(reviewState);
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
    setError(null);
  }

  async function toggleReviewed(filename: string) {
    if (!prRef) return;
    const next = !reviewed[filename];
    setReviewed((prev) => ({ ...prev, [filename]: next }));
    await fetch(`/api/review/${prRef.owner}/${prRef.repo}/${prRef.number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, reviewed: next }),
    });
  }

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
          <span className="font-medium">
            {Object.values(reviewed).filter(Boolean).length} / {files.length} files reviewed
          </span>
          <label className="flex items-center gap-2 text-muted-foreground">
            <Checkbox checked={hideWhitespace} onCheckedChange={setHideWhitespace} />
            Hide whitespace
          </label>
        </div>
      )}

      {files && (
        <div className="grid grid-cols-[300px_1fr] items-start gap-6">
          <TableOfContents files={files} reviewed={reviewed} onToggleReviewed={toggleReviewed} />
          <div className="flex min-w-0 flex-col gap-4">
            {files.map((file) => (
              <FileDiff
                key={file.filename}
                file={file}
                reviewed={!!reviewed[file.filename]}
                hideWhitespace={hideWhitespace}
                onToggle={() => toggleReviewed(file.filename)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
