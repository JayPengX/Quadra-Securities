// The beginner course: short lessons with live examples, a one-question quiz
// each, "try it" buttons into the app, missions that tick themselves off
// from the account's own history, and a glossary. Text in both languages;
// {placeholders} are filled with live numbers by the page (see lessonContext
// in app.js). Nothing here is investment advice.

// try: [kind, target] — 'open' a symbol's sheet, or 'goto' a tab.
export const LESSONS = [
  {
    id: 'stock',
    icon: '🏢',
    title: { zh: '股票是什麼？', en: 'What is a stock?' },
    body: {
      zh: [
        '一張股票就是一家公司的一小塊。買台積電的股票，你就成了台積電的小股東：公司賺錢，你的那一小塊也跟著更值錢。',
        '股價是買的人和賣的人喊出來的：想買的人多，價格就漲；想賣的人多，價格就跌。短期漲跌常常跟公司好壞無關，只是大家的心情；長期來說，股價大致跟著公司賺的錢走。',
        '股票賺錢有兩種方式：價差（低買高賣）和股利（公司把賺的錢分給股東）。',
        '台積電現在一股 {tsmc}。台股的單位是「張」，1 張 = 1,000 股，買一張要 {tsmcLot}；這裡也可以買零股，一股一股買。'
      ],
      en: [
        'A share is a small piece of a company. Buy TSMC shares and you own a sliver of TSMC: when the company earns more, your sliver is worth more.',
        'The price is set by buyers and sellers: more people wanting to buy pushes it up, more wanting to sell pushes it down. Day to day it often has little to do with the company, just mood; over years, prices roughly follow what companies earn.',
        'A stock pays you two ways: a higher price (buy low, sell high) and dividends (the company handing part of its profit to owners).',
        'One TSMC share costs {tsmc} right now. Taiwan trades in lots of 1,000 shares, so a lot is {tsmcLot}; here you can also buy odd lots, one share at a time.'
      ]
    },
    try: [['open', '2330.TW']],
    quiz: {
      q: { zh: '買了一家公司的股票，你擁有的是什麼？', en: 'What do you own when you buy a company’s stock?' },
      options: [
        { zh: '借給公司的一筆錢', en: 'A loan to the company' },
        { zh: '公司的一小部分', en: 'A small part of the company' },
        { zh: '公司產品的折價券', en: 'A discount on its products' }
      ],
      answer: 1,
      why: { zh: '股票是所有權；借錢給公司或政府的是債券。', en: 'A stock is ownership; lending to a company or government is a bond.' }
    }
  },
  {
    id: 'quote',
    icon: '📊',
    title: { zh: '怎麼看報價', en: 'Reading a quote' },
    body: {
      zh: [
        '「漲跌」是跟昨天收盤價（昨收）比。台灣習慣紅色是漲、綠色是跌，跟歐美相反（說明裡可以切換）。',
        '「今日區間」是今天最低到最高價，「52 週區間」是一年內的最低到最高：現在的價格靠近哪一端，可以看出最近是熱還是冷。',
        '「成交量」是今天換手了多少股，量大代表很多人在買賣。',
        '每個市場有自己的交易時間：台股 9:00–13:30，美股是台灣的晚上。收盤後價格不會動，送出的單要等下一次開盤。'
      ],
      en: [
        'The change is against yesterday’s close. Taiwan shows gains in red and losses in green, the reverse of the West (switch it in settings).',
        'The day’s range is today’s low to high; the 52-week range is the year’s. Where today’s price sits in it tells you whether it’s been hot or cold.',
        'Volume is how many shares changed hands today; high volume means a lot of buying and selling.',
        'Each market has its own hours: Taiwan 9:00–13:30, the US in Taiwan’s night. After the close the price stops, and new orders wait for the next open.'
      ]
    },
    try: [['open', '2330.TW'], ['goto', 'markets']],
    quiz: {
      q: { zh: '在台灣的看盤軟體上，紅色通常代表？', en: 'On Taiwanese screens, red usually means…' },
      options: [
        { zh: '下跌', en: 'Down' },
        { zh: '上漲', en: 'Up' },
        { zh: '停止交易', en: 'Halted' }
      ],
      answer: 1,
      why: { zh: '台灣、中國、日本都是紅漲綠跌；歐美是綠漲紅跌。', en: 'Taiwan, China and Japan use red for up; the US and Europe use green.' }
    }
  },
  {
    id: 'orders',
    icon: '📝',
    title: { zh: '下單：市價、限價、停損', en: 'Orders: market, limit, stop' },
    body: {
      zh: [
        '市價單：「現在的價格就好」，馬上成交，但你不能決定價格。',
        '限價單：「最多只付這麼多」（買）或「至少要賣這麼多」（賣）。價格到了才成交，沒到就一直等。適合不急、想買便宜一點的時候。',
        '停損單：「跌破這個價就幫我賣掉」，用來限制虧損。例如 {tsmc} 買的台積電，設 10% 停損就是跌到大約 {tsmcStop} 自動賣出。',
        '掛著的單會先把錢（或股票）保留起來，避免你同一筆錢用兩次。'
      ],
      en: [
        'Market order: “whatever the price is now.” It fills at once, but you don’t pick the price.',
        'Limit order: “pay at most this” (buy) or “sell for at least this” (sell). It fills only when the price gets there, and waits until then. Good when you’re not in a hurry and want a better price.',
        'Stop order: “sell if it falls below this,” to cap a loss. TSMC bought at {tsmc} with a 10% stop sells automatically near {tsmcStop}.',
        'An open order holds its money (or shares) aside, so the same money can’t be used twice.'
      ]
    },
    try: [['open', '2330.TW']],
    quiz: {
      q: { zh: '想用「不超過 NT$100」買一檔股票，該用哪種單？', en: 'To buy only at NT$100 or less, which order?' },
      options: [
        { zh: '市價單', en: 'Market' },
        { zh: '限價單，限價 100', en: 'Limit at 100' },
        { zh: '停損單，觸發價 100', en: 'Stop at 100' }
      ],
      answer: 1,
      why: { zh: '限價單保證價格不會比你設的差；市價單什麼價都成交。', en: 'A limit order never fills at a worse price than yours; a market order takes any price.' }
    }
  },
  {
    id: 'costs',
    icon: '💸',
    title: { zh: '手續費和稅：看不見的成本', en: 'Fees and taxes: the hidden cost' },
    body: {
      zh: [
        '每次交易都要付錢給券商和政府。台股買進付手續費 0.1425%，賣出再付手續費和 0.3% 證交稅。',
        '買一張台積電（{tsmcLot}）手續費 {tsmcFee}；賣掉時手續費加稅約 {tsmcSellCost}。一買一賣就花掉 {roundTrip}，股價要先漲這麼多才開始賺。',
        '所以一直短線進出，很容易賺到的都被費用吃掉。「紀錄 → 統計分析」會算出你總共付了多少成本。'
      ],
      en: [
        'Every trade pays the broker and the government. In Taiwan a buy pays a 0.1425% commission; a sale pays it again plus a 0.3% transaction tax.',
        'A lot of TSMC ({tsmcLot}) costs {tsmcFee} in commission to buy and about {tsmcSellCost} in commission and tax to sell. A round trip costs {roundTrip}: the price has to rise that much before you make anything.',
        'That’s why frequent trading tends to hand the gains to fees. History → Stats adds up everything you’ve paid.'
      ]
    },
    try: [['goto', 'history']],
    quiz: {
      q: { zh: '一年買賣 50 次，每次來回成本 0.6%，大約會吃掉多少報酬？', en: '50 round trips a year at 0.6% each costs roughly…' },
      options: [
        { zh: '0.6%', en: '0.6%' },
        { zh: '6%', en: '6%' },
        { zh: '30%', en: '30%' }
      ],
      answer: 2,
      why: { zh: '50 × 0.6% = 30%，比股市一年平均報酬還多。', en: '50 × 0.6% = 30%, more than the market’s typical yearly return.' }
    }
  },
  {
    id: 'etf',
    icon: '🧺',
    title: { zh: 'ETF：一次買一籃子', en: 'ETFs: a whole basket at once' },
    body: {
      zh: [
        'ETF 是一籃子股票打包成一檔。0050 一次買進台灣最大的 50 家公司，一股 {etf}；VOO 是美國最大的 500 家公司。',
        '分散的好處：一家公司出事，只占籃子的一小部分。個股可能腰斬，整個市場同時腰斬就少見得多。',
        '很多研究發現，長期下來大部分主動選股的人贏不過「買整個市場放著」。「紀錄 → 統計分析」最下面會拿你的成績跟 0050、VOO 比。',
        '高股息 ETF（0056、00878）挑配息多的公司；債券 ETF（00679B、TLT）買的是債券；槓桿 ETF（00631L）一天漲跌兩倍，不適合長抱。'
      ],
      en: [
        'An ETF packs a basket of stocks into one. 0050 buys Taiwan’s 50 largest companies at once, {etf} a share; VOO holds America’s largest 500.',
        'That’s diversification: one company’s trouble is a small part of the basket. A single stock can halve; the whole market halving is much rarer.',
        'Study after study finds most stock pickers trail “buy the whole market and hold” over the long run. History → Stats compares your results with 0050 and VOO.',
        'High-dividend ETFs (0056, 00878) pick big payers; bond ETFs (00679B, TLT) hold bonds; leveraged ETFs (00631L) move twice the market in a day and aren’t for holding long.'
      ]
    },
    try: [['open', '0050.TW'], ['open', 'VOO']],
    quiz: {
      q: { zh: '買 0050 最大的好處是？', en: 'The main point of buying 0050?' },
      options: [
        { zh: '保證不會賠錢', en: 'It can’t lose money' },
        { zh: '一次分散到 50 家公司', en: 'Spread across 50 companies at once' },
        { zh: '每天都會漲', en: 'It rises every day' }
      ],
      answer: 1,
      why: { zh: 'ETF 還是會跌（整個市場跌它就跌），但不會因為一家公司出事就大賠。', en: 'It still falls when the market does, but one company’s trouble can’t sink it.' }
    }
  },
  {
    id: 'dividends',
    icon: '💰',
    title: { zh: '股利：公司發的錢', en: 'Dividends: the company pays you' },
    body: {
      zh: [
        '很多公司每年（或每季）把一部分獲利發給股東，這就是股利。要在「除息日」前持有才領得到。',
        '除息那天，股價通常會扣掉股利的金額：錢從股價移到你的口袋，不是白送的。',
        '股利也要繳稅：台股單筆超過 NT$20,000 扣 2.11% 二代健保；美股股利預扣 30%。這個模擬會自動入帳、自動扣稅。'
      ],
      en: [
        'Many companies pay part of their profit to owners every year (or quarter): the dividend. You must hold before the ex-dividend date to get it.',
        'On that date the price usually drops by the dividend: the money moves from the price into your pocket, it isn’t free.',
        'Dividends are taxed: a Taiwan payment of NT$20,000+ loses 2.11% to the NHI premium; US dividends have 30% withheld. Here they’re credited and taxed automatically.'
      ]
    },
    try: [['open', '0056.TW']],
    quiz: {
      q: { zh: '除息日股價通常會？', en: 'On the ex-dividend date the price usually…' },
      options: [
        { zh: '大漲慶祝', en: 'Jumps' },
        { zh: '扣掉大約股利的金額', en: 'Drops by about the dividend' },
        { zh: '不會變', en: 'Doesn’t change' }
      ],
      answer: 1,
      why: { zh: '公司的錢少了那麼多，股價也就少了那麼多。', en: 'The company has that much less cash, so the price is that much lower.' }
    }
  },
  {
    id: 'fx',
    icon: '💱',
    title: { zh: '買外國股票：匯率也是風險', en: 'Foreign stocks: currency is a risk too' },
    body: {
      zh: [
        '美股用美元買、日股用日圓買，所以要先換匯。現在 1 美元 = {usd} 新台幣。銀行換匯會收價差，週末還加倍。',
        '報酬要用新台幣算：蘋果漲 10%，但同時美元對台幣貶 5%，換回來大約只賺 5%。反過來美元升值，股票沒漲也能賺。',
        '這也是分散：持有不同貨幣的資產，台幣變弱時不會全部一起縮水。'
      ],
      en: [
        'US stocks are bought in dollars, Japanese in yen, so you exchange first. Right now US$1 = NT${usd}. Banks keep a spread on each exchange, doubled at weekends.',
        'Returns count in NT$: Apple up 10% while the dollar falls 5% against the NT$ nets you about 5%. A rising dollar pays you even if the stock stands still.',
        'It’s diversification too: assets in several currencies don’t all shrink when the NT$ weakens.'
      ]
    },
    try: [['goto', 'fx'], ['open', 'AAPL']],
    quiz: {
      q: { zh: '美股漲 10%，美元對台幣跌 10%，用台幣算大約？', en: 'A US stock rises 10% and the dollar falls 10% against NT$. In NT$ you’re about…' },
      options: [
        { zh: '賺 20%', en: 'Up 20%' },
        { zh: '差不多打平', en: 'Flat' },
        { zh: '賺 10%', en: 'Up 10%' }
      ],
      answer: 1,
      why: { zh: '1.1 × 0.9 = 0.99，匯損把漲幅吃掉了。', en: '1.1 × 0.9 = 0.99: the currency ate the gain.' }
    }
  },
  {
    id: 'bonds',
    icon: '🏛️',
    title: { zh: '債券：借錢給政府', en: 'Bonds: lending to governments' },
    body: {
      zh: [
        '買公債就是借錢給政府：政府定期付你利息（票面利率），到期把本金還你。比股票穩定得多。',
        '美國 10 年公債殖利率現在是 {us10y}：現在買、放到到期，每年大約賺這麼多。',
        '重要規則：利率上升，舊債券變便宜；利率下降，舊債券變貴。年期越長，價格動得越大。所以債券不是完全不會跌，只是通常跌得比股票少。',
        '很多人用「股票 + 債券」的組合：股市大跌時，債券常常比較穩，讓你不會一次輸光。'
      ],
      en: [
        'A government bond is a loan to a government: it pays you interest (the coupon) on a schedule and repays the principal at maturity. Much steadier than stocks.',
        'The US 10-year yield is {us10y} now: buy today and hold to maturity, and that’s roughly your yearly return.',
        'The key rule: when interest rates rise, existing bonds get cheaper; when rates fall, they get dearer. Longer bonds move more. So bonds can fall, just usually less than stocks.',
        'Many people mix stocks and bonds: when stocks crash, bonds often hold up, so you never lose everything at once.'
      ]
    },
    try: [['open', 'UST-10Y'], ['open', 'TWGB-10Y']],
    quiz: {
      q: { zh: '市場利率上升時，你手上舊債券的價格會？', en: 'When interest rates rise, the bonds you hold…' },
      options: [
        { zh: '上漲', en: 'Rise' },
        { zh: '下跌', en: 'Fall' },
        { zh: '不變', en: 'Stay put' }
      ],
      answer: 1,
      why: { zh: '新債券利息更高，舊債券要降價才賣得掉。', en: 'New bonds pay more, so old ones must get cheaper to compete.' }
    }
  },
  {
    id: 'volatile',
    icon: '🪙',
    title: { zh: '加密貨幣和黃金：沒有利息的東西', en: 'Crypto and gold: nothing paid to you' },
    body: {
      zh: [
        '比特幣現在約 {btc}。它 24 小時交易，一天漲跌 5–10% 很常見，一年腰斬過好幾次。',
        '黃金、比特幣都不會發利息或股利：會賺錢只因為之後有人願意用更高的價格買。',
        '如果想碰，通常建議只放一小部分、而且是賠光也不影響生活的錢。'
      ],
      en: [
        'Bitcoin is about {btc} now. It trades around the clock, moves 5–10% in a day often, and has halved several times.',
        'Gold and bitcoin pay no interest or dividends: they gain only if someone later pays more for them.',
        'If you want some, the usual advice is a small slice, money you could lose entirely without it hurting.'
      ]
    },
    try: [['open', 'BTC-USD'], ['open', 'XAU']],
    quiz: {
      q: { zh: '以下哪個會定期付錢給你？', en: 'Which of these pays you something regularly?' },
      options: [
        { zh: '比特幣', en: 'Bitcoin' },
        { zh: '黃金', en: 'Gold' },
        { zh: '公債', en: 'A government bond' }
      ],
      answer: 2,
      why: { zh: '公債付利息；比特幣和黃金只能靠漲價賺錢。', en: 'Bonds pay interest; bitcoin and gold only gain by rising in price.' }
    }
  },
  {
    id: 'time',
    icon: '⏳',
    title: { zh: '時間和複利：最強的武器', en: 'Time and compounding' },
    body: {
      zh: [
        '複利是「賺到的錢再去賺錢」。每個月存 NT$10,000、存 30 年，本金是 {saved}；如果每年平均賺 6%，會變成約 {compound6}。',
        '股市短期很難預測，一年跌 20% 以上不稀奇；但放得越久，賠錢的機率通常越低。',
        '所以：短期（3 年內）要用的錢不要放股票；先留好緊急預備金（幾個月生活費）；剩下的長期放著。',
        '「定期定額」每個月固定買一點，不用猜高低點，跌的時候還能買到比較多股。'
      ],
      en: [
        'Compounding is gains earning gains. NT$10,000 a month for 30 years is {saved} put in; at an average 6% a year it grows to about {compound6}.',
        'The market is hard to predict over short spans, and a 20%+ fall in a year isn’t rare; the longer you hold, the lower the odds of losing, historically.',
        'So: money needed within about 3 years shouldn’t be in stocks; keep an emergency fund (a few months of expenses) first; invest the rest for the long run.',
        'Investing a fixed amount every month (dollar-cost averaging) means no guessing tops and bottoms, and buys more shares when prices are low.'
      ]
    },
    try: [['goto', 'portfolio']],
    quiz: {
      q: { zh: '三個月後要繳學費的錢，放哪裡比較適合？', en: 'Money for tuition due in three months belongs…' },
      options: [
        { zh: '股票', en: 'In stocks' },
        { zh: '加密貨幣', en: 'In crypto' },
        { zh: '現金或定存', en: 'In cash or a deposit' }
      ],
      answer: 2,
      why: { zh: '短期要用的錢承受不了股市下跌。', en: 'Money needed soon can’t ride out a market fall.' }
    }
  },
  {
    id: 'leverage',
    icon: '⚠️',
    title: { zh: '槓桿：融資和放空', en: 'Leverage: margin and shorting' },
    body: {
      zh: [
        '融資是借錢買股票。自己的 100 萬再借 50 萬，股票漲 20% 你賺 30%；但跌 20% 你賠 30%，還要付利息。',
        '跌太多時券商會要你補錢（追繳），再不補就直接幫你賣掉（斷頭），常常賣在最低點。',
        '放空是借股票來賣，賭它會跌。漲的時候賠錢，而且理論上可以賠無限多。',
        '新手最好先不要用槓桿。在這裡可以試，但試的時候看看「維持率」會怎麼變化。'
      ],
      en: [
        'Margin is buying with borrowed money. With NT$1M of your own plus NT$500k borrowed, a 20% rise makes you 30%; a 20% fall loses you 30%, plus interest.',
        'Fall too far and the broker demands more money (a margin call), then sells you out if you don’t, often at the bottom.',
        'Shorting is selling borrowed shares, betting on a fall. A rise costs you, with no limit in theory.',
        'Beginners are best off without leverage. You can try it here: watch what happens to the maintenance ratio.'
      ]
    },
    try: [['goto', 'fx']],
    quiz: {
      q: { zh: '用一半借來的錢買股票，股票跌 20%，你的錢大約少了？', en: 'Half your purchase is borrowed and the stock falls 20%. Your own money falls about…' },
      options: [
        { zh: '10%', en: '10%' },
        { zh: '20%', en: '20%' },
        { zh: '40%', en: '40%' }
      ],
      answer: 2,
      why: { zh: '跌的是全部部位的 20%，但只有一半是你的錢，所以是 40%（還沒算利息）。', en: 'The whole position drops 20%, but only half was yours: 40% (before interest).' }
    }
  },
  {
    id: 'mistakes',
    icon: '🙈',
    title: { zh: '新手最常犯的錯', en: 'Common beginner mistakes' },
    body: {
      zh: [
        '追高殺低：看到大漲才衝進去，看到大跌就嚇得賣掉，剛好買在高點、賣在低點。',
        '全部押一檔：聽說某檔會漲就 all in。再好的公司也可能出事。',
        '太常交易：費用和稅會慢慢吃掉報酬。',
        '想把輸的一次賺回來：加大金額、用槓桿，通常輸更多。',
        '聽明牌：網路上說「一定漲」的，大多是想賣給你的人。'
      ],
      en: [
        'Buying high, selling low: jumping in after big rises and panic-selling after big falls.',
        'All in on one stock because someone said it’ll rise. Even great companies stumble.',
        'Trading too often: fees and taxes quietly eat the returns.',
        'Trying to win it all back at once: bigger bets and leverage usually lose more.',
        'Hot tips: whoever online says “it can’t fail” usually wants to sell it to you.'
      ]
    },
    try: [['goto', 'history']],
    quiz: {
      q: { zh: '股票一週跌了 15%，新手最常見的錯誤反應是？', en: 'A stock falls 15% in a week. The classic beginner mistake is…' },
      options: [
        { zh: '先查清楚為什麼跌', en: 'Find out why first' },
        { zh: '嚇到馬上全部賣掉', en: 'Panic and sell everything' },
        { zh: '照原本的計畫', en: 'Stick to the plan' }
      ],
      answer: 1,
      why: { zh: '恐慌賣出常常賣在最低點；先想清楚理由有沒有改變。', en: 'Panic selling often sells at the bottom; first ask whether the reason you bought has changed.' }
    }
  },
  {
    id: 'start',
    icon: '🚀',
    title: { zh: '在這裡練習的起手式', en: 'A practice plan to start with' },
    body: {
      zh: [
        '這只是練習用的例子，不是投資建議：把模擬的錢分成幾份，例如 50% 買 0050（台灣）、20% 換美元買 VT（全世界）、20% 債券（公債或 00679B）、10% 留現金。',
        '然後先放 3 個月，不要一直看、一直換。期間可以每月再「加碼入金」模擬定期定額。',
        '3 個月後打開「紀錄 → 統計分析」：看看成本付了多少、跟無腦買 0050 比起來怎麼樣，再決定要不要調整。',
        '想學短線或槓桿？可以另外開一個帳戶（說明 → 設定 → 清空帳戶）做實驗，比較兩個的結果。'
      ],
      en: [
        'A practice example only, not investment advice: split the play money, say 50% in 0050 (Taiwan), 20% into US$ for VT (the whole world), 20% in bonds (a government bond or 00679B) and 10% cash.',
        'Then leave it three months: don’t keep checking and switching. Add money monthly to mimic a savings plan if you like.',
        'After three months, open History → Stats: see what it cost you and how it did against just buying 0050, then decide whether to change anything.',
        'Curious about short-term trading or leverage? Start a separate experiment later (Guide → Settings → Clear account) and compare.'
      ]
    },
    try: [['open', '0050.TW'], ['open', 'VT'], ['open', '00679B.TWO']],
    quiz: {
      q: { zh: '這個練習最重要的是？', en: 'The most important part of this practice?' },
      options: [
        { zh: '每天換股票', en: 'Switching stocks daily' },
        { zh: '分散、放著、之後檢討', en: 'Spread out, hold, review later' },
        { zh: '全部買漲最多的那檔', en: 'All into last month’s winner' }
      ],
      answer: 1,
      why: { zh: '分散和時間是新手最可靠的兩個朋友。', en: 'Diversification and time are a beginner’s two most reliable friends.' }
    }
  }
];

