# Paper Trading: dsh-fft-paper-trading

English | [中文](https://github.com/gigaflw/dsh-fft-paper-trading/blob/main/README.zh.md)

[![npm](https://img.shields.io/npm/v/@dsh-ft/dsh-fft-paper-trading)](https://www.npmjs.com/package/@dsh-ft/dsh-fft-paper-trading)
[![license](https://img.shields.io/npm/l/@dsh-ft/dsh-fft-paper-trading)](LICENSE)

Open an A-share / commodity futures account in DeepSeek Harness without opening a brokerage account

![Trade page: fill in symbol, side and quantity, and the cost and post-trade cash are computed as you type; the K-line chart stays on the right](assets/screenshots/trade.jpg)

> DSH ≥ 0.2.0-rc.2 · quotes, trading calendar and K-line built in · ledger stored locally

## What it looks like

*Review page: period statistics, equity curve, fills, end-of-day report and cash flows.*

![Review page](assets/screenshots/review.jpg)

*Futures page: open long / open short / close long / close short, with contract terms, margin and risk ratio on one screen.*

![Futures page](assets/screenshots/futures.jpg)

## Features

- **Everything is priced before you place the order**: type a symbol, side and quantity, and the estimated fill price, commission, stamp duty, transfer fee, post-trade cash and maximum affordable quantity all refresh together — there is no separate quote lookup or preview step.
- **Stocks and futures, two independent accounts**: both accounts are created automatically the first time you open the panel — 100,000 CNY of simulated cash for A-shares, 1,000,000 CNY for commodity futures; futures trade in lots, reserve margin, allow same-day (T+0) closing and settle at end of day.
- **One ledger shared with the AI**: say “buy 200 shares of 000001 at market” or “review my trades this week” in the conversation and the model calls the ordering and review tools directly; the panel and the model trade the same account.
- **Order straight from the K-line**: the panel keeps a full K-line chart on screen; pick a symbol on the chart and its code is carried over to the trade page. The quotes page lets you page through sectors and add the symbols you follow to the shortlist.
- **Build positions in bulk by weight**: import a `code,weight` CSV, set a budget, and buy up to 20 symbols in one batch; check shares, fees and remaining cash before submitting the whole batch.
- **Reviews that reconcile**: equity curve, maximum drawdown, fill statistics, end-of-day report and cash flows, with returns already excluding deposits and withdrawals.
- **Practice without an API key**: the free tier quotes at the latest daily close; configure an FTShare key to switch to real-time quotes.
- **The ledger stays local**: the event ledger is a file on this machine and is restored automatically after a DSH restart; the account is backed up before a reset.

## Install

```sh
dsh plugin add @dsh-ft/dsh-fft-paper-trading
```

Requires DSH `>= 0.2.0-rc.2`. The plugin ships FTShare quotes, the trading calendar and the K-line view, so no separate data plugin is needed.

- The full K-line view needs Python 3.10+ on this machine and prepares its runtime over the network on first launch; a failed preparation does not affect ordering, positions or review.
- **Do not** install it alongside `@dsh-ft/dsh-fft-bundle` or any other entry package that ships the FTShare data service: the data service row would be duplicated, and the related entries in the plugin manager could no longer be toggled separately.

## Get started in three steps

1. Open “Paper Trading” in the sidebar and the accounts are created automatically: 100,000 CNY of simulated cash for stocks and 1,000,000 CNY for futures. Use “Funds” in the account header to deposit or withdraw at any time.
2. On the trade page, enter a symbol (such as `000001`), choose side, quantity and market or limit, then confirm the preview and submit. A limit order that does not cross rests as a pending order and can be canceled under “Orders”.
3. “Review” shows equity, drawdown and fills, “Positions” shows sellable quantity and unrealized P&L; you can reset the account at any time (a backup is taken first).

In the conversation, you can simply say:

- “What is 600519 trading at right now?”
- “Buy 200 shares of 000001 at market, with the note: testing T+1”
- “Review my stock trades this week”

## Market data and API keys

Market data comes from FTShare in two tiers:

- **API key configured**: real-time quotes.
- **No API key**: the free tier. Quotes use the latest close — during the session that is the previous trading day's close — and minute bars and the real-time endpoints are unavailable. The anonymous quota is limited: once it runs out, quotes pause. You can keep trading with a hand-entered reference price, and quotes resume automatically when the quota recovers (about 24 hours, rolling).

Configure the API key in DSH under “Settings → Financial Terminal”; request one at <https://ftai.chat/ftshare>.

The panel header shows the data-source state (live / free / unavailable / invalid); when quotes are unavailable it says why and offers “Get API key” or “Retry”. When the trading calendar degrades to “Monday to Friday”, the panel flags it (holidays then count as trading days, and T+1, pending-order expiry and settlement are estimated on business days).

## Simulation rules and scope

- **Stocks**: a market order fills once at the latest price, with no partial fills; a limit order rests only if it does not cross and is valid for the day. Price limits, trading halts, T+1 sellable quantity and commission / stamp duty / transfer fee are simulated per A-share rules; when quotes are missing you can order with a reference price.
- **Futures**: commodity futures only (SHFE / INE / DCE / CZCE / GFEX), and orders are accepted only during the day session (09:00–11:30, 13:30–15:00). Positions settle at the closing price at 15:30 and go through the risk check. Night sessions, index and treasury futures, delivery and rollover are out of scope for this release.
- **Scope**: no live trading, no margin trading or securities lending, no options, no Hong Kong / US stocks, and no strategy backtesting.

## Data and privacy

- The ledger lives under `paper-trading/` in the local DSH data directory (default `~/.dsh`), one file each for stocks and futures; nothing is uploaded to any server.
- Resetting an account backs it up to `backups/` in the same directory first; when the account is locked by a fault, the panel shows the ledger path so you can export it and investigate.
- For simulation and research only, with no live trading; this is not investment advice.

## Feedback

To report a bug or request a feature, use GitHub Issues (the “Feedback” button in the panel header is the same entry point):

- [Report a bug](https://github.com/gigaflw/dsh-fft-paper-trading/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/gigaflw/dsh-fft-paper-trading/issues/new?template=feature_request.yml)

Before pasting logs, remove the API key, account data and ledger path. For usage questions about quote quota, keys and the trading calendar, see “Market data and API keys” above.

This project is open source under the [MIT](LICENSE) license. See [CHANGELOG.md](CHANGELOG.md) for changes.
