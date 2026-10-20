// The recommendation review field is deliberately a source filename/path
// search. Supporting citations, alternative destinations and other clients'
// filenames must never cause unrelated recommendations to appear.
export function recommendationMatchesOwnFilePath(
  suggestion: { currentRelativePath: string },
  searchQuery: string,
) {
  const query = searchQuery.trim().toLowerCase();
  return !query || suggestion.currentRelativePath.toLowerCase().includes(query);
}
