import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// What Docent needs on this machine, for the Getting started page: the
// GitHub CLI signed in, and optionally Claude Code with Docent's MCP server
// added so the reviewer's own agent can send findings.

export interface SetupCheck {
  gh: { installed: boolean; login?: string };
  claude: { installed: boolean; version?: string };
  // Added at user scope, so agents in any of the reviewer's projects reach it.
  mcp: { added: boolean };
}

const run = (cmd: string, args: string[]) =>
  execFileAsync(cmd, args, { timeout: 10_000, cwd: homedir() }).then(
    ({ stdout }) => stdout.trim(),
    () => null,
  );

export async function checkSetup(): Promise<SetupCheck> {
  const [ghVersion, login, claudeVersion] = await Promise.all([
    run("gh", ["--version"]),
    run("gh", ["api", "user", "--jq", ".login"]),
    run("claude", ["--version"]),
  ]);
  const mcp = claudeVersion !== null && (await run("claude", ["mcp", "get", "docent"])) !== null;
  return {
    gh: { installed: ghVersion !== null, login: login || undefined },
    claude: { installed: claudeVersion !== null, version: claudeVersion?.split(" ")[0] },
    mcp: { added: mcp },
  };
}
