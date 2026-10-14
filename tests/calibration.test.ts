import { describe, expect, it } from 'vitest';
import { calibrate, daysSinceCheckIn, expectedToday, plannedFrom } from '../src/lib/calibration';
import type { Balance } from '../src/lib/types';

const snap = (id: number, date: string, balance: number, contributed: number | null = null): Balance => ({
  id, accountId: 'a', date, balance, contributed, note: '',
});

describe('calibration', () => {
  it('needs two snapshots', () => {
    expect(calibrate({ monthlyContribution: 100, expectedReturnPct: 5, closed: false }, [snap(1, '2026-01-01', 1000)])).toBeNull();
  });

  it('matches the plan when the balance followed it exactly', () => {
    const account = { monthlyContribution: 100, expectedReturnPct: 6, closed: false };
    const after = plannedFrom(1000, account, 12).balance;
    const result = calibrate(account, [snap(1, '2026-01-01', 1000), snap(2, '2027-01-01', after)]);
    expect(result?.varianceTotal).toBeCloseTo(0, 0);
    expect(result?.realisedReturnPct).toBeCloseTo(6, 0);
    expect(result?.suggestedReturnPct).toBeNull();
  });

  it('separates paying in less from a weaker market', () => {
    const account = { monthlyContribution: 500, expectedReturnPct: 0, closed: false };
    // Plan: 6000 paid in over 12 months. Actually 3000 paid in, and the balance only grew by that.
    const result = calibrate(account, [snap(1, '2026-01-01', 10000), snap(2, '2027-01-01', 13000, 3000)]);
    expect(result?.plannedBalance).toBeCloseTo(16000, 0);
    expect(result?.contributionGap).toBeCloseTo(-3000, 0);
    expect(result?.returnGap).toBeCloseTo(0, 0);
    expect(result?.realisedReturnPct).toBeCloseTo(0, 6);
  });

  it('suggests the realised return once there are six months of history', () => {
    const account = { monthlyContribution: 0, expectedReturnPct: 7, closed: false };
    const short = calibrate(account, [snap(1, '2026-01-01', 1000), snap(2, '2026-03-01', 1003)]);
    expect(short?.suggestedReturnPct).toBeNull();
    const long = calibrate(account, [snap(1, '2026-01-01', 1000), snap(2, '2027-01-01', 1030, 0)]);
    expect(long?.realisedReturnPct).toBeCloseTo(3, 0);
    expect(long?.suggestedReturnPct).toBeCloseTo(3, 0);
  });

  it('does not suggest a return when what was paid in had to be assumed', () => {
    const account = { monthlyContribution: 500, expectedReturnPct: 4, closed: false };
    const guessed = calibrate(account, [snap(1, '2022-03-01', 12000), snap(2, '2026-10-13', 38000)]);
    expect(guessed?.assumedFlows).toBe(true);
    expect(guessed?.realisedReturnPct).toBeLessThan(0);
    expect(guessed?.suggestedReturnPct).toBeNull();
    const recorded = calibrate(account, [snap(1, '2022-03-01', 12000), snap(2, '2026-10-13', 38000, 20000)]);
    expect(recorded?.assumedFlows).toBe(false);
    expect(recorded?.realisedReturnPct).toBeGreaterThan(4);
  });

  it('chains several periods', () => {
    const account = { monthlyContribution: 0, expectedReturnPct: 0, closed: false };
    const result = calibrate(account, [snap(1, '2026-01-01', 1000), snap(2, '2026-07-01', 1100), snap(3, '2027-01-01', 1210)]);
    expect(result?.realisedReturnPct).toBeCloseTo(21, 0);
  });

  it('projects today from the latest snapshot and counts days since a check-in', () => {
    const today = expectedToday({ monthlyContribution: 100, expectedReturnPct: 0, closed: false }, snap(1, '2026-01-01', 1000), '2026-04-01');
    expect(today?.balance).toBeCloseTo(1000 + 100 * (today?.months ?? 0), 6);
    expect(daysSinceCheckIn([snap(1, '2026-01-01', 1)], new Set(['a']), '2026-01-31')).toBe(30);
    expect(daysSinceCheckIn([], new Set(['a']), '2026-01-31')).toBeNull();
  });
});
