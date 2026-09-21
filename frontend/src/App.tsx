import { useState, type FormEvent } from "react";
import { Diff, Hunk, parseDiff, type DiffType } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

interface PrFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
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

function FileDiff({
  file,
  reviewed,
  onToggle,
}: {
  file: PrFile;
  reviewed: boolean;
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

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex items-center gap-3 border-b bg-muted/50 px-4 py-3">
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
      {hunks && hunks.length > 0 ? (
        <div className="overflow-x-auto text-sm">
          <Diff viewType="unified" diffType={diffType} hunks={hunks}>
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        </div>
      ) : (
        <div className="p-4 text-sm italic text-muted-foreground">
          No diff available for this file.
        </div>
      )}
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

function App() {
  const [prUrl, setPrUrl] = useState("");
  const [prRef, setPrRef] = useState<PrRef | null>(null);
  const [files, setFiles] = useState<PrFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPr(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const ref = parsePrUrl(prUrl);
    if (!ref) {
      setError("Enter a GitHub PR URL, e.g. https://github.com/owner/repo/pull/123");
      return;
    }

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
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
    <div className="mx-auto max-w-4xl p-6">
      <form onSubmit={loadPr} className="mb-6 flex gap-2">
        <Input
          placeholder="https://github.com/owner/repo/pull/123"
          value={prUrl}
          onChange={(e) => setPrUrl(e.target.value)}
        />
        <Button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load PR"}
        </Button>
      </form>

      {error && <div className="mb-4 text-sm text-destructive">{error}</div>}

      {files && (
        <div className="mb-4 text-sm font-medium">
          {Object.values(reviewed).filter(Boolean).length} / {files.length} files reviewed
        </div>
      )}

      {files && (
        <div className="flex flex-col gap-4">
          {files.map((file) => (
            <FileDiff
              key={file.filename}
              file={file}
              reviewed={!!reviewed[file.filename]}
              onToggle={() => toggleReviewed(file.filename)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
