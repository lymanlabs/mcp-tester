"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ── types ── */

interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown> }
interface ToolGroup { connectionId: string; connectionName: string; tools: McpTool[] }
interface ToolCallInfo { id: string; name: string; arguments: Record<string, unknown>; result?: string; status: "calling" | "done" | "error" }
interface ChatMessage { id: string; role: "user" | "assistant"; content: string; toolCalls?: ToolCallInfo[] }
interface LogEntry { id: string; timestamp: string; level: string; message: string; details?: unknown }
interface KV { id: string; key: string; value: string }
type Provider = "claude" | "openai";
type Transport = "sse" | "stdio" | "http";
interface SavedConn { id: string; name: string; transport: Transport; url: string | null; command: string | null; args: string[]; headers: Record<string, string>; env_vars: Record<string, string>; hasToken: boolean; tokenExpiresIn: number | null; hasRefresh: boolean }

const MODELS: Record<Provider, string[]> = {
  claude: ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-sonnet-4-20250514"],
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o3-mini"],
};

/* ── icons ── */

const I = {
  send: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/></svg>,
  wrench: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  chev: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><path d="m9 18 6-6-6-6"/></svg>,
  x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"/></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  term: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  spin: <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 anim-spin"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-15"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>,
  trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>,
};

/* ── primitives ── */

function Badge({ children, color = "neutral" }: { children: React.ReactNode; color?: "neutral" | "green" | "red" | "blue" | "amber" }) {
  const c = { neutral: "bg-white/[0.04] text-[var(--text-secondary)]", green: "bg-emerald-500/8 text-emerald-400", red: "bg-red-400/8 text-red-400", blue: "bg-blue-400/8 text-blue-400", amber: "bg-amber-400/8 text-amber-400" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium tracking-wide ${c[color]}`}>{children}</span>;
}

function Btn({ children, onClick, disabled, variant = "default", className = "" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "default" | "primary" | "ghost"; className?: string }) {
  const base = "inline-flex items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition-all disabled:opacity-30 disabled:pointer-events-none cursor-pointer";
  const v = {
    default: "h-8 px-3 bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-hover)]",
    primary: "h-9 px-4 bg-white text-[#0e0e0e] font-semibold hover:bg-neutral-200 active:bg-neutral-300",
    ghost: "h-7 px-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.03]",
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${v[variant]} ${className}`}>{children}</button>;
}

function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full h-9 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] focus:bg-[var(--bg-hover)] transition-all disabled:opacity-30 ${className}`} />;
}

function Toggle({ on, loading, onClick }: { on: boolean; loading?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`relative shrink-0 w-10 h-[22px] rounded-full transition-all duration-200 disabled:opacity-50 ${on ? "bg-[var(--green)]" : loading ? "bg-[var(--amber)]" : "bg-[var(--border)]"}`}>
      <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${on ? "left-[21px]" : "left-[3px]"}`} />
    </button>
  );
}

function KVEditor({ items, setItems, kPh, vPh }: { items: KV[]; setItems: (v: KV[]) => void; kPh: string; vPh: string }) {
  return (
    <div className="space-y-2">
      {items.map(it => (
        <div key={it.id} className="flex gap-2 items-center">
          <Input value={it.key} onChange={e => setItems(items.map(i => i.id === it.id ? { ...i, key: e.target.value } : i))} placeholder={kPh} className="flex-1 font-mono !text-[12px]" />
          <Input value={it.value} onChange={e => setItems(items.map(i => i.id === it.id ? { ...i, value: e.target.value } : i))} placeholder={vPh} className="flex-1 font-mono !text-[12px]" />
          <button onClick={() => setItems(items.filter(i => i.id !== it.id))} className="text-[var(--text-muted)] hover:text-[var(--red)] p-1 rounded-md hover:bg-white/[0.03] transition-all">{I.x}</button>
        </div>
      ))}
      <button onClick={() => setItems([...items, { id: crypto.randomUUID(), key: "", value: "" }])} className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">{I.plus} Add</button>
    </div>
  );
}

/* ── chat components ── */

