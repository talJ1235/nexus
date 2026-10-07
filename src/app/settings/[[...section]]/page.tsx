// R16 D1: deep links into Settings (/settings, /settings/display, /settings/people, …). The same app as "/"; the
// settings shell reads the section from the URL and opens over it (the old /settings/security and /settings/invites
// pages are sections now: Account & security, Account → Invite codes).
export { default } from "../../page";

export const maxDuration = 60;
