import type { BridgeOrganizationSuggestionSummary } from "./types";

/** A filename/path filter must only match this recommendation's own file.
 * Related-file names in explanations and provenance are deliberately excluded. */
export function recommendationPathSearchMatches(
  suggestion: Pick<BridgeOrganizationSuggestionSummary,
    "currentRelativePath" | "proposedRelativePath" | "proposedFileName">,
  rawQuery: string,
) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;
  return [suggestion.currentRelativePath, suggestion.proposedRelativePath,
    suggestion.proposedFileName].some((value) =>
      typeof value === "string" && value.toLowerCase().includes(query));
}
