import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// What Docent needs on this machine, for the Getting started page: the
// GitHub CLI signed in, and optionally Claude Code or Codex with Docent's MCP
// server added, so the reviewer's own agent can send findings.

export interface SetupCheck {
  gh: { installed: boolean; login?: string };
  claude: { installed: boolean; version?: string };
  codex: { installed: boolean; version?: string };
  // Docent's MCP server added to each, for all the reviewer's projects.
  mcp: { claude: McpEntry; codex: McpEntry };
}

// Added at this address, or `elsewhere` when an entry named docent points
// at another one - an old port, say - which needs removing before adding.
export interface McpEntry {
  added: boolean;
  elsewhere?: string;
}

const run = (cmd: string, args: string[]) =>
  execFileAsync(cmd, args, { timeout: 10_000, cwd: homedir() }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );

// Both CLIs print the entry's address on a "URL:" line.
function mcpEntry(out: string | null, mcpUrl: string): McpEntry {
  if (!out) return { added: false };
  if (out.includes(mcpUrl)) return { added: true };
  const url = out.match(/^\s*url:\s*(\S+)/im)?.[1];
  return url ? { added: false, elsewhere: url } : { added: false };
}

// The MCP server counts as added only at this address, so an entry left
// pointing somewhere else isn't taken for a working one.
export async function checkSetup(mcpUrl: string): Promise<SetupCheck> {
  const [ghVersion, login, claudeVersion, codexVersion] = await Promise.all([
    run("gh", ["--version"]),
    run("gh", ["api", "user", "--jq", ".login"]),
    run("claude", ["--version"]),
    run("codex", ["--version"]),
  ]);
  const [claudeMcp, codexMcp] = await Promise.all([
    claudeVersion !== null ? run("claude", ["mcp", "get", "docent"]).then((out) => mcpEntry(out, mcpUrl)) : { added: false },
    codexVersion !== null ? run("codex", ["mcp", "get", "docent"]).then((out) => mcpEntry(out, mcpUrl)) : { added: false },
  ]);
  return {
    gh: { installed: ghVersion !== null, login: login || undefined },
    claude: { installed: claudeVersion !== null, version: claudeVersion?.split(" ")[0] },
    codex: { installed: codexVersion !== null, version: codexVersion?.split(" ").at(-1) },
    mcp: { claude: claudeMcp, codex: codexMcp },
  };
}
