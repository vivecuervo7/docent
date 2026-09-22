import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PrFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export async function fetchPrFiles(
  owner: string,
  repo: string,
  number: string,
): Promise<PrFile[]> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    "--paginate",
    `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`,
  ]);

  return JSON.parse(stdout) as PrFile[];
}

export async function fetchPrBaseSha(
  owner: string,
  repo: string,
  number: string,
): Promise<string> {
  const { stdout } = await execFileAsync("gh", [
    "api",
    `repos/${owner}/${repo}/pulls/${number}`,
    "--jq",
    ".base.sha",
  ]);

  return stdout.trim();
}

export async function fetchFileContentAtRef(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  try {
    const { stdout } = await execFileAsync("gh", [
      "api",
      `repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    ]);

    const data = JSON.parse(stdout) as { content?: string; encoding?: string };
    if (!data.content) return null;

    return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf-8").toString(
      "utf-8",
    );
  } catch {
    return null;
  }
}
