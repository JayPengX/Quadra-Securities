# Stock Study 股市研究室

**Live site: https://jaypengx.github.io/Stock-Study/**

A play-money brokerage for markets around the world. You choose how many NT$ to start with, exchange them into other currencies, and buy stocks, ETFs, government bonds, bond ETFs, mutual funds, crypto and gold at real prices, or sell short. Commissions, taxes, FX spreads, loan interest, borrow fees and dividend and coupon withholding all follow real rules.

> Educational simulation with play money. Not investment advice.

Built on [Odds Study](https://github.com/JayPengX/Odds-Study)'s setup: a static site with no build step and no dependencies, prices through [Shared-Proxy](https://github.com/JayPengX/Shared-Proxy)'s Worker, the same gzip-compressed saves and passcode sync, Traditional Chinese and English, and deploys to GitHub Pages.

## The app

Five tabs: a bottom bar on phones, the top bar on desktop.

### 市場 Markets

- **Search:** by Chinese name, English name or ticker. Chinese finds the curated lists; Latin letters also search Yahoo Finance, which reaches almost any listed stock, ETF or fund worldwide (`7203.T`, `0700.HK`, `SAP.DE`, `PETR4.SA` …).
- **World markets strip:** TAIEX, S&P 500, Nasdaq, SOX, Nikkei, Hang Seng, Bitcoin, USD/TWD, the gold passbook, the US 10-year yield.
- **Lists** (`public/lib/catalog.mjs`, about 300 items with Chinese names): Taiwan stocks (TWSE and TPEx), Taiwan ETFs (0050, 0056, 00878, leveraged and inverse ones …), US stocks, US ETFs, government bonds (see below), bond ETFs (Taiwan's bond ETFs, US Treasury and corporate bond ETFs, and Treasury yields to watch), crypto, forex (18 currency pairs), gold and commodities, Japan, Hong Kong and China A-shares, Korea, Europe, US mutual funds, more markets (Canada, Australia, Singapore, India), and indexes. There's a watchlist (☆ on any item) too.
- **Each row:** today's price line against yesterday's close, the price and its currency, whether its market is open, and the day's change.
- **Up and down colours:** red for up and green for down (Taiwan's way) in Chinese, green for up in English. The guide's settings switch either way.

### The detail sheet

- The price, the change, and whether the market is open, with local and Taiwan time. A closed market shows its next open.
- Charts over 1D, 5D, 1M, 6M, YTD, 1Y, 5Y or everything, with a crosshair: as a line or **candlesticks with volume**, and **moving averages** (MA5, MA20, MA60) on either.
- The facts: previous close, day and 52-week range, volume, currency, market, trading hours, trading costs, the price in NT$.
- Your position: quantity, average cost, value, P/L.
- **The ticket:**
  - buy or sell; market, limit or stop orders;
  - quick sizes: max affordable, 1/100 shares, 1 lot (1,000 shares in Taiwan), or ¼, ½ and all of a holding;
  - a preview of the price, amount, commission, taxes, exchange fees and total, in NT$ too.
  - **Short of a currency?** One tap exchanges exactly the NT$ needed.
- **Price alert** (🔔): tell me when it rises or falls to a price. Checked on every refresh and, for the time the page was closed, against the price bars since (reported with when it happened). With notifications allowed, it notifies through the service worker.
- **Monthly plan** (📅 定期定額): buy NT$X on day N of every month. Each month buys at the first price after 00:00 Taiwan time on its day, as many units as the money covers after costs (a foreign one exchanges only the NT$ it needs, at that moment's rate). Missed months are bought from the price history when the page opens again; a month without enough NT$ is skipped and recorded.
- **Time machine** link: what buying this years ago would be worth now.
- **About the company / fund:** a quick read first (is the price cheap or pricey, profitability, growth, dividends, balance sheet, swings; for funds fees, size, how spread out, dividends), rough rules of thumb shown as calm/middling/worth-a-look tags. Then the next earnings and ex-dividend dates, four years (or quarters) of revenue and net income as bars, the analysts' average target price and range against today's price, and the numbers grouped (price and value, profitability, dividends, balance sheet, performance against the S&P 500), each with a line on what it means. Funds show past returns (this year, 3 and 5 years), the sector mix, the stock/bond/cash mix and the top 10 holdings. Then what it does (English) and recent news.
- **How fresh the price is:** "live" or "delayed N minutes", per market, from Yahoo's own figures.
- Indexes and futures are watch-only and point to what tracks them (TAIEX → 0050, S&P 500 → VOO/SPY/00646, gold → the gold passbook/GLD/00635U …).

### 外匯 Forex

Currency pairs trade like stocks (market, limit and stop orders, shorting, alerts, candles). EUR/USD = 1.14 means one euro is worth US$1.14: buying 10,000 EUR/USD costs US$11,400 and is counted in euros. A pair settles in its second currency (`EURUSD=X` in US$, `USDJPY=X` in yen, `USDTWD=X` in NT$). No commission, a 0.02% spread each way; Yahoo's weekday sessions. Borrowing against a pair: 50% of its value. This is apart from the FX tab, which only changes money from one currency to another.

### 公債 Government bonds

`public/lib/bonds.mjs`: real bonds, each with a coupon, a maturity and a face value, bought one bond at a time.

- **US Treasuries:** a 3-month bill and 2-, 5-, 10-, 20- and 30-year notes and bonds, plus two old low-coupon issues that trade well below par. They're priced from the live Treasury curve (Yahoo's 13-week, 2-, 5-, 10- and 30-year yields, straight lines between). Rates up, prices down, and longer bonds move more.
- **Taiwan central government bonds, Japanese JGBs, German Bunds and UK gilts:** there's no free live yield source for these, so each prices from a fixed reference curve (labelled as such), and their prices only drift toward par over time.
- **Price:** a quote is one bond's dirty price, clean price plus the interest accrued since the last coupon; a purchase pays that. The detail sheet shows the yield, clean price per 100, accrued interest, coupon and frequency, maturity, face value and coupon tax.
- **Coupons** are credited on their dates while held, less the issuer's withholding: Taiwan 10% (separate taxation), Japan 15.315%, Germany 26.375%, the US and UK 0 for foreigners. At maturity the face value is repaid automatically.
- **Trading:** weekdays in the issuer's business hours, over the counter at a 0.1% commission and a 0.05% bid–ask spread. Bonds count 80% as margin collateral.

### Short selling

- Stocks, ETFs, bond ETFs and crypto can be sold short: sell more than you hold.
- **To open:** afterwards, assets must be at least 150% of everything owed (loans plus the shorts' market value). The ticket shows the most you can sell.
- **While open:** a borrow fee of 3% a year accrues on the sale value and is paid on buying back. Dividends paid meanwhile are charged to you.
- **Margin:** shorts count as owed in the maintenance ratio. A forced sale buys every short back first.

### 資產 Portfolio

- Net worth in NT$, today's change, total return against the money put in.
- Net worth over time: rebuilt for every day since the account opened from the log and each day's closing prices and exchange rates, so there's no need to open the app daily. The money put in is a dashed line.
- Allocation by kind, currency or market.
- Positions (value, P/L, today, weight), open orders, and a wallet for every currency (cash held for open orders shown). Loans show here too, and the maintenance ratio when there are any.
- Monthly plans (next buy, last result, stop) and price alerts (distance from the price, remove).
- **Monthly payday** (no manual adding): on the 1st of every month (00:00 Taiwan time) 3% of the starting amount arrives on its own, like a salary: NT$1,000,000 → NT$30,000 a month, NT$100,000 → NT$3,000. It counts as money put in, not as return. Missed months are paid when the page opens again; each payday has a fixed id (`pay:YYYY-MM`), so synced devices never pay twice. Accounts opened before paydays existed get them from their next 1st. The next payday shows under net worth.
- Sync and backups.

### 換匯・融資 FX & loans

- **Exchange** between any two currencies: the mid-market rate less a bank's spread (US$ 0.2%, JPY/EUR/HKD 0.3% … INR 1%, and the wider of the two between foreign currencies). The spread doubles while the FX market is shut (weekends), as a bank's does. The receiving side is rounded down to its smallest unit.
- **A rates board**: NT$ per unit (per 100 for yen and won), the bank's buy and sell rates, and today's line.
- **Margin loans** in any currency:
  - Borrowing power is the value of your holdings times a haircut (stocks, ETFs and bonds 60%, funds and gold 50%, crypto 30%).
  - Interest accrues continuously at each currency's rate (NT$ 6.5%, US$ 7.5%, ¥ 3% …).
  - The maintenance ratio is assets ÷ loans. Below 130% the broker calls. Below 115% it sells your largest holdings, then repays the loans, exchanging other cash if needed.

### 紀錄 History

- **Activity:** every trade, exchange, dividend, split, loan and deposit by day, with filters.
- **Orders:** open orders (cancel) and past ones (filled, cancelled, not filled with the reason).
- **Stats:**
  - where the money came from and went (put in, net worth, return, realized and unrealized P/L, dividends);
  - trading costs by kind (commissions, taxes, exchange fees, FX spreads, interest, withholding, NHI) and their share of the money put in;
  - closed trades (win rate, average return and hold, best and worst);
  - P/L by market;
  - **you vs. just buying an index**: the same deposits on the same days into 0050, VOO (in NT$), Bitcoin (in NT$) or the gold passbook.

### 學習 Learn

`public/lib/learn.mjs`: a beginner school for people who have never invested.

- **13 short lessons:** what a stock is, reading a quote, order types, fees and taxes, ETFs and diversification, dividends, currency risk, government bonds, crypto and gold, time and compounding, leverage, common beginner mistakes, and a practice plan.
- **Live examples:** each lesson uses today's real prices (a lot of TSMC with its fees and round-trip cost, the US 10-year yield, the NT$ rate…).
- **Try it:** buttons open the relevant stock or tab.
- **Time machine:** NT$X once, or every month, into 0050, TSMC, VOO, QQQ, Bitcoin, gold… since any year from 2000. Monthly closes with dividends reinvested, foreign ones at each month's NT$ rate. Shows what it's worth now, the yearly return, the biggest drop along the way (and when), the best and worst years, and the same money in a bank deposit.
- **A one-question quiz** ends each lesson; the right answer marks the lesson done, with a progress bar.
- **Beginner missions** tick themselves off from the account's history: first Taiwan stock, first ETF, a limit order, an exchange, something abroad, a government bond, a dividend or coupon, three markets at once, a 30-day hold, a monthly plan, a price alert.
- **A glossary** of 26 terms.

Below it, the reference:

How it works, the fee and tax table for every market, FX spreads and loan rates, order types, trading hours, margin, dividends and splits, passbooks, crypto, how the numbers work, data sources, settings (colours, start over).

## The rules

| What | How |
| --- | --- |
| Starting money | Your choice, NT$10,000 to NT$1,000,000,000 |
| Taiwan | 0.1425% commission, min NT$20; sell tax 0.3% stocks, 0.1% ETFs, 0% bond ETFs; fractions of a dollar dropped |
| US | 0.1% sub-brokerage commission, min US$3; SEC fee 0.00278% on sells; 30% dividend withholding |
| Hong Kong | 0.25%, min HK$100; 0.1% stamp duty on stocks both ways; 0.0085% exchange fees |
| UK, France, Italy, Spain | 0.25%, min £5/€5; stamp duty or FTT on buys of stocks (0.5%, 0.4%, 0.1%, 0.2%) |
| China, Korea, India | 0.3%; sell tax 0.05% (China), 0.15% (Korea); 0.1% STT both ways (India) |
| Japan, Germany, Netherlands, Switzerland, Denmark, Canada, Australia, Singapore | 0.25% with a local minimum |
| Crypto | 0.1%, fractions to 8 decimals, 24/7 |
| Gold and silver passbooks | NT$ per gram from COMEX futures × US$ rate ÷ 31.1035; buy 0.6% above, sell 0.6% below |
| Anywhere else search finds | 0.3%, 20% withholding, its currency's rate from Yahoo (through US$ if there's no NT$ pair), 1% FX spread |
| Dividends | Credited on the ex-date for shares held then; Yahoo's split-adjusted amounts scaled back; withholding by market; Taiwan's 2.11% NHI premium on a payment of NT$20,000+ |
| Splits | Shares multiplied from the split date; cost unchanged |
| Orders | Market orders fill at once while open, else at the first price after the open (holding 3% extra). Limit and stop orders stay open until they fill or are cancelled. Open orders hold their cash or shares. A buy that no longer fits the cash when it triggers is dropped |
| While the page is closed | On opening (and on coming back to the tab), each open order is checked against the price bars since it was placed: 5-minute bars for the last few days, 30-minute for a month, hourly for two years. It fills at the first bar that reached its price, dated then, at that moment's exchange rate; a gap through the price fills at the bar's open. Dividends, splits, coupons and maturities are credited on their own dates, and net worth history is rebuilt from daily closes |
| Hours | Each market's own session and holidays from Yahoo; crypto always; government bonds on weekdays in the issuer's business hours |
| Short selling | Stocks, ETFs, bond ETFs, crypto; 150% initial cover; 3% a year borrow fee; dividends charged; bought back first in a forced sale |

All the rates live in `public/lib/markets.mjs`, and the guide's tables are built from that same file.

## How it works

The account is a log (`public/lib/account.mjs`):

- **Immutable events:** deposits, exchanges, fills, dividends, splits, borrowing and repaying.
- **Orders:** their status only moves forward.
- **Worked out by replaying the log:** cash in each currency, holdings and average costs (NT$ cost at each fill's own rate, so FX moves are part of P/L), and loans with continuous interest.

Two devices' copies merge by uniting their logs:

- Events are kept by id.
- An order takes its most advanced status, and one filled anywhere counts as filled.
- A copy started over wins if it's the newer start.

**Prices** come from Yahoo Finance's public endpoints (`public/lib/quotes.mjs`) through Shared-Proxy's `sports-proxy` Worker, which adds CORS and caches:

- `/v7/finance/spark`: up to 20 quotes per request, with today's line.
- `/v8/finance/chart`: charts, dividends and splits.
- `/v1/finance/search`: search, and news.
- `/v10/finance/quoteSummary`: company and fund numbers (the Worker adds Yahoo's session cookie and crumb).

**Rules that make it behave like a real broker:**

- **Exchange price rules:** Taiwan and US limit and stop prices must sit on the exchange's tick (Taiwan: 0.01 below NT$10 up to 5 from NT$1,000; ETFs 0.01/0.05; US one cent), and Taiwan limit orders must be inside the day's ±10% price limit. The order form shows the allowed range and the tick.
- **Dividends are paid on the market's pay day:** holding on the ex-date earns it; the cash arrives about 4 weeks later in Taiwan, 1 week in the US, 2–3 months in Japan, within days in much of Europe (`DIV_PAY_DAYS`). Until then it's listed as on the way and counted in net worth as a receivable (the price already dropped by it), but can't be spent.
- **Forced sales while away:** with a loan or a short, the price history since the last visit is walked (every price bar) and, where the account fell below the liquidation line, shorts are bought back and holdings sold at that moment's price, dated then, and the loans repaid; whatever the sale didn't cover is still owed.
- **Fills found in the past** must have fitted the cash and shares at that moment, and still fit today's.
- **The spread:** market and triggered stop orders buy at the ask and sell at the bid: half a tick at least, or a typical half-spread per market (US 0.01%, Europe and Asia 0.05%, crypto 0.02%). Limit orders fill only at their price or better. Monthly plans size their buy at the ask.
- **Settlement:** every fill records when it settles (Taiwan T+2, US, Canada, India and China T+1, most others T+2, weekdays only). Sale money can buy again at once in its market, but can't be exchanged into another currency until it settles; wallets show what's still settling.
- **Taiwan odd lots** (not whole lots of 1,000) match only from 09:10, in the intraday odd-lot session, live and in history.
- **Interest on idle NT$:** the settlement account earns the bank's demand-deposit rate (0.8% a year, `CASH_RATE`), accrued daily and paid June 21 and December 21, with 10% tax and the 2.11% NHI premium on a payment of NT$20,000 or more.
- **The ledger is read as of a moment:** `replay(account, t)` ignores anything dated after `t`.
- **Data safety:** an account with no sync code, not installed to the home screen, gets a reminder that Safari can clear site data after 7 days unopened.

**What's still limited:**

- **Price delays** (Yahoo's `exchangeDataDelayedBy`): US stocks and funds, forex, crypto and the US yields are live; Taiwan, Tokyo, Seoul and Sydney 20 minutes; Hong Kong, Shanghai, London, Paris, Frankfurt, Milan, Madrid, Zurich, Toronto and India 15; Singapore and COMEX metals 10; Amsterdam and Copenhagen live. Orders fill at those prices. The Taiwan exchange's own real-time feed refuses requests from servers, so it can't go through the Worker.
- **Holidays:** a closed market's next opening time is estimated as the next weekday (no free holiday calendar), except when Yahoo already knows the next session.
- **Non-US government bonds** use reference yields, not live ones.

**Refreshes:**

- Quotes for holdings, open orders, the watchlist, currencies and the strip every 45 seconds while the page is visible; the open list every 90.
- Waiting orders are checked and today's net worth recorded after each refresh.
- Dividends and splits are checked twice a day for everything ever held.

**Offline and installable:** opened from the home screen, the top bar starts below the status bar (`env(safe-area-inset-top)`) and is solid rather than see-through, which iPadOS smeared. `public/sw.js` keeps the page's own files (each stamped version once), and the last prices are saved, so the app opens without a connection and shows when its prices are from; trading and exchanging wait for live prices. It can be installed to a phone's home screen.

**Saves** are gzip-compressed (`codec.mjs`) in `localStorage`. The optional sync goes through Shared-Proxy's `/stock-sync` route (Firestore, 8-character passcode, `sync.mjs`). A backup file can be downloaded and restored (merged, nothing counted twice).

| File | Purpose |
| --- | --- |
| `public/lib/account.mjs` | The ledger: orders and fills (live and from price history), short positions, exchange, loans and margin, dividends, splits, coupons and maturities, valuation, net worth history, benchmarks, merging |
| `public/lib/bonds.mjs` | Government bonds: issuers, curves (live and reference), coupon dates, pricing with accrued interest, trading hours |
| `public/lib/markets.mjs` | Currencies (spreads, loan rates), markets (commissions, taxes, withholding), kinds, hours, margin rules |
| `public/lib/quotes.mjs` | Fetching and parsing Yahoo's quotes, charts, events and search; passbook metals |
| `public/lib/catalog.mjs` | The curated lists with Chinese names, the overview strip, trackers for indexes |
| `public/lib/chart.mjs` | SVG sparklines, line and candlestick charts with a crosshair, 100% bars |
| `public/lib/format.mjs` | Money, prices, percentages, 萬/億, dates |
| `public/lib/i18n.mjs` | Traditional Chinese and English (follows the browser) |
| `public/lib/timemachine.mjs` | The time machine and moving averages |
| `public/sw.js` | Offline files and alert notifications |
| `public/lib/sync.mjs`, `codec.mjs` | Sync and compressed saves |
| `public/app.js` | Rendering and wiring |

## Setup

1. **The proxy:** Shared-Proxy's `sports-proxy` Worker allows Yahoo Finance's hosts and `orbit-workers-proxy` serves `/stock-sync` (both deployed from that repo's `main`).
2. **Pages:** this repo's Settings → Pages → Source: GitHub Actions. Every push to `main` runs the tests and deploys `public/`. `scripts/stamp-version.mjs` cache-busts every file and makes open pages reload into a new deploy.

## Development

```sh
npm test                                              # node:test, no installs
python3 -m http.server 8000 --directory public        # then open http://localhost:8000
```

The Worker allows `http://localhost:<port>` as an origin, so local runs get live prices once it's deployed.
