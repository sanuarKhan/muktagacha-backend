// Masks a person's display name for privacy inside private 1:1 chat
// threads (buyer<->vendor conversations and customer<->customer direct
// messages) - NOT used on public surfaces like Q&A or community posts,
// where a name attached to a public statement is expected and fine.
//
// Rule: keep the first and last letter, replace everything in between
// with asterisks - e.g. "Karim Ahmed" -> "K****d" (spaces collapsed,
// single continuous mask across the full name, not per-word) matching
// what the client asked for literally ("first and last letter, asterisk
// in between"). Short names (<=2 chars) are masked entirely since there's
// no safe "middle" to hide.
export function maskName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? '').trim();
  if (trimmed.length === 0) return 'Someone';
  if (trimmed.length <= 2) return '*'.repeat(trimmed.length);
  return trimmed[0] + '*'.repeat(trimmed.length - 2) + trimmed[trimmed.length - 1];
}
