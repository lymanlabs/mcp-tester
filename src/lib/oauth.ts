import crypto from "crypto";
import { getTokenForUrl, saveToken as dbSaveToken } from "./db";

/* ── types ────────────────────────────────────────────────── */

interface OAuthMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

interface PendingAuth {
  codeVerifier: string;
  state: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  tokenEndpoint: string;
  mcpUrl: string;
}

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
}

/* ── manager ──────────────────────────────────────────────── */

class OAuthManager {
  private pending = new Map<string, PendingAuth>(); // keyed by state
  private tokens = new Map<string, StoredToken>(); // keyed by mcpUrl

  /* ── PKCE helpers ── */

  private generateVerifier(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  private generateChallenge(verifier: string): string {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }

  /* ── discovery ── */

  /** Try to fetch and follow a resource metadata URL to get the auth server config */
  private async followResourceMetadata(resourceMetadataUrl: string): Promise<OAuthMetadata | null> {
    try {
      const prm = await fetch(resourceMetadataUrl, { headers: { Accept: "application/json" } });
      if (!prm.ok) return null;
      const data = await prm.json();
      if (data.authorization_servers?.[0]) {
        const authServer = data.authorization_servers[0];
        const asMeta = await fetch(`${authServer}/.well-known/oauth-authorization-server`, { headers: { Accept: "application/json" } });
        if (asMeta.ok) return asMeta.json();
      }
    } catch {}
    return null;
  }

  async discoverMetadata(mcpUrl: string): Promise<OAuthMetadata> {
    const parsed = new URL(mcpUrl);
    const origin = parsed.origin;
    const pathname = parsed.pathname; // e.g. "/mcp"

    // Try 1: Probe the MCP endpoint itself and parse www-authenticate header
    // Some servers (like Supabase) return the exact metadata URL in the 401 response
    try {
      const probe = await fetch(mcpUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (probe.status === 401) {
        const wwwAuth = probe.headers.get("www-authenticate") || "";
        const metaMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
        if (metaMatch) {
          const result = await this.followResourceMetadata(metaMatch[1]);
          if (result) return result;
        }
      }
    } catch {}

    // Try 2: Protected resource metadata at sub-path (MCP spec)
    // e.g. https://mcp.supabase.com/.well-known/oauth-protected-resource/mcp
    if (pathname && pathname !== "/") {
      const result = await this.followResourceMetadata(`${origin}/.well-known/oauth-protected-resource${pathname}`);
      if (result) return result;
    }

    // Try 3: Protected resource metadata at root
    // e.g. https://mcp.granola.ai/.well-known/oauth-protected-resource
    {
      const result = await this.followResourceMetadata(`${origin}/.well-known/oauth-protected-resource`);
      if (result) return result;
    }

    // Try 4: Direct auth server metadata on the origin
    try {
      const res = await fetch(`${origin}/.well-known/oauth-authorization-server`, { headers: { Accept: "application/json" } });
      if (res.ok) return res.json();
    } catch {}

    // Try 5: OpenID configuration
    try {
      const res = await fetch(`${origin}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
      if (res.ok) return res.json();
    } catch {}

    throw new Error(
      "Could not discover OAuth metadata. The server may not support OAuth or uses a non-standard auth mechanism."
    );
  }

  /* ── dynamic client registration ── */

  async registerClient(
    registrationEndpoint: string,
    redirectUri: string
  ): Promise<{ clientId: string; clientSecret?: string }> {
    const res = await fetch(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP Tester",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Client registration failed (${res.status}): ${body}`);
    }

    const data = await res.json();
    return {
      clientId: data.client_id,
      clientSecret: data.client_secret,
    };
  }

  /* ── start flow ── */

  async startFlow(
    mcpUrl: string,
    callbackUrl: string
  ): Promise<{ authUrl: string; state: string }> {
    const metadata = await this.discoverMetadata(mcpUrl);

    const verifier = this.generateVerifier();
    const challenge = this.generateChallenge(verifier);
    const state = crypto.randomBytes(16).toString("hex");

    // Dynamic client registration
    let clientId = "mcp-tester";
    let clientSecret: string | undefined;

    if (metadata.registration_endpoint) {
      try {
        const reg = await this.registerClient(
          metadata.registration_endpoint,
          callbackUrl
        );
        clientId = reg.clientId;
        clientSecret = reg.clientSecret;
      } catch (err) {
        console.warn("Dynamic registration failed, using default client_id:", err);
      }
    }

    // Store state for callback
    this.pending.set(state, {
      codeVerifier: verifier,
      state,
      clientId,
      clientSecret,
      redirectUri: callbackUrl,
      tokenEndpoint: metadata.token_endpoint,
      mcpUrl,
    });

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: callbackUrl,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    return {
      authUrl: `${metadata.authorization_endpoint}?${params}`,
      state,
    };
  }

  /* ── exchange code for token ── */

  async exchangeCode(
    state: string,
    code: string
  ): Promise<{ mcpUrl: string; accessToken: string }> {
    const pending = this.pending.get(state);
    if (!pending) throw new Error("Unknown OAuth state — flow may have expired.");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
      code_verifier: pending.codeVerifier,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    // If we have a client_secret, include it
    if (pending.clientSecret) {
      const creds = Buffer.from(
        `${pending.clientId}:${pending.clientSecret}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${creds}`;
    }

    const res = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${errBody}`);
    }

    const data = await res.json();

    // Store token keyed by MCP URL (include refresh metadata)
    this.tokens.set(pending.mcpUrl, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? Date.now() + data.expires_in * 1000
        : undefined,
      tokenEndpoint: pending.tokenEndpoint,
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
    });

    const mcpUrl = pending.mcpUrl;
    this.pending.delete(state);

    return { mcpUrl, accessToken: data.access_token };
  }

  /* ── token refresh ── */

  private async refreshAccessToken(tok: StoredToken): Promise<boolean> {
    if (!tok.refreshToken) return false;

    try {
      const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tok.refreshToken,
        client_id: tok.clientId,
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };

      if (tok.clientSecret) {
        const creds = Buffer.from(`${tok.clientId}:${tok.clientSecret}`).toString("base64");
        headers["Authorization"] = `Basic ${creds}`;
      }

      const res = await fetch(tok.tokenEndpoint, { method: "POST", headers, body: body.toString() });
      if (!res.ok) return false;

      const data = await res.json();
      tok.accessToken = data.access_token;
      if (data.refresh_token) tok.refreshToken = data.refresh_token;
      tok.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
      return true;
    } catch {
      return false;
    }
  }

  /* ── token access ── */

  /** Optional: persist token to a saved connection in DB */
  persistToDb(connectionId: string, mcpUrl: string) {
    const tok = this.tokens.get(mcpUrl);
    if (!tok) return;
    dbSaveToken(connectionId, {
      accessToken: tok.accessToken,
      refreshToken: tok.refreshToken,
      expiresAt: tok.expiresAt,
      tokenEndpoint: tok.tokenEndpoint,
      clientId: tok.clientId,
      clientSecret: tok.clientSecret,
    });
  }

  /** Load token from DB into memory (for restoring across restarts) */
  loadFromDb(mcpUrl: string): boolean {
    if (this.tokens.has(mcpUrl)) return true; // already loaded
    const dbTok = getTokenForUrl(mcpUrl);
    if (!dbTok) return false;
    this.tokens.set(mcpUrl, {
      accessToken: dbTok.accessToken,
      refreshToken: dbTok.refreshToken,
      expiresAt: dbTok.expiresAt,
      tokenEndpoint: dbTok.tokenEndpoint,
      clientId: dbTok.clientId,
      clientSecret: dbTok.clientSecret,
    });
    return true;
  }

  async getToken(mcpUrl: string): Promise<string | null> {
    // Try loading from DB if not in memory
    if (!this.tokens.has(mcpUrl)) this.loadFromDb(mcpUrl);
    const tok = this.tokens.get(mcpUrl);
    if (!tok) return null;

    // If token is expired or within 5 min of expiring, try to refresh
    const almostExpired = tok.expiresAt && (Date.now() > tok.expiresAt - 5 * 60_000);
    if (almostExpired) {
      // Try up to 2 times in case of a transient network blip
      let refreshed = await this.refreshAccessToken(tok);
      if (!refreshed) refreshed = await this.refreshAccessToken(tok);
      if (!refreshed) {
        this.tokens.delete(mcpUrl);
        return null; // both attempts failed — user needs to re-auth
      }
    }

    return tok.accessToken;
  }

  hasTokenSync(mcpUrl: string): boolean {
    return this.tokens.has(mcpUrl);
  }

  /** Returns expiry info without exposing the actual token */
  getTokenStatus(mcpUrl: string): { hasToken: boolean; expiresAt: number | null; expiresIn: number | null; hasRefresh: boolean } {
    const tok = this.tokens.get(mcpUrl);
    if (!tok) return { hasToken: false, expiresAt: null, expiresIn: null, hasRefresh: false };
    const expiresIn = tok.expiresAt ? Math.max(0, Math.round((tok.expiresAt - Date.now()) / 1000)) : null;
    return {
      hasToken: true,
      expiresAt: tok.expiresAt ?? null,
      expiresIn,
      hasRefresh: !!tok.refreshToken,
    };
  }

  clearToken(mcpUrl: string) {
    this.tokens.delete(mcpUrl);
  }
}

/* ── singleton ────────────────────────────────────────────── */

const g = globalThis as unknown as { oauthMgr: OAuthManager };
export const oauthManager = g.oauthMgr ?? new OAuthManager();
if (process.env.NODE_ENV !== "production") g.oauthMgr = oauthManager;

