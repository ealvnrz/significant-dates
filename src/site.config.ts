// Site-wide settings that aren't part of the conference data.

export const SITE = {
  name: 'Significant Dates',
  tagline: 'Statistics conferences worldwide',
  description:
    'Upcoming statistics and probability conferences around the world, with their submission deadlines, checked against the official sites.',
  /**
   * GitHub repository ("owner/name"). Suggestions and corrections are GitHub issues, opened with
   * the forms in .github/ISSUE_TEMPLATE. While it's empty, the buttons only show in `npm run dev`.
   */
  repo: '',
  /** Days after `checked` before an entry's dates are flagged as possibly out of date. */
  staleAfterDays: 120,
};

/** Link to a new GitHub issue using one of the forms in .github/ISSUE_TEMPLATE, with fields prefilled. */
export function issueUrl(template: 'new-conference.yml' | 'correction.yml', fields: Record<string, string> = {}): string | null {
  const repo = SITE.repo || (import.meta.env.DEV ? 'OWNER/REPO' : '');
  if (!repo) return null;
  return `https://github.com/${repo}/issues/new?${new URLSearchParams({ template, ...fields })}`;
}
