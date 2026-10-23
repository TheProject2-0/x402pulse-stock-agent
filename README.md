# Stock-research agent on x402Pulse

An AI agent that **buys live market data per call with USDC** and tells you what's going on with a stock: latest quarter, insider buying and selling, important SEC filings. No signup, no API key, no subscription: it pays [x402Pulse](https://www.x402pulse.dev) a fraction of a cent per answer through the [x402 protocol](https://www.x402.org).

```text
$ npm run brief -- NVDA

NVIDIA CORP (NVDA)
Latest quarter (2026-07-26): revenue $96.2B, net margin 62.0%, revenue growth 106% year over year
Insiders, last 90 days: 0 open-market buys, 25 sales
Notable 8-K filings, last 30 days: none

Paid $0.0168 for 3 calls. Data, not investment advice.
```
*(A real run from Oct 23, 2026. Your numbers are live when you run it.)*

## Two ways to run it

| | What it does | Cost per run |
|---|---|---|
| `npm run brief -- TSLA` | Three paid calls and a quick summary. The whole thing is ~20 lines ([brief.ts](brief.ts)). | ≈ $0.02 |
| `npm run agent -- "Is anyone at Tesla buying shares?"` | A Claude agent decides which data to buy, buys it, and answers in plain English ([agent.ts](agent.ts)). | Usually $0.01–$0.10 of data, plus Claude API usage |

## Quick start

You need Node.js 20.9 or newer.

```bash
git clone https://github.com/TheProject2-0/x402pulse-stock-agent.git
cd x402pulse-stock-agent
npm install
cp .env.example .env    # then fill in one way to pay (below)
npm run brief -- AAPL
```

### Pay for data: pick one

- **Pay per call (x402):** put the private key of a **small, separate wallet** in `PRIVATE_KEY`, holding a few dollars of USDC on Base. No ETH is needed for fees. Never use your main wallet.
- **Pro key:** an [x402Pulse Pro key](https://www.x402pulse.dev/pro) in `PRO_KEY` gives unlimited calls for 30 days, with no wallet.

For `npm run agent`, also set `ANTHROPIC_API_KEY` ([get one](https://console.anthropic.com)).

## Safety built in

Every payment is checked before it's signed. The run stops, and nothing is paid, if:

- the payment would go anywhere other than x402Pulse's published address (read from the free `/catalog`),
- it isn't USDC on Base,
- one call costs more than `MAX_PRICE_USD` (default $0.06),
- or the run would spend more than `MAX_SPEND_USD` in total (default $0.25).

Your key never leaves your computer: the x402 client signs a one-time payment for the exact amount, and only that signature is sent.

## How it works

1. The agent requests an endpoint, e.g. `GET /v1/wallstreet/insider-trades?ticker=NVDA`.
2. x402Pulse answers **402 Payment Required** with the price.
3. The x402 client signs a USDC payment for exactly that amount and repeats the request.
4. x402Pulse returns the data; the payment settles on Base in seconds.

All of this is in [lib/x402pulse.ts](lib/x402pulse.ts): one function, `pulse(path, params)`.

## What else you can buy

37 endpoints, from $0.0014 a call: company briefs and financials, insider trades, 8-K events, the Treasury yield curve, a daily morning brief, oil prices and inventories, exchange rates, prediction-market "skilled money", flight delays and weather, FDA drug safety and more. See the full list with prices at [x402pulse.dev](https://www.x402pulse.dev) or as JSON at [/catalog](https://www.x402pulse.dev/catalog).

Ideas to build on this template:
- A daily watchlist report sent to Slack or Telegram
- An alert when insiders buy a stock you follow
- A research step inside a bigger trading or portfolio agent

## License

MIT. Data from public sources (SEC EDGAR and others) via x402Pulse. Facts, not investment advice.