// Missions tick themselves off from what the account has actually done.
export const MISSIONS = [
  { id: 'open', zh: '開一個模擬帳戶', en: 'Open a practice account', done: a => Boolean(a) },
  { id: 'twStock', zh: '買一檔台股', en: 'Buy a Taiwan stock', done: a => fills(a).some(e => e.side === 'buy' && e.market === 'TW' && e.kind === 'stock') },
  { id: 'etf', zh: '買一檔 ETF', en: 'Buy an ETF', done: a => fills(a).some(e => e.side === 'buy' && (e.kind === 'etf' || e.kind === 'bond')) },
  { id: 'limit', zh: '掛一張限價單', en: 'Place a limit order', done: a => (a?.orders || []).some(o => o.type === 'limit') },
  { id: 'fx', zh: '換一次外幣', en: 'Exchange some currency', done: a => (a?.events || []).some(e => e.type === 'fx') },
  { id: 'foreign', zh: '買一檔外國的股票或 ETF', en: 'Buy something abroad', done: a => fills(a).some(e => e.side === 'buy' && e.currency !== 'TWD' && e.market !== 'CRYPTO') },
  { id: 'bond', zh: '買一張公債', en: 'Buy a government bond', done: a => fills(a).some(e => e.side === 'buy' && e.kind === 'govbond') },
  { id: 'income', zh: '領到股利或利息', en: 'Receive a dividend or coupon', done: a => (a?.events || []).some(e => e.type === 'div' && e.net > 0) },
  { id: 'spread', zh: '同時持有 3 個不同市場', en: 'Hold 3 different markets at once', done: a => maxMarketsHeld(a) >= 3 },
  { id: 'patient', zh: '一檔持有超過 30 天', en: 'Hold something for 30+ days', done: (a, now = Date.now()) => heldLong(a, now) }
];

