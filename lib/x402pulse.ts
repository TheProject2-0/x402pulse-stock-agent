// A tiny x402Pulse client: one function, pulse(path, params), that returns live data and pays for it.
//
// Two ways to pay, read from .env:
//   PRIVATE_KEY  pays per call in USDC on Base through the x402 protocol (no account, no API key).
//   PRO_KEY      an x402Pulse Pro key: unlimited calls, no wallet.
//
// Safety for pay-per-call: every payment must go to x402Pulse's own published address, must be USDC on Base, and
// must fit both a per-call cap (MAX_PRICE_USD) and a budget for the whole run (MAX_SPEND_USD).
import { readFileSync } from "node:fs";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Load .env (simple KEY=value lines) without extra dependencies.
try {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
} catch { /* no .env file: use the real environment */ }

export const API = (process.env.X402PULSE_URL || "https://www.x402pulse.dev").replace(/\/$/, "");
const USDC_ON_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const MAX_SPEND = Number(process.env.MAX_SPEND_USD || 0.25);
const MAX_PRICE = Number(process.env.MAX_PRICE_USD || 0.06);

export const spend = { usd: 0, calls: 0 };
let pending = 0; // the price of the payment being made right now (paid calls run one at a time)
let queue: Promise<unknown> = Promise.resolve();

type Catalog = { payTo: string; endpoints: { method: string; path: string; price: string; description: string; params: Record<string, string> }[] };
let catalog: Catalog | null = null;
/** The free list of every endpoint, its price and parameters. */
export async function getCatalog(): Promise<Catalog> {
  catalog ??= (await (await fetch(`${API}/catalog`)).json()) as Catalog;
  return catalog;
}

let paidFetch: typeof fetch | null = null;
async function payingFetch(): Promise<typeof fetch> {
  if (paidFetch) return paidFetch;
  const key = process.env.PRIVATE_KEY?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("Set PRIVATE_KEY (a small wallet with USDC on Base) or PRO_KEY in .env. See .env.example.");
  }
  const payTo = (await getCatalog()).payTo.toLowerCase();
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });
  client.setSpendControls({ maxAmountPerPayment: `$${MAX_PRICE}` });
  client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
    const usd = Number(r.amount) / 1e6;
    if (String(r.network) !== "eip155:8453") return { abort: true, reason: `Not Base mainnet (${r.network}).` };
    if (String(r.asset).toLowerCase() !== USDC_ON_BASE) return { abort: true, reason: "Not USDC." };
    if (String(r.payTo).toLowerCase() !== payTo) return { abort: true, reason: `Unexpected payee ${r.payTo}.` };
    if (usd > MAX_PRICE) return { abort: true, reason: `$${usd} is above MAX_PRICE_USD ($${MAX_PRICE}).` };
    if (spend.usd + usd > MAX_SPEND + 1e-9) return { abort: true, reason: `this $${usd} call would go over MAX_SPEND_USD ($${MAX_SPEND}; spent $${spend.usd.toFixed(4)})` };
    pending = usd; // counted only once the paid answer arrives
  });
  paidFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;
  return paidFetch;
}

/** Calls one x402Pulse endpoint, e.g. pulse("/v1/wallstreet/insider-trades", { ticker: "NVDA" }). */
export function pulse(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  if (process.env.PRO_KEY?.trim()) return call(path, params);
  // Paid calls run one at a time, so the budget is always exact.
  const run = queue.then(() => call(path, params));
  queue = run.catch(() => undefined);
  return run;
}

async function call(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${API}${path}${qs.size ? `?${qs}` : ""}`;
  const pro = process.env.PRO_KEY?.trim();
  let res: Response;
  try {
    res = pro ? await fetch(url, { headers: { Authorization: `Bearer ${pro}` } }) : await (await payingFetch())(url);
  } catch (e) {
    const msg = (e as Error).message;
    // The x402 client refuses before paying when a safety rule says no; nothing is spent.
    if (/spendControls/i.test(msg)) throw new Error(`${path}: not paid, the price is above MAX_PRICE_USD ($${MAX_PRICE}). Nothing was spent.`);
    if (/aborted/i.test(msg)) throw new Error(`${path}: not paid, ${msg.replace(/^.*aborted: /, "").replace(/\.$/, "")}. Nothing was spent.`);
    throw e;
  }
  if (!pro) {
    if (res.ok && (res.headers.get("payment-response") || res.headers.get("x-payment-response"))) { spend.usd += pending; spend.calls += 1; }
    pending = 0;
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 402) throw new Error(`${path}: payment not accepted. Check the wallet holds enough USDC on Base. Nothing was spent.`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}: ${(body as { error?: string }).error ?? JSON.stringify(body).slice(0, 200)}`);
  return (body as { data?: unknown }).data ?? body;
}