function ToolCard({ tc }: { tc: ToolCallInfo }) {
  const [showA, setShowA] = useState(false);
  const [showR, setShowR] = useState(false);
  return (
    <div className="my-2 border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--bg)] anim-in">
      <div className="flex items-center gap-2.5 px-3 py-2.5 bg-[var(--bg-raised)]">
        <span className="text-[var(--amber)]">{I.wrench}</span>
        <code className="text-[13px] text-[var(--text)] font-medium">{tc.name}</code>
        <span className="ml-auto">
          {tc.status === "calling" && <span className="flex gap-0.5 text-[var(--amber)] text-lg"><span className="loading-dot">·</span><span className="loading-dot">·</span><span className="loading-dot">·</span></span>}
          {tc.status === "done" && <span className="text-[var(--green)]">{I.check}</span>}
          {tc.status === "error" && <span className="text-[var(--red)]">{I.x}</span>}
        </span>
      </div>
      <button onClick={() => setShowA(!showA)} className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 transition-all">
        <span className={`transition-transform duration-150 ${showA ? "rotate-90" : ""}`}>{I.chev}</span> Arguments
      </button>
      {showA && <pre className="px-3 pb-3 text-[12px] text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words leading-relaxed">{JSON.stringify(tc.arguments, null, 2)}</pre>}
      {tc.result !== undefined && (
        <>
          <div className="border-t border-[var(--border)]" />
          <button onClick={() => setShowR(!showR)} className="w-full text-left px-3 py-2 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] flex items-center gap-1.5 transition-all">
            <span className={`transition-transform duration-150 ${showR ? "rotate-90" : ""}`}>{I.chev}</span> Result
          </button>
          {showR && <pre className="px-3 pb-3 text-[12px] text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-words max-h-52 overflow-y-auto leading-relaxed">{tc.result}</pre>}
        </>
      )}
    </div>
  );
}

function Msg({ m }: { m: ChatMessage }) {
  const u = m.role === "user";
  return (
    <div className={`flex ${u ? "justify-end" : "justify-start"} mb-5 anim-in`}>
      <div className={`max-w-[80%] min-w-0 ${u
        ? "bg-white text-[#111] rounded-2xl rounded-br-md px-4 py-3"
        : "bg-[var(--bg-raised)] border border-[var(--border)] rounded-2xl rounded-bl-md px-5 py-4"
      }`}>
        {m.content && (
          u ? (
            <div className="text-[14px] leading-[1.7] break-words">{m.content}</div>
          ) : (
            <div className="prose-chat text-[14px] leading-[1.8] break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => <h3 className="text-[15px] font-semibold text-[var(--text)] mt-4 mb-2 first:mt-0">{children}</h3>,
                  h2: ({ children }) => <h4 className="text-[14px] font-semibold text-[var(--text)] mt-4 mb-1.5 first:mt-0">{children}</h4>,
                  h3: ({ children }) => <h5 className="text-[14px] font-semibold text-[var(--text)] mt-3 mb-1 first:mt-0">{children}</h5>,
                  p: ({ children }) => <p className="mb-3 last:mb-0 text-[var(--text-secondary)]">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-[var(--text)]">{children}</strong>,
                  em: ({ children }) => <em className="italic text-[var(--text-secondary)]">{children}</em>,
                  ul: ({ children }) => <ul className="mb-3 last:mb-0 space-y-1">{children}</ul>,
                  ol: ({ children }) => <ol className="mb-3 last:mb-0 space-y-1 list-decimal list-inside">{children}</ol>,
                  li: ({ children }) => <li className="text-[var(--text-secondary)] flex gap-2 items-start"><span className="text-[var(--text-muted)] mt-[2px] shrink-0">–</span><span>{children}</span></li>,
                  code: ({ children, className }) => {
                    const isBlock = className?.includes("language-");
                    return isBlock
                      ? <pre className="my-3 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto"><code className="text-[12px] font-mono text-[var(--text-secondary)] leading-relaxed">{children}</code></pre>
                      : <code className="text-[13px] font-mono bg-[var(--bg-input)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text)]">{children}</code>;
                  },
                  pre: ({ children }) => <>{children}</>,
                  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener" className="text-[var(--blue)] hover:underline">{children}</a>,
                  blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--border-hover)] pl-3 my-3 text-[var(--text-muted)] italic">{children}</blockquote>,
                  hr: () => <hr className="border-[var(--border)] my-4" />,
                  table: ({ children }) => <div className="my-3 overflow-x-auto rounded-lg border border-[var(--border)]"><table className="w-full text-[13px]">{children}</table></div>,
                  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
                  th: ({ children }) => <th className="px-3 py-2 text-left text-[12px] font-semibold text-[var(--text)] border-b border-[var(--border)]">{children}</th>,
                  td: ({ children }) => <td className="px-3 py-2 text-[var(--text-secondary)] border-b border-[var(--border)] last:[&:parent]:border-0">{children}</td>,
                  tr: ({ children }) => <tr className="border-b border-[var(--border)] last:border-0">{children}</tr>,
                }}
              >
                {m.content}
              </ReactMarkdown>
            </div>
          )
        )}
        {m.toolCalls && m.toolCalls.length > 0 && <div className={m.content ? "mt-3" : ""}>{m.toolCalls.map(tc => <ToolCard key={tc.id} tc={tc} />)}</div>}
        {!u && !m.content && (!m.toolCalls || !m.toolCalls.length) && <span className="flex gap-1.5 text-[var(--text-muted)] text-lg"><span className="loading-dot">·</span><span className="loading-dot">·</span><span className="loading-dot">·</span></span>}
      </div>
    </div>
  );
}

