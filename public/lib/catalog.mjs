import { BONDS, bondName } from './bonds.mjs';

// What the markets tab lists: curated lists by market and kind, each item
// [Yahoo symbol, Chinese name, English name, kind if not Yahoo's own]. Any
// other symbol is a search away; these carry Chinese names (Yahoo has none)
// and are what Chinese searches find.

const TW = [
  ['2330.TW', '台積電', 'TSMC'], ['2317.TW', '鴻海', 'Hon Hai (Foxconn)'], ['2454.TW', '聯發科', 'MediaTek'],
  ['2308.TW', '台達電', 'Delta Electronics'], ['2382.TW', '廣達', 'Quanta Computer'], ['2881.TW', '富邦金', 'Fubon Financial'],
  ['2882.TW', '國泰金', 'Cathay Financial'], ['2891.TW', '中信金', 'CTBC Financial'], ['2412.TW', '中華電', 'Chunghwa Telecom'],
  ['2303.TW', '聯電', 'UMC'], ['3711.TW', '日月光投控', 'ASE Technology'], ['2886.TW', '兆豐金', 'Mega Financial'],
  ['2884.TW', '玉山金', 'E.Sun Financial'], ['2892.TW', '第一金', 'First Financial'], ['5880.TW', '合庫金', 'Taiwan Cooperative Financial'],
  ['1301.TW', '台塑', 'Formosa Plastics'], ['1303.TW', '南亞', 'Nan Ya Plastics'], ['6505.TW', '台塑化', 'Formosa Petrochemical'],
  ['2002.TW', '中鋼', 'China Steel'], ['2603.TW', '長榮', 'Evergreen Marine'], ['2609.TW', '陽明', 'Yang Ming Marine'],
  ['2615.TW', '萬海', 'Wan Hai Lines'], ['2618.TW', '長榮航', 'EVA Air'], ['2610.TW', '華航', 'China Airlines'],
  ['3008.TW', '大立光', 'Largan Precision'], ['2357.TW', '華碩', 'ASUS'], ['2379.TW', '瑞昱', 'Realtek'],
  ['3231.TW', '緯創', 'Wistron'], ['6669.TW', '緯穎', 'Wiwynn'], ['2376.TW', '技嘉', 'Gigabyte'],
  ['3034.TW', '聯詠', 'Novatek'], ['2345.TW', '智邦', 'Accton'], ['3661.TW', '世芯-KY', 'Alchip'],
  ['3443.TW', '創意', 'Global Unichip'], ['2327.TW', '國巨', 'Yageo'], ['3037.TW', '欣興', 'Unimicron'],
  ['2408.TW', '南亞科', 'Nanya Technology'], ['2344.TW', '華邦電', 'Winbond'], ['2395.TW', '研華', 'Advantech'],
  ['1216.TW', '統一', 'Uni-President'], ['2912.TW', '統一超', 'President Chain Store'], ['2207.TW', '和泰車', 'Hotai Motor'],
  ['3045.TW', '台灣大', 'Taiwan Mobile'], ['1590.TW', '亞德客-KY', 'Airtac'], ['2301.TW', '光寶科', 'Lite-On'],
  ['9910.TW', '豐泰', 'Feng Tay'], ['8046.TW', '南電', 'Nan Ya PCB'], ['2356.TW', '英業達', 'Inventec'],
  ['6488.TWO', '環球晶', 'GlobalWafers'], ['5347.TWO', '世界', 'Vanguard International Semiconductor'], ['3293.TWO', '鈊象', 'IGS'],
  ['8299.TWO', '群聯', 'Phison'], ['5274.TWO', '信驊', 'ASPEED']
];

