# Quadra Securities

**Live site: https://jaypengx.github.io/Quadra-Securities/**

## Quadra

Quadra Securities is the financial powerhouse of **Quadra**, a family of
apps sharing one account and one money pool:

| App | Part it plays |
| --- | --- |
| **Quadra Securities** | Where money lives and grows: a play-money brokerage for markets worldwide |
| **Quadra Play** | A place to play: sports bets and the lottery |
| **Quadra Fixtures** | The sports data centre, and the way into Play |
| **Quadra Rewards** | The centre of Quadra: earning, goals, and every app's guide |
| Orbit Class | A related add-on: the class schedule |

- **Quadra Pass required.** The app opens on the sign-in screen until there's
  a pass (the shared kit, `public/lib/quadra.mjs`, from Shared-Proxy's
  `kit/`). The account is kept with the pass (a copy on the device under the
  pass, so it opens at once), and the market data proxy answers signed-in
  apps only.
- **One app at a time.** The app in use is the account's live one; opening
  another Quadra app pauses this one (it stops refreshing) until you come
  back, so two apps never overwrite each other.
- **One money pool.** This account's NT$ cash is the Quadra balance: Play's
  bets and winnings, what Rewards earns, transfers and Quadra's own pay
  (NT$5,000 a month, NT$500 a week, paid into the pool by the Worker from
  October 2026; Securities paid the month itself before that) all move it.
  A new pass opens with NT$110,000 from Quadra.
- **The guide lives in Rewards.** Every explanation (fees, orders, FX,
  bonds, loans…) is in Quadra Rewards' help centre; the account sheet links
  to it. The lessons, quizzes and mini games were removed.

## The app

Four tabs, drawn by the kit (`tabBar`): a bottom bar on phones, the top bar on desktop; each keeps its place. The top right is help, refresh and the account (`topActions`).

### 首頁 Home

