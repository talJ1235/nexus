// R18 S5 F4 — "Food at home": suggestions never propose what contradicts the home's choices. Vegan → no meat / fish /
// dairy / eggs / honey; vegetarian → no meat / fish; gluten-free, lactose-free, nut allergy → the product types that
// carry them are off. Kosher / mehadrin / organic are noted on the space only (the product data can't tell yet).
// Client-safe; keys are the dictionary's product types (lib/grocery/dictionary.ts). Unit test: scripts/test-diet.ts.

import type { Diet } from "../onboarding";
import { TYPE_BY_KEY } from "./dictionary";

const MEAT = new Set(["beef", "beef-steak", "burgers", "chicken-breast", "chicken-drumsticks", "chicken-thighs", "chicken-wings", "ground-beef", "kebab", "turkey-breast", "whole-chicken", "hot-dogs", "salami", "sliced-turkey", "frozen-schnitzel"]);
const FISH = new Set(["salmon", "white-fish", "herring", "smoked-salmon", "tuna", "frozen-fish"]);
const DAIRY = new Set(["butter", "chocolate-milk", "cottage", "cream", "cream-cheese", "feta", "labneh", "leben", "milk", "mozzarella", "parmesan", "pudding", "sour-cream", "white-cheese", "yellow-cheese", "yogurt", "ice-cream", "frozen-pizza", "frozen-burekas"]);
const EGGS = new Set(["eggs"]);
const OTHER_ANIMAL = new Set(["honey"]);
const GLUTEN = new Set(["bagels", "baguette", "bread", "cake", "challah", "pastries", "pita", "rolls", "rugelach", "tortillas", "bulgur", "couscous", "noodles", "pasta", "ptitim", "spaghetti", "cornflakes", "granola", "oats", "cookies", "crackers", "pretzels", "wafers", "bissli", "frozen-burekas", "frozen-pizza", "frozen-schnitzel", "puff-pastry", "energy-bars"]);
const LACTOSE = new Set([...DAIRY].filter((k) => k !== "butter"));
const NUTS = new Set(["nuts", "peanut-butter", "peanut-puffs", "halva", "chocolate-spread", "energy-bars"]);

/** Which choices a product type goes against (empty = fine for this home). */
export function dietConflicts(productKey: string, diet: readonly Diet[] | undefined): Diet[] {
  if (!diet?.length) return [];
  const k = productKey;
  const out: Diet[] = [];
  if (diet.includes("vegan") && (MEAT.has(k) || FISH.has(k) || DAIRY.has(k) || EGGS.has(k) || OTHER_ANIMAL.has(k))) out.push("vegan");
  if (diet.includes("vegetarian") && (MEAT.has(k) || FISH.has(k))) out.push("vegetarian");
  if (diet.includes("gluten") && GLUTEN.has(k)) out.push("gluten");
  if (diet.includes("lactose") && LACTOSE.has(k)) out.push("lactose");
  if (diet.includes("nuts") && NUTS.has(k)) out.push("nuts");
  return out;
}

/** Suggestions / basket rows this home can have (unknown product keys pass — nothing to say about them). */
export function dietAllows(productKey: string, diet: readonly Diet[] | undefined) {
  if (!diet?.length) return true;
  if (!TYPE_BY_KEY.has(productKey) && !MEAT.has(productKey) && !DAIRY.has(productKey)) return true;
  return dietConflicts(productKey, diet).length === 0;
}