const TW_ETF = [
  ['0050.TW', '元大台灣50', 'Yuanta Taiwan Top 50'], ['006208.TW', '富邦台50', 'Fubon Taiwan 50'], ['0056.TW', '元大高股息', 'Yuanta High Dividend'],
  ['00878.TW', '國泰永續高股息', 'Cathay Sustainable High Dividend'], ['00919.TW', '群益台灣精選高息', 'Capital Taiwan Select High Dividend'],
  ['00929.TW', '復華台灣科技優息', 'Fuh Hwa Taiwan Tech Dividend'], ['00940.TW', '元大台灣價值高息', 'Yuanta Taiwan Value High Dividend'],
  ['00713.TW', '元大台灣高息低波', 'Yuanta High Dividend Low Volatility'], ['00692.TW', '富邦公司治理', 'Fubon Corporate Governance'],
  ['00881.TW', '國泰台灣5G+', 'Cathay Taiwan 5G+'], ['00631L.TW', '元大台灣50正2', 'Yuanta Taiwan 50 2x', 'etf'],
  ['00632R.TW', '元大台灣50反1', 'Yuanta Taiwan 50 -1x', 'etf'], ['00646.TW', '元大S&P500', 'Yuanta S&P 500'],
  ['00662.TW', '富邦NASDAQ', 'Fubon NASDAQ-100'], ['00757.TW', '統一FANG+', 'Uni-President FANG+'], ['00830.TW', '國泰費城半導體', 'Cathay Philadelphia Semiconductor'],
  ['00635U.TW', '元大S&P黃金', 'Yuanta S&P Gold'], ['00642U.TW', '元大S&P石油', 'Yuanta S&P Oil']
];

const US = [
  ['AAPL', '蘋果', 'Apple'], ['MSFT', '微軟', 'Microsoft'], ['NVDA', '輝達', 'NVIDIA'], ['GOOGL', 'Alphabet (Google)', 'Alphabet (Google)'],
  ['AMZN', '亞馬遜', 'Amazon'], ['META', 'Meta', 'Meta Platforms'], ['TSLA', '特斯拉', 'Tesla'], ['AVGO', '博通', 'Broadcom'],
  ['TSM', '台積電 ADR', 'TSMC ADR'], ['BRK-B', '波克夏', 'Berkshire Hathaway B'], ['JPM', '摩根大通', 'JPMorgan Chase'],
  ['V', 'Visa', 'Visa'], ['MA', '萬事達卡', 'Mastercard'], ['LLY', '禮來', 'Eli Lilly'], ['UNH', '聯合健康', 'UnitedHealth'],
  ['JNJ', '嬌生', 'Johnson & Johnson'], ['XOM', '埃克森美孚', 'Exxon Mobil'], ['WMT', '沃爾瑪', 'Walmart'], ['COST', '好市多', 'Costco'],
  ['PG', '寶僑', 'Procter & Gamble'], ['KO', '可口可樂', 'Coca-Cola'], ['PEP', '百事', 'PepsiCo'], ['MCD', '麥當勞', "McDonald's"],
  ['NKE', 'Nike', 'Nike'], ['DIS', '迪士尼', 'Disney'], ['NFLX', '網飛', 'Netflix'], ['AMD', '超微', 'AMD'], ['INTC', '英特爾', 'Intel'],
  ['QCOM', '高通', 'Qualcomm'], ['MU', '美光', 'Micron'], ['ORCL', '甲骨文', 'Oracle'], ['CRM', 'Salesforce', 'Salesforce'],
  ['ADBE', 'Adobe', 'Adobe'], ['PLTR', 'Palantir', 'Palantir'], ['UBER', 'Uber', 'Uber'], ['SBUX', '星巴克', 'Starbucks'],
  ['BA', '波音', 'Boeing'], ['COIN', 'Coinbase', 'Coinbase'], ['MSTR', 'Strategy (MicroStrategy)', 'Strategy (MicroStrategy)'],
  ['BABA', '阿里巴巴 ADR', 'Alibaba ADR'], ['ASML', '艾司摩爾 ADR', 'ASML ADR'], ['ARM', '安謀', 'Arm Holdings']
];

