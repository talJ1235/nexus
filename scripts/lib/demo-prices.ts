// R19 — demo price files for the smoke / local server (synthetic, in the chains' real Cerberus layout, read by the real
// ingestion): the demo list's products at Shufersal (store 1) and Rami Levy (store 1) with a few deals, so rows show
// prices, deal lines, a product page and "where is my list cheapest". The barcodes are made up — never on prod.

// [gtin, name, manufacturer, quantity, unit, weighted, Shufersal price, Rami Levy price]
export const DEMO_PRODUCTS: [string, string, string, number, string, 0 | 1, number, number][] = [
  ["7290000066318", "חלב טרי 3% תנובה 1 ליטר", "תנובה", 1, "ליטר", 0, 6.9, 6.8],
  ["7290004131074", "חלב טרי 3% טרה 1 ליטר", "טרה", 1, "ליטר", 0, 6.7, 6.5],
  ["7290011194246", "חלב 1% יטבתה 1 ליטר", "יטבתה", 1, "ליטר", 0, 7.4, 7.2],
  ["8076800195057", "פסטה פנה ריגטה ברילה 500 גרם", "ברילה", 500, "גרם", 0, 7.5, 6.9],
  ["7290000068718", "פסטה פנה אסם 500 גרם", "אסם", 500, "גרם", 0, 5.9, 5.5],
  ["7290004127329", "קוטג' 5% תנובה 250 גרם", "תנובה", 250, "גרם", 0, 6.2, 5.9],
  ["7290000065373", "יוגורט 3% יופלה 200 גרם", "שטראוס", 200, "גרם", 0, 4.1, 3.9],
  ["7290000072753", "גבינה צהובה עמק 28% פרוסות 200 גרם", "תנובה", 200, "גרם", 0, 15.9, 14.9],
  ["7290000066097", "חומוס אחלה 400 גרם", "אחלה", 400, "גרם", 0, 10.5, 9.9],
  ["7290000065731", "ביצים L 12 יחידות", "ביצי הארץ", 12, "יחידות", 0, 14.5, 13.9],
  ["7290000176635", "אורז בסמטי סוגת 1 ק\"ג", "סוגת", 1, "קילוגרם", 0, 13.9, 12.9],
  ["7290000066899", "עגבניות מרוסקות פרי הארץ 400 גרם", "פרי הארץ", 400, "גרם", 0, 6.2, 5.9],
  ["7290000075785", "טחינה גולמית הר ברכה 500 גרם", "הר ברכה", 500, "גרם", 0, 19.9, 18.9],
  ["7290000065328", "קורנפלקס תלמה 750 גרם", "תלמה", 750, "גרם", 0, 18.9, 16.9],
  ["7290000068039", "קפה טורקי עלית 200 גרם", "שטראוס", 200, "גרם", 0, 26.9, 24.9],
  ["7290000066501", "מים מוגזים נביעות 6 יחידות", "נביעות", 6, "יחידות", 0, 16.9, 15.9],
  ["7290000065861", "סבון כלים פיירי 750 מ\"ל", "P&G", 750, "מיליליטר", 0, 10.9, 9.9],
  ["7290000068862", "שקיות אשפה 50 יחידות", "סנו", 50, "יחידות", 0, 12.9, 12.9],
  ["7290000066677", "משחת שיניים קולגייט 100 מ\"ל", "קולגייט", 100, "מיליליטר", 0, 12.9, 11.9],
  ["7290000068404", "פיתות אנג'ל 10 יחידות", "אנג'ל", 10, "יחידות", 0, 9.9, 9.0],
  ["7290000076911", "אפונה קפואה סנפרוסט 800 גרם", "סנפרוסט", 800, "גרם", 0, 13.9, 12.9],
  ["7290000066998", "פרמזן מגורר 100 גרם", "גד", 100, "גרם", 0, 14.9, 13.9],
  ["7290000067001", "נייר טואלט לילי 32 גלילים", "שניב", 32, "יחידות", 0, 42.9, 39.9],
  // Worst case for the layout guards: a very long name and a four-digit price.
  ["7290000099999", "מכונת אספרסו אוטומטית מקצועית עם מקציף חלב מובנה ומטחנה קרמית שקטה במיוחד 15 בר", "דלונגי ישראל", 1, "יחידות", 0, 1234.9, 1299.9],
  ["116", "עגבניות", "", 1, "קילוגרם", 1, 8.9, 7.9],
  ["117", "מלפפונים", "", 1, "קילוגרם", 1, 7.5, 6.9],
  ["118", "בננות", "", 1, "קילוגרם", 1, 7.9, 6.9],
  ["119", "לימונים", "", 1, "קילוגרם", 1, 9.9, 8.9],
  ["120", "פטרוזיליה", "", 1, "יחידות", 0, 4.9, 4.5],
  ["121", "חזה עוף טרי", "", 1, "קילוגרם", 1, 46.9, 44.9],
];

