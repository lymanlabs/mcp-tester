import { oauthManager } from "@/lib/oauth";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDesc = searchParams.get("error_description");

  // Return an HTML page that communicates result to the opener and closes itself
  const html = (msg: string, ok: boolean) => `<!DOCTYPE html>
<html><head><title>MCP Tester — OAuth</title>
<style>body{font-family:-apple-system,sans-serif;background:#111;color:#e5e5e5;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center;max-width:360px}.ok{color:#22c55e}.err{color:#ef4444}code{background:#222;padding:2px 6px;border-radius:4px;font-size:12px}</style></head>
<body><div class="box">
<p class="${ok ? "ok" : "err"}">${msg}</p>
<p style="color:#555;font-size:13px">${ok ? "This window will close automatically." : "Close this window and try again."}</p>
</div>
<script>
window.opener?.postMessage(${JSON.stringify({ type: ok ? "oauth_success" : "oauth_error", message: msg })}, "*");
${ok ? "setTimeout(() => window.close(), 1500);" : ""}
</script></body></html>`;

  if (error) {
    return new Response(html(`OAuth error: ${errorDesc || error}`, false), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code || !state) {
    return new Response(html("Missing code or state parameter.", false), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    await oauthManager.exchangeCode(state, code);
    return new Response(html("Authenticated successfully.", true), {
      headers: { "Content-Type": "text/html" },
    });
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    return new Response(html(`Token exchange failed: ${err.message}`, false), {
      headers: { "Content-Type": "text/html" },
    });
  }
}