const fills = a => (a?.events || []).filter(e => e.type === 'fill' && !e.forced && !e.maturity);

function maxMarketsHeld(a) {
  const qty = {};
  const market = {};
  let best = 0;
  for (const e of fills(a).sort((x, y) => x.t - y.t)) {
    qty[e.symbol] = (qty[e.symbol] || 0) + (e.side === 'buy' ? e.qty : -e.qty);
    market[e.symbol] = e.market;
    const held = new Set(Object.keys(qty).filter(s => qty[s] > 1e-9).map(s => market[s]));
    best = Math.max(best, held.size);
  }
  return best;
}

function heldLong(a, now) {
  const since = {};
  const qty = {};
  for (const e of fills(a).sort((x, y) => x.t - y.t)) {
    const before = qty[e.symbol] || 0;
    qty[e.symbol] = before + (e.side === 'buy' ? e.qty : -e.qty);
    if (before <= 1e-9 && qty[e.symbol] > 1e-9) since[e.symbol] = e.t;
    if (qty[e.symbol] <= 1e-9) {
      if (since[e.symbol] != null && e.t - since[e.symbol] >= 30 * 86_400_000) return true;
      delete since[e.symbol];
    }
  }
  return Object.values(since).some(t => now - t >= 30 * 86_400_000);
}