const US_ETF = [
  ['SPY', 'SPDR 標普500', 'SPDR S&P 500'], ['VOO', 'Vanguard 標普500', 'Vanguard S&P 500'], ['IVV', 'iShares 標普500', 'iShares Core S&P 500'],
  ['QQQ', '那斯達克100', 'Invesco QQQ (Nasdaq-100)'], ['VTI', '美國全市場', 'Vanguard Total Stock Market'], ['VT', '全世界股票', 'Vanguard Total World Stock'],
  ['VXUS', '美國以外全球', 'Vanguard Total International'], ['SCHD', '美國高股息', 'Schwab US Dividend Equity'], ['VYM', 'Vanguard 高股息', 'Vanguard High Dividend Yield'],
  ['DIA', '道瓊工業', 'SPDR Dow Jones'], ['IWM', '羅素2000小型股', 'iShares Russell 2000'], ['SOXX', '費城半導體', 'iShares Semiconductor'],
  ['SMH', 'VanEck 半導體', 'VanEck Semiconductor'], ['XLK', '科技類股', 'Technology Select Sector'], ['XLF', '金融類股', 'Financial Select Sector'],
  ['XLE', '能源類股', 'Energy Select Sector'], ['VNQ', '美國房地產', 'Vanguard Real Estate'], ['ARKK', '方舟創新', 'ARK Innovation'],
  ['EWT', '台灣 (iShares)', 'iShares MSCI Taiwan'], ['EWJ', '日本 (iShares)', 'iShares MSCI Japan'], ['EEM', '新興市場', 'iShares MSCI Emerging Markets'],
  ['IBIT', '比特幣現貨 ETF', 'iShares Bitcoin Trust'], ['TQQQ', '那斯達克100 三倍', 'ProShares UltraPro QQQ (3x)'], ['SQQQ', '那斯達克100 反三倍', 'ProShares UltraPro Short QQQ (-3x)']
];

const BOND_ETFS = [
  ['00679B.TWO', '元大美債20年', 'Yuanta US Treasury 20+ Year'], ['00687B.TWO', '國泰20年美債', 'Cathay US Treasury 20+ Year'],
  ['00937B.TWO', '群益ESG投等債20+', 'Capital ESG IG Corporate 20+'], ['00720B.TWO', '元大投資級公司債', 'Yuanta IG Corporate Bond'],
  ['TLT', '美國20年以上公債', 'iShares 20+ Year Treasury', 'bond'], ['IEF', '美國7–10年公債', 'iShares 7-10 Year Treasury', 'bond'],
  ['SHY', '美國1–3年公債', 'iShares 1-3 Year Treasury', 'bond'], ['SGOV', '美國短期國庫券', 'iShares 0-3 Month Treasury', 'bond'],
  ['BND', '美國整體債券', 'Vanguard Total Bond Market', 'bond'], ['AGG', 'iShares 美國綜合債', 'iShares Core US Aggregate Bond', 'bond'],
  ['LQD', '投資級公司債', 'iShares IG Corporate Bond', 'bond'], ['HYG', '高收益債', 'iShares High Yield Corporate Bond', 'bond'],
  ['TIP', '抗通膨公債', 'iShares TIPS Bond', 'bond'], ['EMB', '新興市場債', 'iShares JPM EM Bond', 'bond'], ['BNDX', '國際債券', 'Vanguard Total International Bond', 'bond'],
  ['^IRX', '美國13週國庫券殖利率', 'US 13-week T-bill yield'], ['^FVX', '美國5年公債殖利率', 'US 5-year yield'],
  ['^TNX', '美國10年公債殖利率', 'US 10-year yield'], ['^TYX', '美國30年公債殖利率', 'US 30-year yield']
];

