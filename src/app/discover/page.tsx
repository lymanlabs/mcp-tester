"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface RegistryMcp {
  id: number;
  url: string;
  display_name: string | null;
  description: string | null;
  auth_type: string;
  healthy: boolean;
  tool_count: number;
  categories: string[];
}

const I = {
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  spin: <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 anim-spin"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-15"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><polyline points="20 6 9 17 4 12"/></svg>,
  arrow: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>,
  lock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  unlock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>,
};

function Badge({ children, color = "neutral" }: { children: React.ReactNode; color?: "neutral" | "green" | "red" | "blue" | "amber" }) {
  const c = { neutral: "bg-white/[0.06] text-[var(--text-secondary)]", green: "bg-emerald-500/10 text-emerald-400", red: "bg-red-400/10 text-red-400", blue: "bg-blue-400/10 text-blue-400", amber: "bg-amber-400/10 text-amber-400" };
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium tracking-wide ${c[color]}`}>{children}</span>;
}

type AuthFilter = "all" | "none" | "oauth2";

export default function Discover() {
  const [mcps, setMcps] = useState<RegistryMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [authFilter, setAuthFilter] = useState<AuthFilter>("all");
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<number | null>(null);
  const [connectedUrls, setConnectedUrls] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/registry");
        const d = await r.json();
        if (Array.isArray(d)) setMcps(d);
      } catch {} finally { setLoading(false); }
    })();
  }, []);

  // Load existing saved connections to mark as connected
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/connections");
        const d = await r.json();
        if (Array.isArray(d)) setConnectedUrls(new Set(d.map((c: any) => c.url).filter(Boolean)));
      } catch {}
    })();
  }, []);

  // Listen for OAuth callback
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.data?.type === "oauth_success") setOauthPending(false);
      if (e.data?.type === "oauth_error") { setErr(e.data.message || "OAuth failed"); setOauthPending(false); setConnectingId(null); }
    };
    window.addEventListener("message", h);
    return () => window.removeEventListener("message", h);
  }, []);

  const connect = useCallback(async (mcp: RegistryMcp) => {
    setConnectingId(mcp.id); setErr(null);
    try {
      const name = mcp.display_name || mcp.url;
      const tempId = `temp-${Date.now()}`;

      // Test connection
      const cr = await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: tempId, name, transport: "http", url: mcp.url }) });
      const cd = await cr.json();

      if (!cr.ok) {
        if (cd.needsAuth) {
          // Start OAuth flow
          setOauthPending(true);
          const d = await (await fetch("/api/mcp/oauth/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mcpUrl: mcp.url }) })).json();
          if (d.error) throw new Error(d.error);
          const w = 500, h = 650, left = window.screenX + (window.outerWidth - w) / 2, top = window.screenY + (window.outerHeight - h) / 2;
          window.open(d.authUrl, "mcp_oauth", `width=${w},height=${h},left=${left},top=${top},popup=yes`);
          return;
        }
        throw new Error(cd.error);
      }

      // Disconnect temp, save permanently, reconnect
      await fetch("/api/mcp/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: tempId }) });
      const sr = await (await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, transport: "http", url: mcp.url }) })).json();
      await fetch("/api/mcp/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId: sr.id, name, transport: "http", url: mcp.url }) });

      router.push("/");
    } catch (e: any) { setErr(e.message); } finally { setConnectingId(null); }
  }, []);

  // Gather all categories for filter
  const allCats = Array.from(new Set(mcps.flatMap(m => m.categories))).sort();

  const filtered = mcps.filter(m => {
    if (authFilter === "none" && m.auth_type !== "none") return false;
    if (authFilter === "oauth2" && m.auth_type !== "oauth2") return false;
    if (catFilter && !m.categories.includes(catFilter)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (m.display_name || "").toLowerCase().includes(q)
      || (m.description || "").toLowerCase().includes(q)
      || m.url.toLowerCase().includes(q)
      || m.categories.some(c => c.includes(q));
  });

  const openCount = mcps.filter(m => m.auth_type === "none").length;
  const oauthCount = mcps.filter(m => m.auth_type === "oauth2").length;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)" }}>

      {/* Header */}
      <header className="border-b border-[var(--border)] px-6 py-5">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4">
          <a href="/" className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
            {I.arrow}
          </a>
          <div className="flex-1">
            <h1 className="text-[20px] font-semibold tracking-tight text-[var(--text)]">Discover MCPs</h1>
            <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{mcps.length} healthy MCPs available</p>
          </div>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-6">

        {/* Search + filters */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{I.search}</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, description, URL, or category..."
              className="w-full h-11 bg-[var(--bg-input)] border border-[var(--border)] rounded-xl pl-10 pr-4 text-[14px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-hover)] focus:bg-[var(--bg-hover)] transition-all"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Auth filter */}
            {([
              { key: "all" as AuthFilter, label: "All", count: mcps.length },
              { key: "none" as AuthFilter, label: "No Auth Required", count: openCount },
              { key: "oauth2" as AuthFilter, label: "OAuth Required", count: oauthCount },
            ]).map(f => (
              <button key={f.key} onClick={() => setAuthFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${authFilter === f.key
                  ? "bg-white/[0.08] text-[var(--text)] border border-[var(--border-hover)]"
                  : "text-[var(--text-muted)] border border-transparent hover:text-[var(--text-secondary)] hover:border-[var(--border)]"
                }`}>
                {f.label} <span className="text-[var(--text-muted)] ml-1">{f.count}</span>
              </button>
            ))}

            {/* Divider */}
            <div className="w-px h-5 bg-[var(--border)] mx-1" />

            {/* Category dropdown */}
            <select
              value={catFilter || ""}
              onChange={e => setCatFilter(e.target.value || null)}
              className="h-8 bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-secondary)] text-[12px] rounded-lg px-2.5 focus:outline-none focus:border-[var(--border-hover)] cursor-pointer">
              <option value="">All categories</option>
              {allCats.map(c => <option key={c} value={c}>{c.replace(/-/g, " ")}</option>)}
            </select>

            <span className="text-[12px] text-[var(--text-muted)] ml-auto">{filtered.length} results</span>
          </div>
        </div>

        {/* Error */}
        {err && (
          <div className="mb-4 text-[13px] text-[var(--red)] bg-red-400/5 border border-red-400/10 rounded-lg px-4 py-3 flex items-center gap-2">
            <span>{err}</span>
            <button onClick={() => setErr(null)} className="ml-auto text-[var(--text-muted)] hover:text-[var(--red)]">✕</button>
          </div>
        )}
        {oauthPending && (
          <div className="mb-4 flex items-center gap-2 text-[13px] text-[var(--amber)] bg-amber-400/5 border border-amber-400/10 rounded-lg px-4 py-3">
            {I.spin} Waiting for OAuth login…
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
            {I.spin} <span className="ml-2">Loading registry...</span>
          </div>
        )}

        {/* Grid */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(m => {
              const isConnected = connectedUrls.has(m.url);
              const isConnecting = connectingId === m.id;
              const isOpen = m.auth_type === "none";

              return (
                <div key={m.id} className="rounded-xl border border-[var(--border)] hover:border-[var(--border-hover)] bg-[var(--bg-raised)] transition-all flex flex-col">
                  <div className="px-4 py-4 flex-1">
                    {/* Name + auth badge */}
                    <div className="flex items-start gap-2 mb-2">
                      <h3 className="text-[14px] font-semibold text-[var(--text)] leading-tight flex-1">{m.display_name || m.url}</h3>
                      {isOpen
                        ? <Badge color="green">{I.unlock} Open</Badge>
                        : <Badge color="amber">{I.lock} OAuth</Badge>
                      }
                    </div>

                    {/* Description */}
                    {m.description && (
                      <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mb-3 line-clamp-2">{m.description}</p>
                    )}

                    {/* URL */}
                    <div className="text-[11px] text-[var(--text-muted)] font-mono truncate mb-3">{m.url}</div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge>{m.tool_count} tools</Badge>
                      {m.categories.slice(0, 2).map(c => (
                        <Badge key={c}>{c.replace(/-/g, " ")}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-4 py-3 border-t border-[var(--border)] flex items-center">
                    {isConnected ? (
                      <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-400">{I.check} Connected</span>
                    ) : (
                      <button onClick={() => connect(m)} disabled={isConnecting}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-white text-[#111] hover:bg-neutral-200 active:bg-neutral-300 transition-all disabled:opacity-50">
                        {isConnecting ? <>{I.spin} Connecting…</> : <>{I.plus} Connect</>}
                      </button>
                    )}
                    {!isOpen && !isConnected && (
                      <span className="ml-auto text-[11px] text-[var(--text-muted)]">Requires login</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <p className="text-[15px] text-[var(--text-muted)]">No MCPs match your filters.</p>
          </div>
        )}
      </div>
    </div>
  );
}
