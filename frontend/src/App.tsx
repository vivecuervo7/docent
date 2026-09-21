import { useState, type FormEvent } from "react";
import { Diff, Hunk, parseDiff, type DiffType } from "react-diff-view";
import "react-diff-view/style/index.css";
import "./App.css";

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
    <div className="file-block">
      <label className="file-header">
        <input type="checkbox" checked={reviewed} onChange={onToggle} />
        <span className="filename">{file.filename}</span>
        <span className="stats">
          +{file.additions} -{file.deletions}
        </span>
      </label>
      {hunks && hunks.length > 0 ? (
        <Diff viewType="unified" diffType={diffType} hunks={hunks}>
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </Diff>
      ) : (
        <div className="no-diff">No diff available for this file.</div>
      )}
    </div>
  );
}

function App() {
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [number, setNumber] = useState("");
  const [files, setFiles] = useState<PrFile[] | null>(null);
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPr(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFiles(null);

    try {
      const [filesRes, reviewRes] = await Promise.all([
        fetch(`/api/pr/${owner}/${repo}/${number}`),
        fetch(`/api/review/${owner}/${repo}/${number}`),
      ]);
      if (!filesRes.ok) {
        const body = await filesRes.json();
        throw new Error(body.error ?? "Failed to fetch PR");
      }
      const { files } = await filesRes.json();
      const reviewState = await reviewRes.json();
      setFiles(files);
      setReviewed(reviewState);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleReviewed(filename: string) {
    const next = !reviewed[filename];
    setReviewed((prev) => ({ ...prev, [filename]: next }));
    await fetch(`/api/review/${owner}/${repo}/${number}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, reviewed: next }),
    });
  }

  return (
    <div className="app">
      <form onSubmit={loadPr} className="pr-form">
        <input
          placeholder="owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
        <input
          placeholder="repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
        />
        <input
          placeholder="PR number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
        />
        <button type="submit" disabled={loading}>
          {loading ? "Loading…" : "Load PR"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {files && (
        <div className="summary">
          {Object.values(reviewed).filter(Boolean).length} / {files.length} files reviewed
        </div>
      )}

      {files && (
        <div className="file-list">
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