const JP = [
  ['7203.T', '豐田汽車', 'Toyota'], ['6758.T', '索尼', 'Sony'], ['9984.T', '軟銀集團', 'SoftBank Group'], ['8306.T', '三菱日聯金融', 'MUFG'],
  ['6861.T', '基恩斯', 'Keyence'], ['7974.T', '任天堂', 'Nintendo'], ['9983.T', '迅銷 (Uniqlo)', 'Fast Retailing (Uniqlo)'],
  ['8035.T', '東京威力科創', 'Tokyo Electron'], ['6501.T', '日立', 'Hitachi'], ['7267.T', '本田', 'Honda'], ['4063.T', '信越化學', 'Shin-Etsu Chemical'],
  ['6098.T', 'Recruit', 'Recruit Holdings'], ['8058.T', '三菱商事', 'Mitsubishi Corp'], ['9432.T', 'NTT', 'NTT'],
  ['1321.T', '日經225 ETF', 'Nikkei 225 ETF'], ['1306.T', '東證指數 ETF', 'TOPIX ETF']
];

const HK_CN = [
  ['0700.HK', '騰訊', 'Tencent'], ['9988.HK', '阿里巴巴', 'Alibaba'], ['3690.HK', '美團', 'Meituan'], ['1810.HK', '小米', 'Xiaomi'],
  ['9618.HK', '京東', 'JD.com'], ['1211.HK', '比亞迪', 'BYD'], ['0005.HK', '滙豐控股', 'HSBC'], ['0941.HK', '中國移動', 'China Mobile'],
  ['1299.HK', '友邦保險', 'AIA'], ['0388.HK', '香港交易所', 'HKEX'], ['2318.HK', '中國平安', 'Ping An'], ['2800.HK', '盈富基金', 'Tracker Fund of Hong Kong'],
  ['2828.HK', '恒生中國企業 ETF', 'Hang Seng China Enterprises ETF'], ['3033.HK', '南方恒生科技 ETF', 'CSOP Hang Seng Tech ETF'],
  ['600519.SS', '貴州茅台', 'Kweichow Moutai'], ['300750.SZ', '寧德時代', 'CATL'], ['601318.SS', '中國平安 (A股)', 'Ping An (A)'],
  ['000858.SZ', '五糧液', 'Wuliangye'], ['600036.SS', '招商銀行', 'China Merchants Bank'], ['510300.SS', '滬深300 ETF', 'CSI 300 ETF']
];

const KR = [
  ['005930.KS', '三星電子', 'Samsung Electronics'], ['000660.KS', 'SK 海力士', 'SK Hynix'], ['005380.KS', '現代汽車', 'Hyundai Motor'],
  ['373220.KS', 'LG 新能源', 'LG Energy Solution'], ['035420.KS', 'Naver', 'Naver'], ['035720.KS', 'Kakao', 'Kakao']
];

const EU = [
  ['ASML.AS', '艾司摩爾', 'ASML'], ['SAP.DE', 'SAP', 'SAP'], ['SIE.DE', '西門子', 'Siemens'], ['ALV.DE', '安聯', 'Allianz'],
  ['BMW.DE', 'BMW', 'BMW'], ['MBG.DE', '賓士集團', 'Mercedes-Benz'], ['MC.PA', 'LVMH', 'LVMH'], ['RMS.PA', '愛馬仕', 'Hermès'],
  ['OR.PA', '萊雅', "L'Oréal"], ['AIR.PA', '空中巴士', 'Airbus'], ['TTE.PA', '道達爾能源', 'TotalEnergies'], ['RACE.MI', '法拉利', 'Ferrari'],
  ['ITX.MC', 'Inditex (Zara)', 'Inditex (Zara)'], ['NESN.SW', '雀巢', 'Nestlé'], ['UBSG.SW', '瑞銀', 'UBS'], ['NOVN.SW', '諾華', 'Novartis'],
  ['NOVO-B.CO', '諾和諾德', 'Novo Nordisk'], ['SHEL.L', '殼牌', 'Shell'], ['AZN.L', '阿斯特捷利康', 'AstraZeneca'], ['HSBA.L', '滙豐 (倫敦)', 'HSBC (London)'],
  ['ULVR.L', '聯合利華', 'Unilever'], ['RR.L', '勞斯萊斯', 'Rolls-Royce'], ['CSPX.L', '標普500 (倫敦 iShares)', 'iShares Core S&P 500 (London)'], ['VWRA.L', '全世界股票 (倫敦)', 'Vanguard FTSE All-World (London)']
];