export const GLOSSARY = [
  ['股票 Stock', '公司的一小部分所有權。', 'A small share of ownership in a company.'],
  ['張 / 零股 Lot / odd lot', '台股 1 張 = 1,000 股；不到一張叫零股。', 'In Taiwan a lot is 1,000 shares; fewer is an odd lot.'],
  ['ETF', '一籃子股票或債券打包成一檔，在交易所買賣。', 'A basket of stocks or bonds traded as one security.'],
  ['指數 Index', '一群股票的平均表現，例如加權指數、標普 500。本身不能買，要買追蹤它的 ETF。', 'The average of a group of stocks (TAIEX, S&P 500). Buy an ETF that tracks it.'],
  ['市值 Market value', '持股數 × 現價。', 'Shares × current price.'],
  ['成本 / 均價 Cost / average', '你買進時平均每股付了多少（含手續費）。', 'What you paid per share on average, fees included.'],
  ['未實現 / 已實現損益 Unrealized / realized P/L', '還沒賣的帳面盈虧 / 賣掉之後真正的盈虧。', 'Paper gain or loss on what you still hold / the actual result once sold.'],
  ['股利 / 除息 Dividend / ex-date', '公司發給股東的錢 / 決定誰領得到的那一天，股價會扣掉股利。', 'Profit paid to owners / the day that decides who gets it; the price drops by it.'],
  ['殖利率 Yield', '一年拿到的利息或股利占價格的比例。', 'Yearly interest or dividends as a share of the price.'],
  ['票面利率 / 到期 Coupon / maturity', '債券每年付的利息 / 還本的日子。', 'A bond’s yearly interest / the day it repays.'],
  ['市價單 / 限價單 Market / limit order', '現價馬上成交 / 價格到了才成交。', 'Fill now at any price / fill only at your price or better.'],
  ['停損 Stop loss', '跌破某價格自動賣出，限制虧損。', 'Sell automatically below a price to cap the loss.'],
  ['分散 Diversification', '把錢放在很多不同的東西上，一個出事不會全倒。', 'Spreading money so one failure can’t sink it all.'],
  ['波動 Volatility', '價格上下跳動的幅度；越大越刺激也越危險。', 'How much a price swings; more swing, more risk.'],
  ['複利 Compounding', '賺到的錢再拿去賺錢，時間越長效果越大。', 'Gains earning gains; stronger with time.'],
  ['定期定額 Dollar-cost averaging', '每個月固定金額買進，不猜高低點。', 'Investing a fixed sum every month, no timing.'],
  ['融資 / 維持率 Margin / maintenance ratio', '借錢買股 / 總資產除以欠款，太低會被追繳、斷頭。', 'Buying with borrowed money / assets ÷ debt; too low brings a call, then a forced sale.'],
  ['放空 Short selling', '借股票來賣，跌了再買回來還，賭它會跌。', 'Selling borrowed shares to buy back cheaper: a bet on a fall.'],
  ['匯率 / 價差 Exchange rate / spread', '兩種貨幣的交換比例 / 銀行買賣價中間賺的差。', 'The price of one currency in another / the bank’s cut between its buy and sell rates.'],
  ['牛市 / 熊市 Bull / bear market', '大漲一段時間 / 大跌一段時間（通常跌 20% 以上）。', 'A long rise / a long fall (usually 20%+).']
];
