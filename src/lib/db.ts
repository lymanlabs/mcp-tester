import Database from "better-sqlite3";
import path from "path";

/* ── types ────────────────────────────────────────────────── */

export interface SavedConnection {
  id: string;
  name: string;
  transport: "sse" | "stdio" | "http";
  url: string | null;
  command: string | null;
  args: string | null;       // JSON array
  headers: string | null;    // JSON object
  env_vars: string | null;   // JSON object
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: number | null;
  token_endpoint: string | null;
  client_id: string | null;
  client_secret: string | null;
  created_at: number;
  updated_at: number;
}

export interface ConnectionInput {
  name: string;
  transport: "sse" | "stdio" | "http";
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env_vars?: Record<string, string>;
}

/* ── init ─────────────────────────────────────────────────── */

function getDb() {
  const dbPath = path.join(process.cwd(), "mcp-tester.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      transport TEXT NOT NULL,
      url TEXT,
      command TEXT,
      args TEXT,
      headers TEXT,
      env_vars TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      token_endpoint TEXT,
      client_id TEXT,
      client_secret TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  return db;
}

// Singleton
const g = globalThis as unknown as { _db: Database.Database };
function db() {
  if (!g._db) g._db = getDb();
  return g._db;
}

/* ── queries ──────────────────────────────────────────────── */

export function listConnections(): SavedConnection[] {
  return db().prepare("SELECT * FROM connections ORDER BY updated_at DESC").all() as SavedConnection[];
}

export function getConnection(id: string): SavedConnection | undefined {
  return db().prepare("SELECT * FROM connections WHERE id = ?").get(id) as SavedConnection | undefined;
}

export function createConnection(id: string, input: ConnectionInput): SavedConnection {
  const now = Date.now();
  db().prepare(`
    INSERT INTO connections (id, name, transport, url, command, args, headers, env_vars, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.transport,
    input.url || null,
    input.command || null,
    input.args ? JSON.stringify(input.args) : null,
    input.headers ? JSON.stringify(input.headers) : null,
    input.env_vars ? JSON.stringify(input.env_vars) : null,
    now,
    now,
  );
  return getConnection(id)!;
}

export function updateConnection(id: string, input: Partial<ConnectionInput>): SavedConnection | undefined {
  const existing = getConnection(id);
  if (!existing) return undefined;

  const fields: string[] = ["updated_at = ?"];
  const values: any[] = [Date.now()];

  if (input.name !== undefined) { fields.push("name = ?"); values.push(input.name); }
  if (input.transport !== undefined) { fields.push("transport = ?"); values.push(input.transport); }
  if (input.url !== undefined) { fields.push("url = ?"); values.push(input.url || null); }
  if (input.command !== undefined) { fields.push("command = ?"); values.push(input.command || null); }
  if (input.args !== undefined) { fields.push("args = ?"); values.push(JSON.stringify(input.args)); }
  if (input.headers !== undefined) { fields.push("headers = ?"); values.push(JSON.stringify(input.headers)); }
  if (input.env_vars !== undefined) { fields.push("env_vars = ?"); values.push(JSON.stringify(input.env_vars)); }

  db().prepare(`UPDATE connections SET ${fields.join(", ")} WHERE id = ?`).run(...values, id);
  return getConnection(id);
}

export function deleteConnection(id: string): boolean {
  const r = db().prepare("DELETE FROM connections WHERE id = ?").run(id);
  return r.changes > 0;
}

/* ── token persistence ────────────────────────────────────── */

export function saveToken(
  connectionId: string,
  token: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
  }
) {
  db().prepare(`
    UPDATE connections SET
      access_token = ?, refresh_token = ?, token_expires_at = ?,
      token_endpoint = ?, client_id = ?, client_secret = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    token.accessToken,
    token.refreshToken || null,
    token.expiresAt || null,
    token.tokenEndpoint,
    token.clientId,
    token.clientSecret || null,
    Date.now(),
    connectionId,
  );
}

export function clearToken(connectionId: string) {
  db().prepare(`
    UPDATE connections SET
      access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
      token_endpoint = NULL, client_id = NULL, client_secret = NULL,
      updated_at = ?
    WHERE id = ?
  `).run(Date.now(), connectionId);
}

export function getTokenForUrl(url: string): {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
} | null {
  const row = db().prepare(
    "SELECT access_token, refresh_token, token_expires_at, token_endpoint, client_id, client_secret FROM connections WHERE url = ? AND access_token IS NOT NULL ORDER BY updated_at DESC LIMIT 1"
  ).get(url) as any;

  if (!row || !row.access_token) return null;
  return {
    accessToken: row.access_token,
    refreshToken: row.refresh_token || undefined,
    expiresAt: row.token_expires_at || undefined,
    tokenEndpoint: row.token_endpoint,
    clientId: row.client_id,
    clientSecret: row.client_secret || undefined,
  };
}


