import { describe, expect, it } from 'vitest';
import { balanceSplit, carryPortion, solveMonthlyReturn } from '../src/lib/portion';
import type { Balance } from '../src/lib/types';

const snap = (id: number, date: string, balance: number, contributed: number | null = null): Balance => ({
  id, accountId: 'etf', date, balance, contributed, note: '',
});

const etf = {
  id: 'etf',
  owner: 'joint' as const,
  ownerShare: 0.5,
  portionDate: '2022-03-01',
  portionSelf: 12000,
  monthlyContribution: 500,
};

describe('portion of a joint account', () => {
  it('finds the steady monthly return that links two balances', () => {
    const g = solveMonthlyReturn(1000, 100, 12, 1000 * 1.01 ** 12 + 100 * ((1.01 ** 12 - 1) / 0.01));
    expect(g).toBeCloseTo(0.01, 6);
  });

  it('with no growth, your part is your start plus your half of what went in', () => {
    const self = carryPortion({ start: 12000, end: 12000 + 24000, selfStart: 12000, paidIn: 24000, months: 48, contributionShare: 0.5 });
    expect(self).toBeCloseTo(12000 + 12000, 6);
  });

  it('gives your earlier money its own growth, so your share is above what you paid in', () => {
    const split = balanceSplit(etf, [snap(1, '2022-03-01', 12000), snap(2, '2026-03-01', 40000, 24000)]);
    expect(split.anchored).toBe(true);
    const byMoneyIn = (12000 + 12000) / (12000 + 24000);
    expect(split.share).toBeGreaterThan(byMoneyIn);
    expect(split.selfAmount + split.partnerAmount).toBeCloseTo(40000, 6);
  });

  it('assumes the monthly contribution when a snapshot does not say what was paid in', () => {
    const recorded = balanceSplit(etf, [snap(1, '2022-03-01', 12000), snap(2, '2026-03-01', 40000, 24000)]);
    const assumed = balanceSplit(etf, [snap(1, '2022-03-01', 12000), snap(2, '2026-03-01', 40000)]);
    expect(assumed.share).toBeCloseTo(recorded.share, 9);
  });

  it('chains several check-ins and ignores snapshots before the portion date', () => {
    const one = balanceSplit(etf, [snap(1, '2021-01-01', 9000), snap(2, '2022-03-01', 12000), snap(3, '2026-03-01', 40000, 24000)]);
    const two = balanceSplit(etf, [snap(2, '2022-03-01', 12000), snap(4, '2024-03-01', 26000, 12000), snap(3, '2026-03-01', 40000, 12000)]);
    expect(one.share).toBeGreaterThan(0.5);
    expect(two.share).toBeGreaterThan(0.5);
    expect(two.share).toBeLessThan(1);
  });

  it('falls back to the plain share without a snapshot on the portion date', () => {
    const split = balanceSplit(etf, [snap(3, '2026-03-01', 40000)]);
    expect(split).toMatchObject({ anchored: false, missingSnapshot: true, share: 0.5 });
  });

  it('ignores a portion on an account that is not joint', () => {
    const split = balanceSplit({ ...etf, owner: 'self' }, [snap(1, '2022-03-01', 12000), snap(2, '2026-03-01', 40000)]);
    expect(split).toMatchObject({ anchored: false, share: 1 });
  });
});
