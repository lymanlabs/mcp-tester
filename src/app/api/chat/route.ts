import { mcpManager } from "@/lib/mcp-manager";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// Allow up to 2 minutes for the full tool-use loop to complete
export const maxDuration = 120;

export async function POST(req: Request) {
  // The frontend sends: the conversation so far, which LLM to use, API key, model, and system prompt.
  // Notice: NO MCP url is sent. The frontend doesn't know or care about MCP connections.
  const { messages, provider, apiKey: clientApiKey, model, systemPrompt } = await req.json();

  // We need at least one MCP toggled on, otherwise there are no tools to use
  if (mcpManager.getActiveCount() === 0) {
    return new Response(JSON.stringify({ error: "No active MCP connections." }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // Resolve API key: prefer what the frontend sent, fall back to .env.local
  let apiKey = clientApiKey;
  if (!apiKey) {
    if (provider === "claude") apiKey = process.env.ANTHROPIC_API_KEY;
    else if (provider === "openai") apiKey = process.env.OPENAI_API_KEY;
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: `No API key for ${provider}.` }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  // ── THIS IS THE KEY PART ──
  // Grab every tool from every active MCP connection and merge them into one list.
  // If Granola has 4 tools and Notion has 12, allTools has 16 entries.
  // Each entry knows which MCP it came from (connectionId + connectionName).
  const allTools = mcpManager.getAllTools();
  mcpManager.log("info", `Chat → ${provider}/${model} with ${allTools.length} tools from ${mcpManager.getActiveCount()} MCP(s)`);

  // Set up a Server-Sent Events stream so the frontend gets real-time updates
  // (text as it comes, tool calls as they happen, results as they return)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Helper to push an event to the frontend
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      try {
        // Route to the right handler based on which LLM the user picked
        if (provider === "claude") await handleClaude(allTools, messages, apiKey, model, systemPrompt, send);
        else if (provider === "openai") await handleOpenAI(allTools, messages, apiKey, model, systemPrompt, send);
        else send({ type: "error", message: `Unknown provider: ${provider}` });

        // Signal the frontend that the response is complete
        send({ type: "done" });
      } catch (error: any) {
        mcpManager.log("error", `LLM error: ${error.message}`);
        send({ type: "error", message: error.message });
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

/* ────────────────────────────────────────────────────────────
   CLAUDE HANDLER

   This runs the full tool-use loop with Anthropic's API.
   Claude never sees an MCP URL — it only sees tool definitions
   (name, description, parameter schema) and tool results.
   Our server executes the actual tool calls via the MCP connections.
   ──────────────────────────────────────────────────────────── */

async function handleClaude(
  allTools: { connectionId: string; connectionName: string; tool: any }[],
  messages: { role: string; content: string }[],
  apiKey: string, model: string, systemPrompt: string | undefined,
  send: (d: Record<string, unknown>) => void
) {
  const client = new Anthropic({ apiKey });

  // Convert MCP tools into Anthropic's format.
  // We prefix each description with [ConnectionName] so Claude knows context.
  // e.g. "[Granola] Query your meeting notes using natural language"
  const tools: Anthropic.Tool[] = allTools.map(t => ({
    name: t.tool.name,
    description: `[${t.connectionName}] ${t.tool.description || ""}`,
    input_schema: t.tool.inputSchema as Anthropic.Tool.InputSchema,
  }));

  // Build the conversation history in Anthropic's format
  const currentMessages: Anthropic.MessageParam[] = messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // ── THE TOOL-USE LOOP ──
  // Claude might call tools, which produce results, which Claude reads and might call more tools.
  // This loop runs until Claude responds with just text (no tool calls) or we hit 25 iterations.
  let iterations = 0;

  while (iterations++ < 25) {
    // Send the conversation + tools to Claude
    const params: Anthropic.MessageCreateParams = { model, max_tokens: 4096, messages: currentMessages };
    if (systemPrompt) params.system = systemPrompt;
    if (tools.length > 0) params.tools = tools;

    // ── STEP 1: Ask Claude ──
    const response = await client.messages.create(params);

    // ── STEP 2: Parse Claude's response ──
    // Claude returns an array of "content blocks". Each block is either:
    //   - { type: "text", text: "..." }           → Claude is talking
    //   - { type: "tool_use", name: "...", input: {...} } → Claude wants to call a tool
    let hasToolUse = false;
    const content: Anthropic.ContentBlock[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        // Stream text to the frontend immediately
        send({ type: "text", content: block.text });
        content.push(block);
      }
      else if (block.type === "tool_use") {
        hasToolUse = true;
        // Tell the frontend "Claude wants to call this tool" (shows the spinner in the UI)
        send({ type: "tool_call", id: block.id, name: block.name, arguments: block.input as Record<string, unknown> });
        content.push(block);
      }
    }

    // ── STEP 3: If no tool calls, we're done ──
    // Claude just responded with text. Loop ends, response is complete.
    if (!hasToolUse) break;

    // ── STEP 4: Execute tool calls ourselves ──
    // Add Claude's response (with tool_use blocks) to the conversation
    currentMessages.push({ role: "assistant", content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of content) {
      if (block.type !== "tool_use") continue;

      try {
        // THIS is where we actually hit the MCP server.
        // mcpManager.callTool() looks through all active connections,
        // finds which MCP owns this tool name, and calls it via the
        // MCP protocol (HTTP request with Bearer token to Granola/Notion/etc).
        const result = await mcpManager.callTool(block.name, block.input as Record<string, unknown>);

        // Convert MCP response to plain text
        const text = result.content.map((c: any) => c.type === "text" ? c.text : JSON.stringify(c)).join("\n");

        // Stream the tool result to the frontend (shows the result in the UI)
        send({ type: "tool_result", id: block.id, name: block.name, result: text });

        // Package it in Anthropic's tool_result format
        results.push({ type: "tool_result", tool_use_id: block.id, content: text });
      } catch (err: any) {
        // If the tool call fails, send the error as the result
        send({ type: "tool_result", id: block.id, name: block.name, result: `Error: ${err.message}` });
        results.push({ type: "tool_result", tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    // ── STEP 5: Feed results back to Claude ──
    // In Anthropic's format, tool results go in a "user" message.
    // The loop goes back to Step 1 — Claude sees the results and either
    // writes a final text response or decides to call more tools.
    currentMessages.push({ role: "user", content: results });
  }
}

/* ────────────────────────────────────────────────────────────
   OPENAI HANDLER

   Same loop, different API format.
   OpenAI uses "function" type tools instead of Anthropic's tool_use blocks.
   Tool results are sent as { role: "tool" } messages instead of tool_result blocks.
   But the concept is identical: send tools → LLM calls them → we execute → feed back → repeat.
   ──────────────────────────────────────────────────────────── */

async function handleOpenAI(
  allTools: { connectionId: string; connectionName: string; tool: any }[],
  messages: { role: string; content: string }[],
  apiKey: string, model: string, systemPrompt: string | undefined,
  send: (d: Record<string, unknown>) => void
) {
  const client = new OpenAI({ apiKey });

  // Convert MCP tools into OpenAI's format (type: "function")
  const tools: OpenAI.ChatCompletionTool[] = allTools.map(t => ({
    type: "function" as const,
    function: { name: t.tool.name, description: `[${t.connectionName}] ${t.tool.description || ""}`, parameters: t.tool.inputSchema },
  }));

  // Build conversation — OpenAI uses a "system" message for the prompt
  const currentMessages: OpenAI.ChatCompletionMessageParam[] = [];
  if (systemPrompt) currentMessages.push({ role: "system", content: systemPrompt });
  currentMessages.push(...messages.map(m => ({ role: m.role as "user" | "assistant", content: m.content }) as OpenAI.ChatCompletionMessageParam));

  let iterations = 0;
  while (iterations++ < 25) {
    const params: OpenAI.ChatCompletionCreateParams = { model, messages: currentMessages };
    if (tools.length > 0) params.tools = tools;

    // Step 1: Ask OpenAI
    const response = await client.chat.completions.create(params);
    const msg = response.choices[0].message;

    // Stream any text content
    if (msg.content) send({ type: "text", content: msg.content });

    // If no tool calls, we're done
    if (!msg.tool_calls || msg.tool_calls.length === 0) break;

    // Add the assistant message (with tool_calls) to the conversation
    currentMessages.push(msg as OpenAI.ChatCompletionAssistantMessageParam);

    // Execute each tool call via MCP
    for (const tc of msg.tool_calls) {
      // OpenAI sends function arguments as a JSON string — parse it
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments); } catch { args = { raw: tc.function.arguments }; }

      send({ type: "tool_call", id: tc.id, name: tc.function.name, arguments: args });

      try {
        // Same as Claude handler — mcpManager routes the call to the right MCP
        const result = await mcpManager.callTool(tc.function.name, args);
        const text = result.content.map((c: any) => c.type === "text" ? c.text : JSON.stringify(c)).join("\n");
        send({ type: "tool_result", id: tc.id, name: tc.function.name, result: text });

        // OpenAI uses role: "tool" for tool results (different from Anthropic)
        currentMessages.push({ role: "tool", tool_call_id: tc.id, content: text });
      } catch (err: any) {
        send({ type: "tool_result", id: tc.id, name: tc.function.name, result: `Error: ${err.message}` });
        currentMessages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${err.message}` });
      }
    }
    // Loop back — OpenAI sees results and either responds or calls more tools
  }
}