- **The home:** your total and today's change at the top (a tap opens 資產), what's for you, and today's movers (top five up and down, side by side). No promotions, no nudges.
- **Buying power** under the account strip: NT$ cash plus what margin lends right now.
- **Search:** by Chinese name, English name or ticker. Chinese finds the curated lists; Latin letters also search Yahoo Finance, which reaches almost any listed stock, ETF or fund worldwide (`7203.T`, `0700.HK`, `SAP.DE`, `PETR4.SA` …).
- **World markets strip:** TAIEX, S&P 500, Nasdaq, SOX, Nikkei, Hang Seng, Bitcoin, USD/TWD, the gold passbook, the US 10-year yield.
- **Lists** (`public/lib/catalog.mjs`, about 300 items with Chinese names): Taiwan stocks (TWSE and TPEx), Taiwan ETFs (0050, 0056, 00878, leveraged and inverse ones …), US stocks, US ETFs, government bonds (see below), bond ETFs (Taiwan's bond ETFs, US Treasury and corporate bond ETFs, and Treasury yields to watch), crypto, forex (18 currency pairs), gold and commodities, Japan, Hong Kong and China A-shares, Korea, Europe, US mutual funds, more markets (Canada, Australia, Singapore, India), and indexes. There's a watchlist (☆ on any item) too. A list opens on its first 15 rows; the rest are a tap away.
- **Each row:** today's price line against yesterday's close, the price and its currency, whether its market is open, and the day's change.
- **Up and down colours:** red for up and green for down (Taiwan's way) in Chinese, green for up in English. The account sheet's settings switch either way.

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
  - **Short of cash?** 融資買進 borrows the rest in the order's currency (at the loan rate, repay any time) and places the order in one tap; 融資最大 sizes a buy to cash plus margin room.
- **Price alert** (🔔): tell me when it rises or falls to a price. Checked on every refresh and, for the time the page was closed, against the price bars since (reported with when it happened). With notifications turned on in the account sheet (the kit's notices; the switches follow the Quadra Pass), it notifies when the app is in the background. Account events use the kit's notice kinds too (`accountNotice`): fills and plan buys (`fill`), lapsed or dropped orders and skipped plans (`order`), a margin call once a day and forced sales (`margin`), ex-dividend, dividends, coupons and interest (`income`). On screen they're toasts that open their tab when tapped; a dividend's pay day is also sent by the Worker while the app is closed.
- **Monthly plan** (📅 定期定額): buy NT$X on day N of every month. Each month buys at the first price after 00:00 Taiwan time on its day, as many units as the money covers after costs (a foreign one exchanges only the NT$ it needs, at that moment's rate). Missed months are bought from the price history when the page opens again; a month without enough NT$ is skipped and recorded.
- **Time machine** link: what buying this years ago would be worth now.
- **About the company / fund:** a quick read first (is the price cheap or pricey, profitability, growth, dividends, balance sheet, swings; for funds fees, size, how spread out, dividends), rough rules of thumb shown as calm/middling/worth-a-look tags. Then the next earnings and ex-dividend dates, four years (or quarters) of revenue and net income as bars, the analysts' average target price and range against today's price, and the numbers grouped (price and value, profitability, dividends, balance sheet, performance against the S&P 500), each with a line on what it means. Funds show past returns (this year, 3 and 5 years), the sector mix, the stock/bond/cash mix and the top 10 holdings. Then what it does, translated into Chinese for a Chinese reader (the English original a tap away; Google's translate endpoint through the proxy, kept a month). There's no news.
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
- Allocation by kind, currency or market: a ring with the total inside and each part's share and value.
- Positions (value, P/L, today, today's price line, a bar for each one's weight), open orders.
- **Cash:** the spendable NT$ total up top, what's held for open orders or still settling, the cash interest rate, and a wallet for every currency. Loans show here too, and the maintenance ratio when there are any.
- **Income:** dividends, bond coupons and cash interest over the last 12 months (month by month) and this year, the yield on holdings, the top payers, and dividends on the way.
- Monthly plans (next buy, last result, stop) and price alerts (distance from the price, remove).
- **Monthly payday** (no manual adding): on the 1st of every month (00:00 Taiwan time) NT$3,000 arrives on its own when the app is opened, like a salary, the same for every account. It counts as money put in, not as return. Missed months are paid when the page opens again; each payday has a fixed id (`pay:YYYY-MM`), so synced devices never pay twice. Accounts opened before paydays existed get them from their next 1st. The next payday shows under net worth.
- Sync and backups. (Where the money came from moved to the Quadra Pass sheet's account details, the same in every app.)

### 換匯・融資 FX & loans

Three views, one at a time: **換匯** (the wallets with money in them as chips
to pay from; "you pay" and "you get" boxes, type either side; ¼, ½, all;
your rate, the spread and its cost; one confirm button that says what
happens), **匯率** (the rates board; a row opens the exchange with it) and
**融資** (what's borrowed, the maintenance ratio, how much of the limit is
used as a bar, collateral and interest so far; borrow or repay in one
form).

- **Exchange** between any two currencies, typing either what you pay or what you want to receive: the mid-market rate less a bank's spread (US$ 0.2%, JPY/EUR/HKD 0.3% … INR 1%, and the wider of the two between foreign currencies). The spread doubles while the FX market is shut (weekends), as a bank's does. The receiving side is rounded down to its smallest unit.
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

### Time machine (回測)

In 紀錄, beside the activity: what a lump sum or a monthly plan in one of the
well-known funds and stocks would be worth today, with its worst drop, best
and worst years and a bank deposit to compare.

## The rules

| What | How |
| --- | --- |
| Starting money | NT$100,000 for every account |
| Taiwan | 0.1425% commission, min NT$20 (odd lots NT$1); sell tax 0.3% stocks (0.15% on a day trade: sold the day it was bought), 0.1% ETFs, 0% bond ETFs; fractions of a dollar dropped |
| US | 0.1% sub-brokerage commission, min US$3; SEC fee US$20.60 per million on sells (from 2026-04-04); 30% dividend withholding |
| Hong Kong | 0.25%, min HK$100; 0.1% stamp duty on stocks both ways; 0.0085% exchange fees |
| UK, France, Italy, Spain | 0.25%, min £5/€5; stamp duty or FTT on buys of stocks (0.5%, 0.4%, 0.1%, 0.2%) |
| China, Korea, India | 0.3%; sell tax 0.05% (China), 0.20% (Korea, from 2026); 0.1% STT both ways and 0.015% stamp duty on buys (India) |
| Switzerland | 0.25%; federal stamp duty 0.075% each side |
| Japan, Germany, Netherlands, Switzerland, Denmark, Canada, Australia, Singapore | 0.25% with a local minimum |
| Crypto | 0.1%, fractions to 8 decimals, 24/7 |
| Gold and silver passbooks | NT$ per gram from COMEX futures × US$ rate ÷ 31.1035; buy 0.6% above, sell 0.6% below |
| Anywhere else search finds | 0.3%, 20% withholding, its currency's rate from Yahoo (through US$ if there's no NT$ pair), 1% FX spread |
| Dividends | Credited on the ex-date for shares held then; Yahoo's split-adjusted amounts scaled back; withholding by market; Taiwan's 2.11% NHI premium on a payment of NT$20,000+ |
| Splits | Shares multiplied from the split date; cost unchanged |
| Orders | Market orders fill at once while open, else at the first price after the open (holding 3% extra). Limit and stop orders are **day orders** by default: they end at the close of the session they're for (placed while shut: the next one) and expire unfilled; **長效 (GTC)** keeps one for 30 days. Crypto and currency pairs are always GTC. Open orders hold their cash or shares. A buy that no longer fits the cash when it triggers is dropped |
| While the page is closed | On opening (and on coming back to the tab), each open order is checked against the price bars since it was placed: 5-minute bars for the last few days, 30-minute for a month, hourly for two years. It fills at the first bar that reached its price, dated then, at that moment's exchange rate; a gap through the price fills at the bar's open. Dividends, splits, coupons and maturities are credited on their own dates, and net worth history is rebuilt from daily closes |
| Hours | Each market's own session and holidays from Yahoo; crypto always; government bonds on weekdays in the issuer's business hours |
| Short selling | Stocks, ETFs, bond ETFs, crypto; 150% initial cover; 3% a year borrow fee; dividends charged; bought back first in a forced sale |

All the rates live in `public/lib/markets.mjs`.

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
- `/v1/finance/search`: search.
- `/v10/finance/quoteSummary`: company and fund numbers (the Worker adds Yahoo's session cookie and crumb).

**Rules that make it behave like a real broker:**

- **Exchange price rules:** Taiwan and US limit and stop prices must sit on the exchange's tick (Taiwan: 0.01 below NT$10 up to 5 from NT$1,000; ETFs 0.01/0.05; US one cent), and Taiwan limit orders must be inside the day's ±10% price limit. The order form shows the allowed range and the tick.
- **Dividends are paid on the market's pay day:** holding on the ex-date earns it; the cash arrives about 4 weeks later in Taiwan, 1 week in the US, 2–3 months in Japan, within days in much of Europe (`DIV_PAY_DAYS`). Until then it's listed as on the way and counted in net worth as a receivable (the price already dropped by it), but can't be spent.
- **Forced sales while away:** with a loan or a short, the price history since the last visit is walked (every price bar) and, where the account fell below the liquidation line, shorts are bought back and holdings sold at that moment's price, dated then, and the loans repaid; whatever the sale didn't cover is still owed.
- **Fills found in the past** must have fitted the cash and shares at that moment, and still fit today's.
- **The spread:** market and triggered stop orders buy at the ask and sell at the bid: half a tick at least, or a typical half-spread per market (US 0.01%, Europe and Asia 0.05%, crypto 0.02%). Limit orders fill only at their price or better. Monthly plans size their buy at the ask.
- **Settlement:** every fill records when it settles (Taiwan, Japan, Hong Kong, Korea, Europe, Australia and Singapore T+2; the US, Canada, India and China T+1; the UK, the EU and Switzerland T+1 from 2027-10-11), counted in the market's own business days (weekends and its holidays skipped) and ending at 23:59 in the market's own time. Sale money can buy again at once in its market, but can't be exchanged into another currency until it settles; wallets show what's still settling.
- **Taiwan odd lots** (not whole lots of 1,000) match only from 09:10, in the intraday odd-lot session, live and in history.
- **Quadra Plus** (the kit's `PLUS.stock`, `usePlus` in `account.mjs`): half the commission (its minimum too), half the FX spread, 1 point off a new loan's rate, and 2% a year on NT$ cash. Each counts by when it happens: a trade by its fill time, an exchange or loan by its moment, cash interest by each Taiwan month the membership was paid for (the wallet's `eco:plus:<month>`). The ticket, the FX desk and the loan form show the member price as one quiet line.
- **Interest on idle NT$:** the settlement account earns the bank's demand-deposit rate (0.8% a year, `CASH_RATE`; Quadra Plus 2%), accrued daily and paid June 21 and December 21, with 10% tax and the 2.11% NHI premium on a payment of NT$20,000 or more.
- **The ledger is read as of a moment:** `replay(account, t)` ignores anything dated after `t`.
- **Data safety:** an account with no sync code, not installed to the home screen, gets a reminder that Safari can clear site data after 7 days unopened.

**Each market's own exchange rules** (`markets.mjs`, detail sheet 交易規則):

- **Tick sizes** by price band: Taiwan, the US, Hong Kong (the spread table after the 2025 reduction), Japan (the TOPIX 500 table), Korea (the 2023 table; ETFs 5 won), China (0.01; funds 0.001).
- **Daily price limits:** Taiwan ±10%, China ±10% (±20% on STAR 688xxx and ChiNext 300xxx/301xxx), Korea ±30%, Japan a yen amount by price band. Limit orders outside them are refused.
- **Board lots:** Japan 100 shares, China buys in 100s, Hong Kong each stock's own lot (the listed ones; e.g. HSBC 400, Tencent 100). An odd remainder sells whole. Taiwan keeps its odd-lot session; Singapore has its unit-share market.
- **Lunch breaks:** Tokyo 11:30–12:30, Hong Kong 12:00–13:00, Shanghai and Shenzhen 11:30–13:00, Singapore 12:00–13:00 (local time): no fills, shown as 午休.
- **China A-shares** are bought from abroad through Stock Connect: they trade only on days Hong Kong is open too, and shares bought today can be sold from the next trading day (T+1).

**What's still limited:**

- **Price delays** (Yahoo's `exchangeDataDelayedBy`): US stocks and funds, forex, crypto and the US yields are live; Taiwan, Tokyo, Seoul and Sydney 20 minutes; Hong Kong, Shanghai, London, Paris, Frankfurt, Milan, Madrid, Zurich, Toronto and India 15; Singapore and COMEX metals 10; Amsterdam and Copenhagen live. Orders fill at those prices. The Taiwan exchange's own real-time feed refuses requests from servers, so it can't go through the Worker.
- **Holidays** (`public/lib/holidays.mjs`): rule-based calendars for the US, UK, Europe, Switzerland, Denmark, Canada, Australia and Japan (any year), and the published 2026-27 calendars for Taiwan, Hong Kong, China, Korea and Singapore; a closed market's next opening skips them and the detail sheet lists the next ones. Other markets, and those five past 2027, fall back to weekdays.
- **Non-US government bonds** use reference yields, not live ones.

**Refreshes:**

- Quotes for holdings, open orders, the watchlist, currencies and the strip every 45 seconds while the page is visible; the open list every 90.
- Waiting orders are checked and today's net worth recorded after each refresh.
- Dividends and splits are checked twice a day for everything ever held.

**Offline and installable:** opened from the home screen, the top bar starts below the status bar (`env(safe-area-inset-top)`) and is solid rather than see-through, which iPadOS smeared. `public/sw.js` keeps the page's own files (each stamped version once), and the last prices are saved, so the app opens without a connection and shows when its prices are from; trading and exchanging wait for live prices. It can be installed to a phone's home screen.

**Saves** are gzip-compressed (`codec.mjs`) and kept with the Quadra Pass through Shared-Proxy's `/eco` (a copy on the device under the pass). Two devices' copies merge (nothing counted twice).

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
| `public/lib/holidays.mjs` | Exchange holiday calendars |
| `public/lib/foryou.mjs` | For you: candidates and their qualities for the shared recommender |
| `public/lib/quadra.mjs` | Quadra: the pass, the pool, the shell (shared by the four apps) |
| `public/lib/timemachine.mjs` | The time machine and moving averages |
| `public/sw.js` | Offline files and alert notifications |
| `public/lib/quadra.mjs`, `public/quadra.css` | The shared Quadra kit (sign-in, session, pool, recommender; copied from Shared-Proxy's `kit/`) |
| `public/lib/codec.mjs` | Compressed saves |
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
