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
  mcp: { claude: boolean; codex: boolean };
}

const run = (cmd: string, args: string[]) =>
  execFileAsync(cmd, args, { timeout: 10_000, cwd: homedir() }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );

export async function checkSetup(): Promise<SetupCheck> {
  const [ghVersion, login, claudeVersion, codexVersion] = await Promise.all([
    run("gh", ["--version"]),
    run("gh", ["api", "user", "--jq", ".login"]),
    run("claude", ["--version"]),
    run("codex", ["--version"]),
  ]);
  const [claudeMcp, codexMcp] = await Promise.all([
    claudeVersion !== null && run("claude", ["mcp", "get", "docent"]).then((out) => out !== null),
    codexVersion !== null && run("codex", ["mcp", "get", "docent"]).then((out) => out !== null),
  ]);
  return {
    gh: { installed: ghVersion !== null, login: login || undefined },
    claude: { installed: claudeVersion !== null, version: claudeVersion?.split(" ")[0] },
    codex: { installed: codexVersion !== null, version: codexVersion?.split(" ").at(-1) },
    mcp: { claude: claudeMcp, codex: codexMcp },
  };
}
