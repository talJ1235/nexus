// Unit test for src/lib/grocery/trip-look.ts (R18 S5 B2): every colour × style × light / dark gives text that reaches
// 4.5:1 on the screen's colour, Auto follows the store, picks parse safely, per-store wins over all-stores.
//   npm run test:trip-look
import assert from "node:assert/strict";
import { contrast, hexToRgb, lookFor, mix, parseLook, safeOn, TRIP_COLOR_KEYS, TRIP_COLORS, TRIP_LOOK_KEY, TRIP_STYLES, tripColor, tripLookKey } from "../src/lib/grocery/trip-look";
import { MONO_HEX } from "../src/lib/grocery/chains";

const WHITE = hexToRgb("#ffffff");
const INK_LIGHT = hexToRgb("#171717");
const INK_DARK = hexToRgb("#f2f2f0");
const SCREEN_LIGHT = hexToRgb("#ecebe6");
const SCREEN_DARK = hexToRgb("#0e0e0e");
const NIGHT = hexToRgb("#0c0c0c");

const storeColours = Object.values(MONO_HEX);
const colours: (keyof typeof TRIP_COLORS | "auto")[] = ["auto", ...TRIP_COLOR_KEYS];
let checked = 0;
for (const color of colours)
  for (const store of color === "auto" ? [...storeColours, null] : [null])
    for (const style of TRIP_STYLES)
      for (const dark of [false, true]) {
        const { accent } = tripColor({ color, style }, store, dark);
        const a = hexToRgb(accent);
        const what = `${color}${store ? `(${store})` : ""} · ${style} · ${dark ? "dark" : "light"}`;
        // Vivid: white text on the colour; the "Let's go" arrow chip and Night's glow use the same safe colour.
        assert.ok(contrast(a, WHITE) >= 4.5, `${what}: white on ${accent} = ${contrast(a, WHITE).toFixed(2)}`);
        // Soft: ink text on the pale tint (9 % of the colour over the screen).
        if (style === "soft") {
          const bg = mix(hexToRgb(TRIP_COLORS[color === "auto" ? "ink" : color]), dark ? SCREEN_DARK : SCREEN_LIGHT, 0.09);
          assert.ok(contrast(bg, dark ? INK_DARK : INK_LIGHT) >= 4.5, `${what}: ink on the soft tint`);
        }
        // Night: white text over the darkest-to-brightest point of the glow (55 % colour over near-black).
        if (style === "night") assert.ok(contrast(mix(a, NIGHT, 0.55), WHITE) >= 4.5, `${what}: white on the night glow`);
        checked++;
      }
assert.ok(checked >= 9 * 3 * 2, `checked ${checked} combinations`);

// Already safe colours are left alone; a light one is darkened, never lightened.
assert.equal(safeOn("#2a2a2a"), "#2a2a2a");
const light = safeOn("#ffd60a");
assert.ok(contrast(hexToRgb(light), WHITE) >= 4.5 && light !== "#ffd60a", "a yellow is darkened until white reads on it");
// Dark + Vivid mixes 62 % of the colour with black (the board) — darker than light mode's.
const lightRed = hexToRgb(tripColor({ color: "red", style: "vivid" }, null, false).accent);
const darkRed = hexToRgb(tripColor({ color: "red", style: "vivid" }, null, true).accent);
assert.ok(darkRed[0] < lightRed[0], "dark + Vivid is darker");

// Picks: junk → null, unknown parts → defaults; per-store beats all-stores beats Auto · Vivid.
assert.equal(parseLook("not json"), null);
assert.deepEqual(parseLook(JSON.stringify({ color: "gold", style: "neon" })), { color: "auto", style: "vivid" });
assert.deepEqual(lookFor({}, "shufersal|Herzl"), { color: "auto", style: "vivid", perStore: true });
const looks = { [TRIP_LOOK_KEY]: JSON.stringify({ color: "blue", style: "soft" }), [tripLookKey("shufersal|Herzl")]: JSON.stringify({ color: "pink", style: "night" }) };
assert.deepEqual(lookFor(looks, "shufersal|Herzl"), { color: "pink", style: "night", perStore: true });
assert.deepEqual(lookFor(looks, "rami-levy|"), { color: "blue", style: "soft", perStore: false });

console.log(`OK trip look: ${checked} colour × style × theme combinations reach 4.5:1`);
