import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/* ── types ────────────────────────────────────────────────── */

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "ok" | "warn" | "error";
  message: string;
  details?: unknown;
}

interface ActiveConnection {
  id: string;
  name: string;
  client: Client;
  tools: any[];
}

/* ── manager ──────────────────────────────────────────────── */

class McpManager {
  private active = new Map<string, ActiveConnection>();
  private logs: LogEntry[] = [];
  private logCounter = 0;

  /* ── logging (global, simple) ── */

  log(level: LogEntry["level"], message: string, details?: unknown) {
    this.logs.push({
      id: `${++this.logCounter}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details,
    });
  }

  getLogs(after: number) {
    return { logs: this.logs.slice(after), total: this.logs.length };
  }

  clearLogs() { this.logs = []; }

  /* ── connections ── */

  async connect(id: string, name: string, config: {
    transport: "sse" | "stdio" | "http";
    url?: string;
    command?: string;
    args?: string[];
    headers?: Record<string, string>;
    env?: Record<string, string>;
    token?: string;
  }): Promise<{ tools: any[] }> {
    if (!config.transport) throw new Error("Transport type is required");

    // Disconnect if this specific ID is already active
    if (this.active.has(id)) await this.disconnect(id);

    this.log("info", `[${name}] Connecting via ${config.transport.toUpperCase()}…`);

    const client = new Client({ name: "mcp-tester", version: "1.0.0" });
    let transport: SSEClientTransport | StdioClientTransport | StreamableHTTPClientTransport;

    if (config.transport === "sse") {
      if (!config.url) throw new Error("URL required");
      transport = new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers || {} } } as any);
    } else if (config.transport === "http") {
      if (!config.url) throw new Error("URL required");
      const h: Record<string, string> = { ...(config.headers || {}) };
      if (config.token) h["Authorization"] = `Bearer ${config.token}`;
      transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: h } });
    } else {
      if (!config.command) throw new Error("Command required");
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      });
    }

    try {
      await client.connect(transport);
    } catch (err: any) {
      this.log("error", `[${name}] Connection failed: ${err.message}`);
      throw err;
    }

    this.log("ok", `[${name}] Connected`);

    let tools: any[] = [];
    try {
      const r = await client.listTools();
      tools = r.tools;
      this.log("ok", `[${name}] ${tools.length} tools: ${tools.map(t => t.name).join(", ")}`);
    } catch (err: any) {
      this.log("warn", `[${name}] Failed to list tools: ${err.message}`);
    }

    this.active.set(id, { id, name, client, tools });
    return { tools };
  }

  async disconnect(id: string) {
    const conn = this.active.get(id);
    if (!conn) return;
    this.log("info", `[${conn.name}] Disconnecting`);
    try { await conn.client.close(); } catch {}
    this.active.delete(id);
  }

  isActive(id: string) { return this.active.has(id); }

  /* ── tools (merged from all active MCPs) ── */

  getAllTools(): { connectionId: string; connectionName: string; tool: any }[] {
    const result: { connectionId: string; connectionName: string; tool: any }[] = [];
    for (const conn of this.active.values()) {
      for (const tool of conn.tools) {
        result.push({ connectionId: conn.id, connectionName: conn.name, tool });
      }
    }
    return result;
  }

  getToolsGrouped(): { connectionId: string; connectionName: string; tools: any[] }[] {
    return Array.from(this.active.values()).map(c => ({
      connectionId: c.id,
      connectionName: c.name,
      tools: c.tools,
    }));
  }

  /* ── call a tool (auto-routes to the right MCP) ── */

  async callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
    for (const conn of this.active.values()) {
      const hasTool = conn.tools.some((t: any) => t.name === toolName);
      if (hasTool) {
        this.log("info", `Calling ${toolName} → [${conn.name}]`);
        const start = Date.now();
        try {
          const result = await conn.client.callTool({ name: toolName, arguments: args });
          const elapsed = Date.now() - start;
          const text = result.content.map((c: any) => c.type === "text" ? c.text : JSON.stringify(c)).join("\n");
          this.log("ok", `${toolName} completed (${elapsed}ms)`, { resultPreview: text.slice(0, 300) });
          return result;
        } catch (err: any) {
          const elapsed = Date.now() - start;
          this.log("error", `${toolName} failed (${elapsed}ms): ${err.message}`);
          throw err;
        }
      }
    }
    throw new Error(`No active MCP has tool "${toolName}"`);
  }

  getActiveCount() { return this.active.size; }
  getActiveIds() { return Array.from(this.active.keys()); }
}

/* ── singleton ────────────────────────────────────────────── */

const g = globalThis as unknown as { mcpMgr: McpManager };
export const mcpManager = g.mcpMgr ?? new McpManager();
if (process.env.NODE_ENV !== "production") g.mcpMgr = mcpManager;