const OTHER = [
  ['SHOP.TO', 'Shopify', 'Shopify'], ['RY.TO', '加拿大皇家銀行', 'Royal Bank of Canada'], ['BHP.AX', '必和必拓', 'BHP'],
  ['CBA.AX', '澳洲聯邦銀行', 'Commonwealth Bank'], ['D05.SI', '星展銀行', 'DBS'], ['RELIANCE.NS', '信實工業', 'Reliance Industries'],
  ['INFY.NS', '印孚瑟斯', 'Infosys'], ['TCS.NS', '塔塔諮詢', 'Tata Consultancy Services']
];

const FUNDS = [
  ['VFIAX', 'Vanguard 500 指數基金', 'Vanguard 500 Index Admiral'], ['VTSAX', 'Vanguard 全市場指數基金', 'Vanguard Total Stock Market Admiral'],
  ['VTIAX', 'Vanguard 國際股票指數基金', 'Vanguard Total International Admiral'], ['VBTLX', 'Vanguard 整體債券指數基金', 'Vanguard Total Bond Market Admiral'],
  ['FXAIX', '富達 500 指數基金', 'Fidelity 500 Index'], ['VWELX', 'Vanguard 威靈頓基金', 'Vanguard Wellington']
];

const CRYPTO = [
  ['BTC-USD', '比特幣', 'Bitcoin'], ['ETH-USD', '以太幣', 'Ethereum'], ['SOL-USD', 'Solana', 'Solana'], ['BNB-USD', '幣安幣', 'BNB'],
  ['XRP-USD', '瑞波幣', 'XRP'], ['DOGE-USD', '狗狗幣', 'Dogecoin'], ['ADA-USD', 'Cardano', 'Cardano'], ['TRX-USD', '波場', 'TRON'],
  ['AVAX-USD', 'Avalanche', 'Avalanche'], ['LINK-USD', 'Chainlink', 'Chainlink'], ['DOT-USD', 'Polkadot', 'Polkadot'],
  ['LTC-USD', '萊特幣', 'Litecoin'], ['BCH-USD', '比特幣現金', 'Bitcoin Cash'], ['SHIB-USD', '柴犬幣', 'Shiba Inu'],
  ['USDT-USD', '泰達幣 (穩定幣)', 'Tether (stablecoin)'], ['USDC-USD', 'USDC (穩定幣)', 'USD Coin (stablecoin)']
];

const METALS = [
  ['XAU', '黃金存摺', 'Gold passbook', 'metal'], ['XAG', '白銀存摺', 'Silver passbook', 'metal'],
  ['GLD', '黃金 ETF (SPDR)', 'SPDR Gold Shares'], ['SLV', '白銀 ETF', 'iShares Silver Trust'], ['USO', '原油 ETF', 'United States Oil Fund'],
  ['DBA', '農產品 ETF', 'Invesco DB Agriculture'], ['CPER', '銅 ETF', 'United States Copper Index'],
  ['GC=F', '黃金期貨', 'Gold futures'], ['SI=F', '白銀期貨', 'Silver futures'], ['CL=F', 'WTI 原油期貨', 'WTI crude futures'],
  ['BZ=F', '布蘭特原油期貨', 'Brent crude futures'], ['NG=F', '天然氣期貨', 'Natural gas futures'], ['HG=F', '銅期貨', 'Copper futures'],
  ['ZC=F', '玉米期貨', 'Corn futures'], ['ZW=F', '小麥期貨', 'Wheat futures'], ['KC=F', '咖啡期貨', 'Coffee futures']
];