// [chain, promotion id, description, min qty, discounted price, gtins, club]
const PROMOS: ["SHUFERSAL" | "RAMI_LEVY", string, string, number, number, string[], 0 | 1][] = [
  ["SHUFERSAL", "9001", "פסטה ברילה 2 ב-10", 2, 10, ["8076800195057"], 0],
  ["SHUFERSAL", "9002", "יוגורט יופלה 4 ב-12", 4, 12, ["7290000065373"], 0],
  ["RAMI_LEVY", "9101", "קוטג' 5% 3 ב-15", 3, 15, ["7290004127329"], 0],
  ["RAMI_LEVY", "9102", "חומוס אחלה ב-8.90 למועדון", 1, 8.9, ["7290000066097"], 1],
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function demoPriceFull(chain: "SHUFERSAL" | "RAMI_LEVY", now: Date) {
  const id = chain === "SHUFERSAL" ? "7290027600007" : "7290058140886";
  const store = chain === "SHUFERSAL" ? 1 : 1;
  const at = now.toISOString().slice(0, 19);
  const items = DEMO_PRODUCTS.map(
    ([g, name, man, q, u, w, sh, rl]) =>
      `<Item><PriceUpdateTime>${at}</PriceUpdateTime><ItemCode>${g}</ItemCode><ItemType>${g.length < 8 ? 0 : 1}</ItemType><ItemName>${esc(name)}</ItemName><ManufacturerName>${esc(man)}</ManufacturerName><Quantity>${q}</Quantity><UnitOfMeasure>${u}</UnitOfMeasure><bIsWeighted>${w}</bIsWeighted><ItemPrice>${(chain === "SHUFERSAL" ? sh : rl).toFixed(2)}</ItemPrice><UnitOfMeasurePrice>0</UnitOfMeasurePrice></Item>`,
  ).join("");
  return `<?xml version="1.0" encoding="utf-8"?><Root><ChainID>${id}</ChainID><SubChainID>001</SubChainID><StoreID>${String(store).padStart(3, "0")}</StoreID><Items>${items}</Items></Root>`;
}

export function demoPromoFull(chain: "SHUFERSAL" | "RAMI_LEVY", now: Date) {
  const id = chain === "SHUFERSAL" ? "7290027600007" : "7290058140886";
  const start = new Date(now.getTime() - 3 * 86_400_000).toISOString().slice(0, 10);
  const end = new Date(now.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
  const promos = PROMOS.filter((p) => p[0] === chain)
    .map(
      ([, pid, desc, min, price, gtins, club]) =>
        `<Promotion><PromotionID>${pid}</PromotionID><PromotionDescription>${esc(desc)}</PromotionDescription><PromotionUpdateTime>${start}T00:00:00</PromotionUpdateTime><PromotionStartDateTime>${start}T00:00:00</PromotionStartDateTime><PromotionEndDateTime>${end}T23:59:00</PromotionEndDateTime><RewardType>1</RewardType><ClubID>${club ? 3 : 0}</ClubID><Groups><Group><PromotionItems>${gtins
          .map((g) => `<PromotionItem><ItemCode>${g}</ItemCode><MinQty>${min}</MinQty><DiscountedPrice>${price}</DiscountedPrice><bIsWeighted>0</bIsWeighted></PromotionItem>`)
          .join("")}</PromotionItems></Group></Groups></Promotion>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?><Root><ChainID>${id}</ChainID><SubChainID>001</SubChainID><StoreID>001</StoreID><Promotions>${promos}</Promotions></Root>`;
}
