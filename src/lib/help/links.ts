// Action buttons in assistant answers (Round 8 D2): the model writes `[label](nexus:<action>)`; only whitelisted
// actions become buttons, anything else stays plain text. Pure (used by the answer renderer and the unit test).

export const NEXUS_ACTIONS = [
  "settings",
  "palette/graphite",
  "palette/plum",
  "theme/light",
  "theme/dark",
  "theme/system",
  "extension",
  "alerts",
  "receipt",
  "barcode",
  "shop",
  "import",
  "plan",
  "commands",
  "report",
  "view/to_buy",
  "view/urgent",
  "view/unsorted",
  "view/ordered",
  "view/history",
  "view/orders",
  "view/spending",
  "view/projects",
] as const;
export type NexusAction = (typeof NEXUS_ACTIONS)[number];

export const isNexusAction = (a: string): a is NexusAction => (NEXUS_ACTIONS as readonly string[]).includes(a);

const LINK = /\[([^\]\n]{1,80})\]\(nexus:([a-z_/]{3,40})\)/g;
const HAS_LINK = /\[[^\]\n]{1,80}\]\(nexus:[a-z_/]{3,40}\)/;

/**
 * Pull the action links out of an answer: valid ones become buttons (max 3, deduped) and leave their label in the
 * text only when they sat inside a sentence; lines that were only links disappear. Unknown actions → plain label.
 */
export function extractActions(text: string): { text: string; actions: { label: string; action: NexusAction }[] } {
  const actions: { label: string; action: NexusAction }[] = [];
  const lines = text.split("\n").flatMap((line) => {
    const onlyLinks = line.replace(LINK, "").replace(/^[\s\-*•]+|[\s.·]+$/g, "") === "";
    const out = line.replace(LINK, (_m, label: string, action: string) => {
      if (isNexusAction(action) && actions.length < 3 && !actions.some((a) => a.action === action)) actions.push({ label: label.trim(), action });
      return label;
    });
    return onlyLinks && HAS_LINK.test(line) ? [] : [out];
  });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), actions };
}