// Currency pairs: the first currency priced in the second (EUR/USD: US$ per
// euro), traded in the second.
const FX = [
  ['USDTWD=X', '美元/新台幣', 'USD/TWD', 'fx'], ['JPYTWD=X', '日圓/新台幣', 'JPY/TWD', 'fx'], ['EURTWD=X', '歐元/新台幣', 'EUR/TWD', 'fx'],
  ['EURUSD=X', '歐元/美元', 'EUR/USD', 'fx'], ['USDJPY=X', '美元/日圓', 'USD/JPY', 'fx'], ['GBPUSD=X', '英鎊/美元', 'GBP/USD', 'fx'],
  ['AUDUSD=X', '澳幣/美元', 'AUD/USD', 'fx'], ['USDCAD=X', '美元/加幣', 'USD/CAD', 'fx'], ['USDCHF=X', '美元/瑞郎', 'USD/CHF', 'fx'],
  ['NZDUSD=X', '紐幣/美元', 'NZD/USD', 'fx'], ['USDCNY=X', '美元/人民幣', 'USD/CNY', 'fx'], ['USDHKD=X', '美元/港幣', 'USD/HKD', 'fx'],
  ['EURJPY=X', '歐元/日圓', 'EUR/JPY', 'fx'], ['GBPJPY=X', '英鎊/日圓', 'GBP/JPY', 'fx'], ['AUDJPY=X', '澳幣/日圓', 'AUD/JPY', 'fx'],
  ['EURGBP=X', '歐元/英鎊', 'EUR/GBP', 'fx'], ['USDKRW=X', '美元/韓元', 'USD/KRW', 'fx'], ['USDSGD=X', '美元/新加坡幣', 'USD/SGD', 'fx']
];

const GOV_BONDS = Object.values(BONDS).map(b => [b.id, bondName(b, 'zh'), bondName(b, 'en'), 'govbond']);

const INDEXES = [
  ['^TWII', '台灣加權指數', 'TAIEX'], ['^GSPC', '標普500', 'S&P 500'], ['^IXIC', '那斯達克', 'Nasdaq Composite'],
  ['^DJI', '道瓊工業', 'Dow Jones'], ['^SOX', '費城半導體', 'PHLX Semiconductor'], ['^RUT', '羅素2000', 'Russell 2000'], ['^VIX', 'VIX 恐慌指數', 'VIX'],
  ['^N225', '日經225', 'Nikkei 225'], ['^HSI', '恒生指數', 'Hang Seng'], ['000001.SS', '上證指數', 'Shanghai Composite'], ['^KS11', '韓國綜合', 'KOSPI'],
  ['^GDAXI', '德國DAX', 'DAX'], ['^FTSE', '英國富時100', 'FTSE 100'], ['^FCHI', '法國CAC 40', 'CAC 40'], ['^STOXX50E', '歐洲斯托克50', 'Euro Stoxx 50'],
  ['^BSESN', '印度孟買 Sensex', 'BSE Sensex'], ['^AXJO', '澳洲 ASX 200', 'ASX 200']
];

// Companies for the ticker mini game (games.mjs): [symbol, zh, en].
export const GAME_COMPANIES = [...TW, ...US, ...JP].filter(item => !item[3]);

