// A real AI agent: Claude decides which x402Pulse data to buy, buys it, and writes the answer.
// Usage: npm run agent -- "Is anyone at Tesla buying shares? How did their last quarter look?"
//
// Needs ANTHROPIC_API_KEY plus PRIVATE_KEY or PRO_KEY in .env. Every purchase is capped by MAX_SPEND_USD.
import { getCatalog, pulse, spend } from "./lib/x402pulse.js";

const question = process.argv.slice(2).join(" ") || "Give me a quick read on NVIDIA: latest quarter, insider activity and any important filings.";
const KEY = process.env.ANTHROPIC_API_KEY?.trim();
if (!KEY) throw new Error("Set ANTHROPIC_API_KEY in .env (https://console.anthropic.com).");
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const ANTHROPIC_URL = (process.env.ANTHROPIC_API_URL || "https://api.anthropic.com").replace(/\/$/, "");
const MAX_STEPS = 8;

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: any } | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: "user" | "assistant"; content: string | Block[] };

const catalog = await getCatalog();
const tools = [{
  name: "get_data",
  description: "Buy one answer from x402Pulse (live data, paid per call). Pick the endpoint and parameters from the catalog in the system prompt.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", enum: catalog.endpoints.filter((e) => !e.path.startsWith("/v1/pro/")).map((e) => e.path) },
      params: { type: "object", additionalProperties: { type: "string" } },
    },
    required: ["path"],
  },
}];
const system = `You are a careful stock-research assistant. Use get_data for real numbers instead of memory, buy only what you need (each call costs money), then answer in under 200 words with dates for every number. Facts, not investment advice.

x402Pulse catalog (path, price, what it does, parameters):
${catalog.endpoints.filter((e) => !e.path.startsWith("/v1/pro/")).map((e) => `- ${e.path} ${e.price}: ${e.description} Params: ${JSON.stringify(e.params)}`).join("\n")}`;

async function claude(messages: Msg[]) {
  const r = await fetch(`${ANTHROPIC_URL}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, tools, messages }),
  });
  const body = await r.json() as { content: Block[]; stop_reason: string; error?: { message: string } };
  if (!r.ok) throw new Error(`Claude: ${body.error?.message ?? r.status}`);
  return body;
}

const messages: Msg[] = [{ role: "user", content: question }];
for (let step = 0; step < MAX_STEPS; step++) {
  const res = await claude(messages);
  messages.push({ role: "assistant", content: res.content });
  const uses = res.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
  if (res.stop_reason !== "tool_use" || !uses.length) {
    console.log("\n" + res.content.filter((b): b is Extract<Block, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n"));
    console.log(`\nData bought: ${spend.calls} calls, $${spend.usd.toFixed(4)}${process.env.PRO_KEY ? " (Pro key: $0)" : ""}.`);
    process.exit(0);
  }
  const results: Block[] = [];
  for (const u of uses) {
    process.stdout.write(`  buying ${u.input.path} ${JSON.stringify(u.input.params ?? {})} … `);
    try {
      const data = JSON.stringify(await pulse(u.input.path, u.input.params ?? {}));
      console.log("ok");
      results.push({ type: "tool_result", tool_use_id: u.id, content: data.slice(0, 12000) });
    } catch (e) {
      console.log("failed");
      results.push({ type: "tool_result", tool_use_id: u.id, content: (e as Error).message, is_error: true });
    }
  }
  messages.push({ role: "user", content: results });
}
console.log("Stopped after too many steps. Try a narrower question.");
