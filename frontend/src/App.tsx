import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
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

function TableOfContents({
  files,
  reviewed,
}: {
  files: PrFile[];
  reviewed: Record<string, boolean>;
}) {
  return (
    <nav className="sticky top-6 flex max-h-[calc(100vh-3rem)] flex-col self-start rounded-lg border bg-card">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
        Files
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="flex flex-col gap-0.5 p-1">
          {files.map((file) => (
            <li key={file.filename}>
              <button
                type="button"
                onClick={() => scrollToFile(file.filename)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
              >
                {reviewed[file.filename] ? (
                  <Check className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
                ) : (
                  <span className="size-3.5 shrink-0 rounded-full border border-muted-foreground/40" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">{file.filename}</span>
              </button>
            </li>
          ))}
        </ul>
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

// Approximates git's "ignore whitespace" from the patch alone: pairs up each
// hunk's consecutive delete/insert block and collapses pairs that are
// identical once whitespace is stripped into a single unchanged line.
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

      const pairCount = Math.min(deletes.length, inserts.length);
      for (let p = 0; p < pairCount; p++) {
        const del = deletes[p];
        const ins = inserts[p];
        if (normalizeForWhitespaceCompare(del.content) === normalizeForWhitespaceCompare(ins.content)) {
          changes.push({
            type: "normal",
            isNormal: true,
            content: ins.content,
            oldLineNumber: del.lineNumber,
            newLineNumber: ins.lineNumber,
          });
        } else {
          changes.push(del, ins);
        }
      }
      for (let p = pairCount; p < deletes.length; p++) changes.push(deletes[p]);
      for (let p = pairCount; p < inserts.length; p++) changes.push(inserts[p]);
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
        <Checkbox checked={reviewed} onCheckedChange={onToggle} />
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
          {file.filename}
        </span>
        <Badge variant="outline" className="text-green-600 dark:text-green-400">
          +{file.additions}
        </Badge>
        <Badge variant="outline" className="text-red-600 dark:text-red-400">
          -{file.deletions}
        </Badge>
      </div>
      {!collapsed &&
        (hunks && hunks.length > 0 ? (
          <div className="overflow-x-auto text-xs">
            <Diff viewType="unified" diffType={diffType} hunks={hunks} tokens={tokens}>
              {(hunks) =>
                hunks.flatMap((hunk) => [
                  <Decoration key={`decoration-${hunk.content}`}>
                    <div className="bg-muted px-4 py-1.5 font-mono text-xs text-muted-foreground">
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
        <div className="grid grid-cols-[240px_1fr] items-start gap-6">
          <TableOfContents files={files} reviewed={reviewed} />
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