export const CATEGORIES = [
  { id: 'tw', zh: '台股', en: 'Taiwan', icon: '🇹🇼', items: TW },
  { id: 'twetf', zh: '台灣 ETF', en: 'Taiwan ETFs', icon: '🧺', items: TW_ETF },
  { id: 'us', zh: '美股', en: 'US stocks', icon: '🇺🇸', items: US },
  { id: 'usetf', zh: '美國 ETF', en: 'US ETFs', icon: '📦', items: US_ETF },
  { id: 'govbond', zh: '公債', en: 'Government bonds', icon: '🏛️', items: GOV_BONDS },
  { id: 'bond', zh: '債券 ETF', en: 'Bond ETFs', icon: '📜', items: BOND_ETFS },
  { id: 'crypto', zh: '加密貨幣', en: 'Crypto', icon: '🪙', items: CRYPTO },
  { id: 'fx', zh: '外匯', en: 'Forex', icon: '💱', items: FX },
  { id: 'metal', zh: '黃金・原物料', en: 'Gold & commodities', icon: '🥇', items: METALS },
  { id: 'jp', zh: '日股', en: 'Japan', icon: '🇯🇵', items: JP },
  { id: 'hk', zh: '港股・陸股', en: 'HK & China', icon: '🇭🇰', items: HK_CN },
  { id: 'kr', zh: '韓股', en: 'Korea', icon: '🇰🇷', items: KR },
  { id: 'eu', zh: '歐股', en: 'Europe', icon: '🇪🇺', items: EU },
  { id: 'fund', zh: '共同基金', en: 'Mutual funds', icon: '🗂️', items: FUNDS },
  { id: 'other', zh: '其他市場', en: 'More markets', icon: '🌏', items: OTHER },
  { id: 'index', zh: '指數', en: 'Indexes', icon: '📈', items: INDEXES }
];

// The overview strip at the top of the markets tab.
export const OVERVIEW = ['^TWII', '^GSPC', '^IXIC', '^SOX', '^N225', '^HSI', 'BTC-USD', 'USDTWD=X', 'XAU', '^TNX'];

const INFO = new Map();
for (const c of CATEGORIES) for (const [symbol, zh, en, kind] of c.items) if (!INFO.has(symbol)) INFO.set(symbol, { symbol, zh, en, kind, category: c.id });

export const catalogInfo = symbol => INFO.get(symbol) || null;

// Watch-only things (indexes, futures) point to something that tracks them.
export const TRACKERS = {
  '^TWII': ['0050.TW', '006208.TW'], '^GSPC': ['VOO', 'SPY', '00646.TW'], '^IXIC': ['QQQ', '00662.TW'],
  '^DJI': ['DIA'], '^SOX': ['SOXX', '00830.TW'], '^RUT': ['IWM'], '^N225': ['1321.T', 'EWJ'], '^HSI': ['2800.HK'], '000001.SS': ['510300.SS'],
  '^KS11': ['005930.KS'], '^GDAXI': ['SAP.DE'], '^FTSE': ['SHEL.L'], '^STOXX50E': ['ASML.AS'], '^VIX': [], '^BSESN': ['RELIANCE.NS'], '^AXJO': ['BHP.AX'],
  '^IRX': ['UST-3M', 'SGOV'], '^FVX': ['UST-5Y', 'IEF'], '^TNX': ['UST-10Y', 'IEF', 'TLT'], '^TYX': ['UST-30Y', 'TLT', '00679B.TWO'],
  'GC=F': ['XAU', 'GLD', '00635U.TW'], 'SI=F': ['XAG', 'SLV'], 'CL=F': ['USO', '00642U.TW'], 'BZ=F': ['USO'], 'NG=F': [], 'HG=F': ['CPER'],
  'ZC=F': ['DBA'], 'ZW=F': ['DBA'], 'KC=F': ['DBA']
};

// Chinese or English names, symbols: every word of the query must match.
export function searchCatalog(query, limit = 30) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const info of INFO.values()) {
    const hay = `${info.symbol} ${info.symbol.replace(/\.[A-Z]+$|-USD$/, '')} ${info.zh} ${info.en}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    const bare = info.symbol.toLowerCase().replace(/\.[a-z]+$|-usd$/, '');
    const q = words.join(' ');
    const score = bare === q || info.symbol.toLowerCase() === q ? 0 : info.zh.toLowerCase().startsWith(q) || info.en.toLowerCase().startsWith(q) ? 1 : 2;
    scored.push([score, info]);
  }
  return scored.sort((a, b) => a[0] - b[0]).slice(0, limit).map(([, info]) => info);
}