function TokenBadge({ expiresIn, hasRefresh }: { expiresIn: number | null; hasRefresh: boolean }) {
  if (expiresIn === null) return null;
  const fmt = expiresIn > 3600 ? `${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m`
    : expiresIn > 60 ? `${Math.floor(expiresIn / 60)}m ${expiresIn % 60}s` : `${expiresIn}s`;
  const color = expiresIn < 300 ? "text-[var(--red)]" : expiresIn < 600 ? "text-[var(--amber)]" : "text-[var(--green)]";
  return <span className={`text-[12px] font-mono tabular-nums ${color}`}>{fmt}{hasRefresh && <span className="text-[var(--text-muted)]"> ↻</span>}</span>;
}

const LC: Record<string, "green" | "red" | "blue" | "amber" | "neutral"> = { ok: "green", error: "red", info: "blue", warn: "amber" };
function LogLine({ e }: { e: LogEntry }) {
  const ts = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false });
  const [open, setOpen] = useState(false);
  return (
    <div className={`flex items-start gap-3 py-1 px-2.5 text-[12px] font-mono hover:bg-white/[0.015] rounded-md transition-colors ${e.level === "error" ? "bg-red-500/[0.03]" : ""}`}>
      <span className="text-[var(--text-muted)] shrink-0 tabular-nums select-none">{ts}</span>
      <Badge color={LC[e.level] || "neutral"}>{e.level}</Badge>
      <span className="text-[var(--text-secondary)] break-words min-w-0 flex-1 leading-relaxed">
        {e.message}
        {e.details && <button onClick={() => setOpen(!open)} className="ml-1.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">{open ? "▾" : "▸"}</button>}
        {open && e.details && <pre className="text-[var(--text-muted)] whitespace-pre-wrap text-[11px] mt-1 leading-relaxed">{JSON.stringify(e.details, null, 2)}</pre>}
      </span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════ */

export default function Home() {
  const [transport, setTransport] = useState<Transport>("http");
  const [url, setUrl] = useState("");
  const [cmd, setCmd] = useState("");
  const [args, setArgs] = useState("");
  const [connName, setConnName] = useState("");
  const [hdrs, setHdrs] = useState<KV[]>([]);
  const [envs, setEnvs] = useState<KV[]>([]);
  const [showAuth, setShowAuth] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "pending" | "done">("idle");
  const [oauthUrl, setOauthUrl] = useState("");
  const [saved, setSaved] = useState<SavedConn[]>([]);
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [cKey, setCKey] = useState("");
  const [oKey, setOKey] = useState("");
  const [sKeys, setSKeys] = useState({ hasClaudeKey: false, hasOpenaiKey: false });
  const [prov, setProv] = useState<Provider>("claude");
  const [model, setModel] = useState(MODELS.claude[0]);
  const [sys, setSys] = useState("You are a helpful assistant. Use the available tools when appropriate.");
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSys, setShowSys] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);

  const msgEnd = useRef<HTMLDivElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const logBox = useRef<HTMLDivElement>(null);
  const pollIdx = useRef(0);
  const lastLogActivity = useRef(Date.now());
  const pollActive = useRef(true);

  const loadSaved = useCallback(async () => { try { const r = await fetch("/api/connections"); if (r.ok) { const d = await r.json(); if (Array.isArray(d)) setSaved(d); } } catch {} }, []);
  const loadActive = useCallback(async () => { try { const d = await (await fetch("/api/mcp/active")).json(); setActiveIds(new Set(d.activeIds)); } catch {} }, []);
  const loadTools = useCallback(async () => { try { const d = await (await fetch("/api/mcp/tools")).json(); if (Array.isArray(d)) setToolGroups(d); } catch {} }, []);

  useEffect(() => { loadSaved(); loadActive(); loadTools(); }, [loadSaved, loadActive, loadTools]);
  useEffect(() => { fetch("/api/config").then(r => r.json()).then(setSKeys).catch(() => {}); }, []);
  useEffect(() => { try { const s = localStorage.getItem("mcp-s3"); if (s) { const d = JSON.parse(s); d.cKey && setCKey(d.cKey); d.oKey && setOKey(d.oKey); d.sys && setSys(d.sys); } } catch {} }, []);
  useEffect(() => { localStorage.setItem("mcp-s3", JSON.stringify({ cKey, oKey, sys })); }, [cKey, oKey, sys]);
  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => { if (autoScroll) logEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [logs, autoScroll]);
  useEffect(() => { setModel(MODELS[prov][0]); }, [prov]);

  useEffect(() => {
    pollActive.current = true; lastLogActivity.current = Date.now();
    const poll = async () => { if (!pollActive.current) return; try { const d = await (await fetch(`/api/logs?after=${pollIdx.current}`)).json(); if (d.logs?.length) { setLogs(p => [...p, ...d.logs]); pollIdx.current = d.total; lastLogActivity.current = Date.now(); } } catch {} const idle = Date.now() - lastLogActivity.current; if (idle > 120000) return; setTimeout(poll, idle > 10000 ? 5000 : 800); };
    poll(); return () => { pollActive.current = false; };
  }, []);
  useEffect(() => { if (busy) lastLogActivity.current = Date.now(); }, [busy]);

  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.data?.type === "oauth_success") setOauthStatus("done"); if (e.data?.type === "oauth_error") { setErr(e.data.message || "OAuth failed"); setOauthStatus("idle"); setTogglingId(null); } };
    window.addEventListener("message", h); return () => window.removeEventListener("message", h);
  }, []);
  useEffect(() => { if (oauthStatus !== "done") return; setOauthStatus("idle"); const c = saved.find(s => s.url === oauthUrl); if (c) toggleConn(c); }, [oauthStatus]); // eslint-disable-line

  const startOAuth = useCallback(async (mcpUrl: string) => {
    setOauthStatus("pending"); setOauthUrl(mcpUrl); setErr(null);
    try { const d = await (await fetch("/api/mcp/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcpUrl }) })).json(); if (d.error) throw new Error(d.error); const w = 500, h = 650, left = window.screenX + (window.outerWidth - w) / 2, top = window.screenY + (window.outerHeight - h) / 2; window.open(d.authUrl, "mcp_oauth", `width=${w},height=${h},left=${left},top=${top},popup=yes`); }
    catch (e: any) { setErr(e.message); setOauthStatus("idle"); setTogglingId(null); }
  }, []);

  const toggleConn = useCallback(async (c: SavedConn) => {
    const isOn = activeIds.has(c.id); setTogglingId(c.id); setErr(null);
    try {
      if (isOn) { await fetch("/api/mcp/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: c.id }) }); }
      else {
        const t = c.transport || "http";
        const body: Record<string, unknown> = { connectionId: c.id, name: c.name, transport: t };
        if (t === "sse" || t === "http") { body.url = c.url; if (c.headers && Object.keys(c.headers).length) body.headers = c.headers; }
        else { body.command = c.command; body.args = c.args; if (c.env_vars && Object.keys(c.env_vars).length) body.env = c.env_vars; }
        const r = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await r.json();
        if (!r.ok) { if (d.needsAuth && t === "http" && c.url) { startOAuth(c.url); return; } throw new Error(d.error); }
      }
      await loadActive(); await loadTools(); await loadSaved();
    } catch (e: any) { setErr(e.message); } finally { setTogglingId(null); }
  }, [activeIds, startOAuth, loadActive, loadTools, loadSaved]);

  const saveAndConnect = useCallback(async () => {
    if (!connName.trim()) { setErr("Give this connection a name."); return; }
    setErr(null); setSaving(true);
    try {
      const connBody: Record<string, unknown> = { connectionId: `temp-${Date.now()}`, name: connName, transport };
      if (transport !== "stdio") { connBody.url = url; const h: Record<string, string> = {}; hdrs.forEach(kv => { if (kv.key.trim()) h[kv.key.trim()] = kv.value; }); if (Object.keys(h).length) connBody.headers = h; }
      else { connBody.command = cmd; connBody.args = args.split(/\s+/).filter(Boolean); const e: Record<string, string> = {}; envs.forEach(kv => { if (kv.key.trim()) e[kv.key.trim()] = kv.value; }); if (Object.keys(e).length) connBody.env = e; }
      const cr = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connBody) });
      const cd = await cr.json();
      if (!cr.ok) { if (cd.needsAuth && transport === "http") { setOauthUrl(url); startOAuth(url); return; } throw new Error(cd.error); }
      await fetch("/api/mcp/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: connBody.connectionId }) });
      const saveBody: Record<string, unknown> = { name: connName, transport };
      if (transport !== "stdio") { saveBody.url = url; const h: Record<string, string> = {}; hdrs.forEach(kv => { if (kv.key.trim()) h[kv.key.trim()] = kv.value; }); if (Object.keys(h).length) saveBody.headers = h; }
      else { saveBody.command = cmd; saveBody.args = args.split(/\s+/).filter(Boolean); const e: Record<string, string> = {}; envs.forEach(kv => { if (kv.key.trim()) e[kv.key.trim()] = kv.value; }); if (Object.keys(e).length) saveBody.env_vars = e; }
      const sr = await (await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saveBody) })).json();
      connBody.connectionId = sr.id;
      await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connBody) });
      setConnName(""); setUrl(""); setCmd(""); setArgs(""); setHdrs([]); setEnvs([]);
      await loadSaved(); await loadActive(); await loadTools();
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  }, [connName, transport, url, cmd, args, hdrs, envs, startOAuth, loadSaved, loadActive, loadTools]);

  const deleteSaved = useCallback(async (c: SavedConn) => {
    if (activeIds.has(c.id)) await fetch("/api/mcp/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: c.id }) });
    await fetch(`/api/connections/${c.id}`, { method: "DELETE" });
    await loadSaved(); await loadActive(); await loadTools();
  }, [activeIds, loadSaved, loadActive, loadTools]);

  const totalTools = toolGroups.reduce((s, g) => s + g.tools.length, 0);
  const hasActive = activeIds.size > 0;

  return (
    <div className="h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT ═══ */}
        <aside className="w-[300px] flex-shrink-0 border-r border-[var(--border)] flex flex-col">
          <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">

            <div className="flex items-center justify-between">
              <span className="text-[16px] font-semibold text-[var(--text)] tracking-tight">mcp tester</span>
              {hasActive && <Badge color="green">{activeIds.size} active</Badge>}
            </div>

            {/* form */}
            <section className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Add Connection</label>
              <Input value={connName} onChange={e => setConnName(e.target.value)} placeholder="Connection name" />
              <div className="grid grid-cols-3 gap-1 bg-[var(--bg-input)] p-1 rounded-lg border border-[var(--border)]">
                {(["http", "sse", "stdio"] as const).map(t => (
                  <button key={t} onClick={() => setTransport(t)}
                    className={`py-1.5 text-[12px] font-semibold rounded-md transition-all ${transport === t ? "bg-[var(--bg-hover)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                    {t === "http" ? "HTTP" : t.toUpperCase()}
                  </button>
                ))}
              </div>
              {transport !== "stdio" ? (
                <Input value={url} onChange={e => setUrl(e.target.value)} placeholder={transport === "http" ? "https://mcp.example.com/mcp" : "http://localhost:3001/sse"} />
              ) : (
                <div className="space-y-2">
                  <Input value={cmd} onChange={e => setCmd(e.target.value)} placeholder="npx" />
                  <Input value={args} onChange={e => setArgs(e.target.value)} placeholder="-y @mcp/server /tmp" className="font-mono !text-[12px]" />
                </div>
              )}

              <button onClick={() => setShowAuth(!showAuth)} className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
                <span className={`transition-transform duration-150 ${showAuth ? "rotate-90" : ""}`}>{I.chev}</span>
                {transport === "stdio" ? "Environment variables" : "Custom headers"}
              </button>
              {showAuth && <div className="pl-5">{transport === "stdio" ? <KVEditor items={envs} setItems={setEnvs} kPh="TOKEN" vPh="value" /> : <KVEditor items={hdrs} setItems={setHdrs} kPh="Authorization" vPh="Bearer ..." />}</div>}

              {err && <div className="text-[13px] text-[var(--red)] bg-red-400/5 border border-red-400/10 rounded-lg px-3 py-2.5 flex gap-2 items-start leading-relaxed"><span className="shrink-0 mt-0.5">{I.x}</span><span>{err}</span></div>}
              {oauthStatus === "pending" && <div className="flex items-center gap-2 text-[13px] text-[var(--amber)] bg-amber-400/5 border border-amber-400/10 rounded-lg px-3 py-2.5">{I.spin} Waiting for login…</div>}

              <Btn variant="primary" onClick={saveAndConnect} disabled={saving || !connName.trim() || (transport !== "stdio" && !url) || (transport === "stdio" && !cmd)} className="w-full">
                {saving ? <>{I.spin} Connecting…</> : <>Save & Connect {I.arrow}</>}
              </Btn>
            </section>

            <div className="border-t border-[var(--border)]" />

            {/* keys */}
            <section className="space-y-3">
              <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">API Keys</label>
              {([{ label: "Anthropic", has: sKeys.hasClaudeKey, val: cKey, set: setCKey, ph: "sk-ant-..." }, { label: "OpenAI", has: sKeys.hasOpenaiKey, val: oKey, set: setOKey, ph: "sk-..." }] as const).map(k => (
                <div key={k.label}>
                  <span className="text-[13px] text-[var(--text-secondary)]">{k.label}</span>
                  {k.has
                    ? <div className="flex items-center gap-2 mt-1.5 text-[12px] text-[var(--green)]">{I.check} From .env.local</div>
                    : <Input type="password" value={k.val} onChange={e => k.set(e.target.value)} placeholder={k.ph} className="mt-1.5" />}
                </div>
              ))}
            </section>

            {/* tools */}
            {toolGroups.length > 0 && (
              <>
                <div className="border-t border-[var(--border)]" />
                <section className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Tools ({totalTools})</label>
                  {toolGroups.map(g => {
                    const isOpen = openGroups.has(g.connectionId);
                    return (
                      <div key={g.connectionId}>
                        <button onClick={() => setOpenGroups(prev => { const n = new Set(prev); isOpen ? n.delete(g.connectionId) : n.add(g.connectionId); return n; })}
                          className="flex items-center gap-2 w-full py-2 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text)] transition-colors rounded-md">
                          <span className={`transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`}>{I.chev}</span>
                          <span className="font-medium">{g.connectionName}</span>
                          <Badge>{g.tools.length}</Badge>
                        </button>
                        {isOpen && (
                          <div className="ml-5 space-y-1.5 mt-0.5 mb-2">
                            {g.tools.map((t: McpTool) => (
                              <div key={t.name} className="py-2 px-3 rounded-lg bg-[var(--bg-raised)] border border-[var(--border)]">
                                <code className="text-[12px] font-semibold text-[var(--text)]">{t.name}</code>
                                {t.description && <p className="text-[11px] text-[var(--text-muted)] leading-relaxed mt-1 break-words">{t.description}</p>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </div>
        </aside>

        {/* ═══ CENTER ═══ */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* toolbar */}
          <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--border)]">
            <div className="grid grid-cols-2 gap-px bg-[var(--bg-input)] rounded-lg border border-[var(--border)] p-0.5">
              {(["claude", "openai"] as const).map(p => (
                <button key={p} onClick={() => setProv(p)}
                  className={`px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${prov === p ? "bg-[var(--bg-hover)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                  {p === "claude" ? "Claude" : "OpenAI"}
                </button>
              ))}
            </div>
            <select value={model} onChange={e => setModel(e.target.value)}
              className="h-8 bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-secondary)] text-[13px] rounded-lg px-3 focus:outline-none focus:border-[var(--border-hover)] cursor-pointer font-mono">
              {MODELS[prov].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <Btn variant={showSys ? "default" : "ghost"} onClick={() => setShowSys(!showSys)} className={showSys ? "!border-[var(--border-hover)]" : ""}>System</Btn>
            {msgs.length > 0 && <Btn variant="ghost" onClick={() => setMsgs([])} className="ml-auto">Clear chat</Btn>}
          </div>

          {showSys && (
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <textarea value={sys} onChange={e => setSys(e.target.value)} rows={2} placeholder="System prompt…"
                className="w-full bg-[var(--bg-input)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] focus:bg-[var(--bg-hover)] resize-y font-mono leading-relaxed transition-all" />
            </div>
          )}

          {/* messages */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {msgs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center gap-2">
                <p className="text-[15px] text-[var(--text-muted)]">{hasActive ? "Send a message to start testing." : "Toggle on an MCP to start."}</p>
                {hasActive && <p className="text-[12px] text-[var(--text-muted)]">{totalTools} tools available from {toolGroups.length} connection{toolGroups.length !== 1 ? "s" : ""}</p>}
              </div>
            )}
            <div className="max-w-[720px] mx-auto">{msgs.map(m => <Msg key={m.id} m={m} />)}<div ref={msgEnd} /></div>
          </div>

          {/* input */}
          <div className="border-t border-[var(--border)] px-6 py-4">
            <div className="max-w-[720px] mx-auto flex gap-3 items-end">
              <textarea value={inp} onChange={e => setInp(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                placeholder={!hasActive ? "Toggle on an MCP first…" : busy ? "Thinking…" : "Message… (Enter to send)"}
                disabled={!hasActive || busy} rows={1}
                className="flex-1 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl px-4 py-3 text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] focus:bg-[var(--bg-hover)] resize-none max-h-36 transition-all disabled:opacity-30" />
              <button onClick={handleSend} disabled={!hasActive || busy || !inp.trim()}
                className="h-11 w-11 flex items-center justify-center bg-white text-[#111] rounded-xl hover:bg-neutral-200 active:bg-neutral-300 transition-all disabled:opacity-15 disabled:pointer-events-none shrink-0">
                {busy ? I.spin : I.send}
              </button>
            </div>
          </div>
        </main>

        {/* ═══ RIGHT ═══ */}
        <aside className="w-[264px] flex-shrink-0 border-l border-[var(--border)] flex flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Connections{saved.length > 0 ? ` (${saved.length})` : ""}
              </label>
              <a href="/discover" className="text-[11px] font-semibold text-[var(--blue)] hover:underline">Discover MCPs →</a>
            </div>
            {saved.length === 0 && <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">Save a connection from the left panel or <a href="/discover" className="text-[var(--blue)] hover:underline">discover MCPs</a>.</p>}
            {saved.map(c => {
              const isOn = activeIds.has(c.id);
              const isLoading = togglingId === c.id;
              return (
                <div key={c.id} className={`group rounded-xl border transition-all ${isOn ? "bg-[var(--bg-raised)] border-[var(--border-hover)]" : "border-[var(--border)] hover:border-[var(--border-hover)]"}`}>
                  <div className="px-3.5 py-3">
                    <div className="flex items-center gap-3">
                      <Toggle on={isOn} loading={isLoading} onClick={() => toggleConn(c)} />
                      <span className="text-[13px] font-medium text-[var(--text)] truncate flex-1">{c.name}</span>
                      <Badge>{(c.transport || "http").toUpperCase()}</Badge>
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] truncate font-mono mt-2 ml-[52px]">{c.url || c.command}</div>
                    {c.hasToken && <div className="mt-1.5 ml-[52px]"><TokenBadge expiresIn={c.tokenExpiresIn} hasRefresh={c.hasRefresh} /></div>}
                  </div>
                  <div className="flex justify-end px-3 pb-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => deleteSaved(c)} className="text-[var(--text-muted)] hover:text-[var(--red)] p-1 rounded-md hover:bg-white/[0.03] transition-all">{I.trash}</button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* ═══ LOGS ═══ */}
      {showLogs ? (
        <div className="h-48 flex-shrink-0 border-t border-[var(--border)] flex flex-col" style={{ background: "#090909" }}>
          <div className="flex items-center gap-3 px-4 h-9 border-b border-[var(--border)] shrink-0">
            <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] font-medium">{I.term} Logs</span>
            <span className="text-[var(--text-muted)] text-[12px] tabular-nums">{logs.length}</span>
            <Btn variant="ghost" onClick={() => { setLogs([]); pollIdx.current = 0; }}>Clear</Btn>
            <Btn variant="ghost" onClick={() => setShowLogs(false)} className="ml-auto">Hide ↓</Btn>
          </div>
          <div ref={logBox} onScroll={() => { const el = logBox.current; if (el) setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40); }} className="flex-1 overflow-y-auto px-1.5 py-1">
            {logs.length === 0 && <p className="text-[12px] text-[var(--text-muted)] font-mono px-2 py-3">Waiting for events…</p>}
            {logs.map(e => <LogLine key={e.id} e={e} />)}<div ref={logEnd} />
          </div>
        </div>
      ) : (
        <button onClick={() => setShowLogs(true)} className="border-t border-[var(--border)] h-8 px-4 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1.5 transition-colors" style={{ background: "#090909" }}>
          {I.term} Logs {logs.length > 0 && <span className="tabular-nums text-[12px]">({logs.length})</span>} ↑
        </button>
      )}
    </div>
  );

  function handleSend() {
    if (!inp.trim() || busy || !hasActive) return;
    const apiKey = prov === "claude" ? cKey : oKey;
    const hasKey = prov === "claude" ? sKeys.hasClaudeKey : sKeys.hasOpenaiKey;
    if (!apiKey && !hasKey) { setErr(`No ${prov} API key.`); return; }
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: inp.trim() };
    const newMsgs = [...msgs, userMsg];
    setMsgs([...newMsgs, { id: crypto.randomUUID(), role: "assistant", content: "", toolCalls: [] }]); setInp(""); setBusy(true);
    lastLogActivity.current = Date.now(); pollActive.current = true;
    (async () => {
      try {
        const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: newMsgs.map(m => ({ role: m.role, content: m.content })), provider: prov, apiKey: apiKey || "", model, systemPrompt: sys }) });
        if (!r.ok) { const e = await r.json(); throw new Error(e.error); }
        const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = "";
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const ln of lines) { if (!ln.startsWith("data: ")) continue; try { const ev = JSON.parse(ln.slice(6)); setMsgs(prev => { const u = [...prev]; const l = { ...u[u.length - 1] }; if (ev.type === "text") l.content += ev.content; else if (ev.type === "tool_call") l.toolCalls = [...(l.toolCalls || []), { id: ev.id, name: ev.name, arguments: ev.arguments, status: "calling" }]; else if (ev.type === "tool_result") l.toolCalls = (l.toolCalls || []).map(tc => tc.id === ev.id ? { ...tc, result: ev.result, status: "done" as const } : tc); else if (ev.type === "error") l.content += `\n\nError: ${ev.message}`; u[u.length - 1] = l; return u; }); } catch {} }
        }
      } catch (e: any) { setMsgs(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: `Error: ${e.message}` }; return u; }); }
      finally { setBusy(false); lastLogActivity.current = Date.now(); }
    })();
  }
}
