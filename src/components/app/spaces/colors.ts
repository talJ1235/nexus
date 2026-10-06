// R15 C1: space tile colours (6) and avatar colours (picked from the user id) — no imports, so the public /join page
// can use them without the app store.

export const TILE: Record<string, string> = {
  green: "#22936c",
  blue: "#3172d4",
  violet: "#7c5ad9",
  amber: "#c58a12",
  rose: "#c94673",
  slate: "#6b6a66",
};
/** Older rows (personal spaces from the migration) say "plum". */
export const tileColor = (c: string | null | undefined) => TILE[c ?? ""] ?? (c === "plum" ? TILE.violet : TILE.slate);

const AV = ["#e8743b", "#7c5ad9", "#3172d4", "#22936c", "#c58a12", "#c94673"];
export function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AV[h % AV.length];
}
