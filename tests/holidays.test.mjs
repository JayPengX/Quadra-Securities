import test from 'node:test';
import assert from 'node:assert/strict';
import { easter, isHoliday, isTradingDay, upcomingHolidays, nextTradingStart } from '../public/lib/holidays.mjs';

test('Easter and the calendars built on it', () => {
  assert.deepEqual(easter(2026), [2026, 4, 5]);
  assert.deepEqual(easter(2027), [2027, 3, 28]);
  assert.ok(isHoliday('US', '2026-04-03')); // Good Friday
  assert.ok(isHoliday('UK', '2026-04-06')); // Easter Monday
  assert.ok(isHoliday('DK', '2026-05-15')); // the day after Ascension
});

test('US rules, with weekend observance', () => {
  for (const d of ['2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25', '2027-07-05', '2027-12-24'])
    assert.ok(isHoliday('US', d), d);
  assert.ok(!isHoliday('US', '2027-12-31')); // New Year 2028 on a Saturday: not made up
  assert.ok(isTradingDay('US', '2026-09-28'));
});

test('Japan: substitute and bridge days', () => {
  assert.ok(isHoliday('JP', '2026-09-21'));
  assert.ok(isHoliday('JP', '2026-09-22')); // between two holidays
  assert.ok(isHoliday('JP', '2026-09-23'));
  assert.ok(isHoliday('JP', '2026-05-06')); // May 3 on a Sunday
  assert.ok(isHoliday('JP', '2026-12-31'));
});

test('Taiwan and the next opening', () => {
  assert.ok(isHoliday('TW', '2026-09-28'));
  assert.deepEqual(upcomingHolidays('TW', '2026-09-26', 3), ['2026-09-28', '2026-10-09', '2026-10-26']);
  // Friday 25 Sep 2026 09:00 Taipei (Mid-Autumn): next open is Tuesday the 29th.
  const start = Date.parse('2026-09-25T01:00:00Z');
  assert.equal(new Date(nextTradingStart('TW', start, 'Asia/Taipei', Date.parse('2026-09-26T00:00:00Z'))).toISOString(), '2026-09-29T01:00:00.000Z');
  // Markets with no calendar: weekdays only.
  assert.ok(isTradingDay('INTL', '2026-12-25'));
});
