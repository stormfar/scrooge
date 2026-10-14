import { describe, expect, it } from 'vitest';
import { flowsForGap, growWith, paymentsBetween, solveRate } from '../src/lib/flows';
import { calibrate } from '../src/lib/calibration';
import type { Balance } from '../src/lib/types';

const fund = {
  monthlyContribution: 500,
  openedOn: '2019-08-13',
  contributionHistory: [
    { fromMonth: '2019-08', toMonth: '2021-09', amountMonthly: 250, note: '' },
    { fromMonth: '2021-10', toMonth: null, amountMonthly: 500, note: '' },
  ],
};

const snap = (id: number, date: string, balance: number, contributed: number | null = null): Balance => ({
  id, accountId: 'r', date, balance, contributed, note: '',
});

describe('contribution schedule', () => {
  it('pays on the opening day of each month, following the history', () => {
    const { payments, assumed } = paymentsBetween(fund, '2019-08-01', '2022-03-01');
    expect(assumed).toBe(false);
    expect(payments[0]).toEqual({ date: '2019-08-13', amount: 250 });
    expect(payments.filter((p) => p.amount === 250)).toHaveLength(26);
    expect(payments.filter((p) => p.amount === 500)).toHaveLength(5);
  });

  it('treats months outside the history as paused, and assumes the current amount without a history', () => {
    const paused = paymentsBetween({ ...fund, contributionHistory: [{ fromMonth: '2024-01', toMonth: '2024-03', amountMonthly: 100, note: '' }] }, '2023-12-31', '2024-12-31');
    expect(paused.payments.map((p) => p.amount)).toEqual([100, 100, 100]);
    const guessed = paymentsBetween({ monthlyContribution: 500 }, '2024-01-01', '2025-01-01');
    expect(guessed).toMatchObject({ assumed: true });
    expect(guessed.payments).toHaveLength(12);
  });

  it('scales the schedule to a recorded total, keeping its timing', () => {
    const gap = flowsForGap(fund, '2022-03-01', '2023-03-01', 3000);
    expect(gap.payments.reduce((sum, p) => sum + p.amount, 0)).toBeCloseTo(3000, 6);
    expect(gap.planned.reduce((sum, p) => sum + p.amount, 0)).toBe(6000);
  });

  it('solves the monthly return back from uneven payments', () => {
    const payments = [{ date: '2024-02-01', amount: 100 }, { date: '2024-06-01', amount: 900 }];
    const end = growWith(1000, payments, '2024-01-01', '2025-01-01', 0.005);
    expect(solveRate(1000, payments, '2024-01-01', '2025-01-01', end)).toBeCloseTo(0.005, 8);
  });
});

describe('calibration with a history', () => {
  it('starts at the opening date with nothing in the account', () => {
    const cal = calibrate({ ...fund, expectedReturnPct: 4, closed: false }, [snap(1, '2022-03-01', 12000), snap(2, '2026-10-13', 38000)]);
    expect(cal?.fromOpening).toBe(true);
    expect(cal?.firstDate).toBe('2019-08-12');
    expect(cal?.assumedFlows).toBe(false);
    expect(cal?.snapshots).toBe(2);
    expect(cal?.plannedFlows).toBe(26 * 250 + 5 * 500 + 56 * 500);
  });
});
