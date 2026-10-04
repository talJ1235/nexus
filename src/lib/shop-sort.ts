// Phone Shopping tab sort (Round 13 B2), per device: To buy "By project" / On the way "By arrival", or the plain sort.
const SHOP_SORT_KEY = "nexus.shopSort";
export type ShopSort = { buy: "project" | "plain"; way: "arrival" | "plain" };
export const DEFAULT_SHOP_SORT: ShopSort = { buy: "project", way: "arrival" };

export function readShopSort(): ShopSort {
  try {
    const v = JSON.parse(localStorage.getItem(SHOP_SORT_KEY) ?? "{}");
    return { buy: v.buy === "plain" ? "plain" : "project", way: v.way === "plain" ? "plain" : "arrival" };
  } catch {
    return DEFAULT_SHOP_SORT;
  }
}

export function saveShopSort(v: ShopSort) {
  try {
    localStorage.setItem(SHOP_SORT_KEY, JSON.stringify(v));
  } catch {}
}
