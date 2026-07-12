/**
 * Graphiti memory for the Pi backend.
 *
 * Pi has no built-in MCP, so this extension registers two tools that proxy to
 * the Graphiti MCP server over its streamable-HTTP endpoint, giving Pi-backed
 * investigations the same long-term memory the Claude backend gets natively.
 *
 * Gated on EH_MEMORY_MCP_URL — when unset (memory disabled) it registers
 * nothing. Scoped by EH_MEMORY_GROUP_ID for per-environment isolation.
 */
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MCP_URL = process.env.EH_MEMORY_MCP_URL || "";
const GROUP_ID = process.env.EH_MEMORY_GROUP_ID || "ehdefault";

/** Parse an MCP streamable-HTTP response (SSE frames or plain JSON). */
async function parseMcp(res: Response): Promise<any> {
  const text = await res.text();
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return JSON.parse(text); } catch { return null; }
  }
  // SSE: collect `data:` lines, return the last object carrying result/error.
  let last: any = null;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    try {
      const obj = JSON.parse(t.slice(5).trim());
      if (obj && (obj.result !== undefined || obj.error !== undefined)) last = obj;
    } catch { /* ignore non-JSON frames */ }
  }
  return last;
}

/** One stateless MCP tools/call: initialize → initialized → tools/call. */
async function mcpToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  const init = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "eh-pi-memory", version: "1" } },
    }),
  });
  if (!init.ok) throw new Error(`memory server initialize failed (HTTP ${init.status})`);
  const sid = init.headers.get("mcp-session-id");
  await parseMcp(init);
  const h2 = sid ? { ...headers, "mcp-session-id": sid } : headers;
  await fetch(MCP_URL, {
    method: "POST", headers: h2,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const res = await fetch(MCP_URL, {
    method: "POST", headers: h2,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: toolName, arguments: args } }),
  });
  const msg = await parseMcp(res);
  if (msg?.error) throw new Error(msg.error.message || "memory server error");
  const content = msg?.result?.content;
  if (Array.isArray(content)) {
    return content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n").trim();
  }
  return typeof msg?.result === "string" ? msg.result : JSON.stringify(msg?.result ?? {});
}

const memorySearch = defineTool({
  name: "memory_search",
  label: "Search memory",
  description:
    "Search long-term investigation memory (prior investigations, device roles, identities, dispositions) " +
    "for the current environment. Use at the START of an investigation to recall what is already known about " +
    "the devices, identities, endpoints, and detection types in scope.",
  promptSnippet: "Recall prior investigation memory before triaging.",
  parameters: Type.Object({
    query: Type.String({ description: "What to recall, e.g. an IP, hostname, username, or detection type" }),
    max_facts: Type.Optional(Type.Number({ description: "Max facts to return (default 10)" })),
  }),
  async execute(_id: string, params: { query: string; max_facts?: number }) {
    try {
      const text = await mcpToolCall("search_memory_facts", {
        query: params.query, group_ids: [GROUP_ID], max_facts: params.max_facts ?? 10,
      });
      return { content: [{ type: "text", text: text || "No relevant memory found." }], details: {} };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Memory search unavailable: ${err?.message || err}` }], details: {}, isError: true };
    }
  },
});

const memoryAdd = defineTool({
  name: "memory_add",
  label: "Save to memory",
  description:
    "Record a durable conclusion to long-term investigation memory. Use at the END of an investigation to " +
    "store devices (IP + hostname) and roles, identities involved, the detection type, the disposition/verdict, " +
    "and any analyst preference. Do not store secrets or raw evidence dumps.",
  promptSnippet: "Save durable investigation conclusions to memory at close.",
  parameters: Type.Object({
    name: Type.String({ description: "Short episode title, e.g. 'WIN-BACKUP01 Lateral Movement 2026-07-08'" }),
    content: Type.String({ description: "Concise factual summary of the investigation and its disposition" }),
  }),
  async execute(_id: string, params: { name: string; content: string }) {
    try {
      await mcpToolCall("add_memory", {
        name: params.name, episode_body: params.content, group_id: GROUP_ID,
        source: "text", source_description: "ExtraHop investigation",
      });
      return { content: [{ type: "text", text: `Saved to memory: ${params.name}` }], details: {} };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Could not save to memory: ${err?.message || err}` }], details: {}, isError: true };
    }
  },
});

export default function (pi: ExtensionAPI) {
  if (!MCP_URL) return; // memory disabled — register nothing
  pi.registerTool(memorySearch);
  pi.registerTool(memoryAdd);
}
