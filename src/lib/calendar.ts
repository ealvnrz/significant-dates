// Shared by the static page, browser and maintenance tools. Dates are calendar days in UTC.
export const DEADLINE_TYPES = ['submission', 'registration', 'proposal', 'funding', 'housing', 'other'] as const;
export type DeadlineType = (typeof DEADLINE_TYPES)[number];
export const DEADLINE_LABELS: Record<DeadlineType, string> = {
  submission: 'Paper / abstract submission', registration: 'Registration', proposal: 'Session / workshop proposal',
  funding: 'Funding / awards', housing: 'Housing / cancellation', other: 'Other',
};
export const DEADLINE_STATUSES = ['unknown', 'not-announced', 'published'] as const;
export type DeadlineStatus = (typeof DEADLINE_STATUSES)[number];
export type Deadline = { label: string; date: string; types: readonly DeadlineType[]; tentative?: boolean };
export type MonthRange = { from: string; to: string } | null;
export type MonthMode = 'conference' | 'deadline';
export const REVIEW_POLICY = { staleDays: 120, soonDays: 14, urgentReviewDays: 7 } as const;
const DAY = 86_400_000;

export const calendarDay = (now = new Date()) => now.toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
export const isUpcoming = (end: string, today: string) => end >= today;

export function openDeadlines(deadlines: readonly Deadline[], today: string, type: DeadlineType | '' = '') {
  return deadlines.filter(d => d.date >= today && (!type || d.types.includes(type)))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function deadlineSummary(deadlines: readonly Deadline[], status: DeadlineStatus, today: string, type: DeadlineType | '' = '') {
  const selected = deadlines.filter(d => !type || d.types.includes(type));
  if (openDeadlines(selected, today).length) return 'Open deadlines';
  if (selected.length) return 'Recorded deadlines closed';
  if (type && deadlines.length) return 'No deadlines of this type recorded';
  return status === 'not-announced' ? 'Dates not yet announced' : 'No deadline information recorded';
}

/** Every month touched by an inclusive conference interval. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  for (let guard = 0; guard < 240; guard++) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month > last) break;
    out.push(month);
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return out;
}

export function matchingMonths(start: string, end: string, deadlines: readonly Deadline[], today: string, mode: MonthMode, type: DeadlineType | '' = '') {
  if (mode === 'deadline') return [...new Set(openDeadlines(deadlines, today, type).map(d => d.date.slice(0, 7)))];
  return monthsBetween((start < today ? today : start).slice(0, 7), end.slice(0, 7));
}

export function matchesMonths(months: readonly string[], range: MonthRange) {
  return !range || months.some(m => m >= range.from && m <= range.to);
}

/** Flag old evidence sooner when a recorded deadline is approaching. Never changes `checked`. */
export function reviewDue(checked: string | null | undefined, deadlines: readonly Deadline[], today: string) {
  if (!checked) return true;
  const urgent = openDeadlines(deadlines, today).some(d => daysBetween(today, d.date) <= REVIEW_POLICY.soonDays);
  return daysBetween(checked, today) > (urgent ? REVIEW_POLICY.urgentReviewDays : REVIEW_POLICY.staleDays);
}

export function deadlineState(date: string, today: string) {
  const days = daysBetween(today, date);
  return days < 0 ? 'closed' : days <= REVIEW_POLICY.soonDays ? 'soon' : 'open';
}

export function deadlineCountdown(date: string, today: string) {
  const days = daysBetween(today, date);
  return days < 0 ? 'Closed' : days === 0 ? 'Today — check closing time' : `${days} ${days === 1 ? 'day' : 'days'} left`;
}
