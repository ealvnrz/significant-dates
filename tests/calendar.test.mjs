import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDay, isUpcoming, openDeadlines, deadlineSummary, matchingMonths, matchesMonths, deadlineCountdown, reviewDue, daysBetween } from '../src/lib/calendar.ts';

const submission = { label: 'Abstract submission', date: '2026-09-08', types: ['submission'] };
const registration = { label: 'Early-bird registration', date: '2026-11-10', types: ['registration'] };
const today = '2026-10-05';

test('a remaining registration deadline does not imply submissions are open', () => {
  assert.equal(openDeadlines([submission, registration], today, 'submission').length, 0);
  assert.deepEqual(openDeadlines([submission, registration], today, 'registration'), [registration]);
  assert.equal(deadlineSummary([submission, registration], 'published', today, 'submission'), 'Recorded deadlines closed');
});
test('unknown, unannounced and closed records have distinct summaries', () => {
  assert.equal(deadlineSummary([], 'unknown', today), 'No deadline information recorded');
  assert.equal(deadlineSummary([], 'not-announced', today), 'Dates not yet announced');
  assert.equal(deadlineSummary([submission], 'published', today), 'Recorded deadlines closed');
  assert.equal(deadlineSummary([registration], 'published', today, 'submission'), 'No deadlines of this type recorded');
});
test('combined deadlines participate in both categories, without double counting', () => {
  const both = { ...registration, types: ['submission', 'registration'] };
  assert.equal(openDeadlines([both], today).length, 1);
  assert.equal(openDeadlines([both], today, 'submission').length, 1);
  assert.equal(openDeadlines([both], today, 'registration').length, 1);
});
test('next deadline is chronological even when the YAML is not ordered', () => {
  const early = { ...registration, date: '2026-10-06' };
  assert.equal(openDeadlines([registration, early, submission], today)[0], early);
});
test('a June-July conference is found in either month', () => {
  const months = matchingMonths('2027-06-28', '2027-07-02', [], today, 'conference');
  assert.deepEqual(months, ['2027-06', '2027-07']);
  assert.equal(matchesMonths(months, { from: '2027-07', to: '2027-07' }), true);
  assert.equal(matchesMonths(months, { from: '2027-08', to: '2027-08' }), false);
});
test('deadline months use the selected type and only open dates', () => {
  const ds = [submission, registration, { ...registration, date: '2026-11-15' }];
  assert.deepEqual(matchingMonths('2027-03-01', '2027-03-05', ds, today, 'deadline'), ['2026-11']);
  assert.deepEqual(matchingMonths('2027-03-01', '2027-03-05', ds, today, 'deadline', 'submission'), []);
});
test('UTC day is independent of local offset, including Santiago midnight boundaries', () => {
  assert.equal(calendarDay(new Date('2026-10-04T21:30:00-03:00')), '2026-10-05');
  assert.equal(calendarDay(new Date('2026-10-05T09:30:00+09:00')), '2026-10-05');
  assert.equal(daysBetween('2026-09-05', '2026-09-07'), 2);
});
test('conference end dates and deadline dates are inclusive, then expire on the next UTC day', () => {
  assert.equal(isUpcoming('2026-10-05', today), true);
  assert.equal(isUpcoming('2026-10-04', today), false);
  assert.equal(isUpcoming('2026-10-05', '2026-10-06'), false);
  // The same classifier also restores a row if it was built for a later day.
  assert.equal(isUpcoming('2026-10-04', '2026-10-04'), true);
  assert.equal(openDeadlines([{ ...submission, date: today }], today).length, 1);
  assert.equal(deadlineCountdown(today, today), 'Today — check closing time');
});
test('ongoing conferences include the current month; year and leap boundaries remain inclusive', () => {
  assert.deepEqual(matchingMonths('2026-09-29', '2026-10-06', [], today, 'conference'), ['2026-10']);
  assert.deepEqual(matchingMonths('2027-12-30', '2028-01-02', [], today, 'conference'), ['2027-12', '2028-01']);
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
});
test('near deadlines trigger editorial review after seven days instead of 120', () => {
  const soon = [{ ...registration, date: '2026-10-10' }];
  assert.equal(reviewDue('2026-09-27', soon, today), true);
  assert.equal(reviewDue('2026-09-28', soon, today), false);
  assert.equal(reviewDue('2026-09-27', [registration], today), false);
  assert.equal(reviewDue('2026-01-01', [], today), true);
  assert.equal(reviewDue(null, [], today), true);
});
