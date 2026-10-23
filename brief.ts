// The 20-line version: three paid calls (about 2 cents) and a quick read on one stock.
// Usage: npm run brief -- NVDA
import { pulse, spend } from "./lib/x402pulse.js";

const ticker = (process.argv[2] ?? "NVDA").toUpperCase();
const [insiders, events, fin] = (await Promise.all([
  pulse("/v1/wallstreet/insider-trades", { ticker, days: 90 }),
  pulse("/v1/wallstreet/events", { ticker, days: 30 }),
  pulse("/v1/wallstreet/financials", { ticker }),
]).catch((e) => { console.error(`\n${e.message}`); process.exit(1); })) as any[];

const q = fin.summary?.latestQuarter;
console.log(`\n${fin.company?.name ?? ticker} (${ticker})`);
if (q) console.log(`Latest quarter (${q.periodEnd}): revenue $${(q.revenue / 1e9).toFixed(1)}B, net margin ${(q.netMargin * 100).toFixed(1)}%, revenue growth ${(q.revenueGrowthYoY * 100).toFixed(0)}% year over year`);
const s = insiders.summary ?? {};
console.log(`Insiders, last 90 days: ${s.openMarketBuys ?? 0} open-market buys, ${s.openMarketSells ?? 0} sales${s.clusterBuy ? " (cluster buy!)" : ""}`);
const ev = (events.events ?? []).filter((e: any) => e.importance !== "routine");
console.log(`Notable 8-K filings, last 30 days: ${ev.length ? ev.map((e: any) => `${e.filed} ${e.items.map((i: any) => i.meaning).join("; ")}`).join(" | ") : "none"}`);
console.log(`\nPaid $${spend.usd.toFixed(4)} for ${spend.calls} calls${process.env.PRO_KEY ? " (Pro key: $0)" : ""}. Data, not investment advice.`);
