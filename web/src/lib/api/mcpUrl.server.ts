import { persistent } from "../storage/persistent.server.js";

// Docent's MCP server, where agents reach it. The last address a request
// came in on is remembered for work no request starts, like the editor
// running as a review saves.
const seen = persistent("mcp-url", () => ({ url: null as string | null }));

export const rememberMcpUrl = (url: string) => (seen.url = url);
export const knownMcpUrl = () => seen.url ?? `http://localhost:${process.env.PORT ?? process.env.DOCENT_PORT ?? 17321}/mcp`;
