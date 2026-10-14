import { describe, expect, it } from 'vitest';
import { grownMonthly, milestonePoints, projectAccounts, scenarioReturn, type ProjectAccount } from '../src/lib/projection';

const now = new Date(2026, 0, 1);

function account(partial: Partial<ProjectAccount> & Pick<ProjectAccount, 'id'>): ProjectAccount {
  return {
    name: partial.id,
    balance: 0,
    monthlyContribution: 0,
    contributionGrowthPct: 0,
    annualReturnPct: 0,
    closed: false,
    ...partial,
  };
}

describe('projectAccounts', () => {
  it('sums contributions when the return is zero', () => {
    const points = projectAccounts([account({ id: 'a', monthlyContribution: 100 })], { years: 1, now });
    const year = points.find((point) => point.year === 1);
    expect(year?.total).toBeCloseTo(1200, 6);
    expect(year?.contributed).toBeCloseTo(1200, 6);
    expect(year?.growth).toBeCloseTo(0, 6);
  });

  it('compounds an annual return over twelve months', () => {
    const points = projectAccounts([account({ id: 'a', balance: 1000, annualReturnPct: 12 })], { years: 1, now });
    const year = points.find((point) => point.year === 1);
    expect(year?.total).toBeCloseTo(1120, 6);
    expect(year?.contributed).toBeCloseTo(1000, 6);
    expect(year?.growth).toBeCloseTo(120, 6);
  });

  it('grows the contribution once a year', () => {
    const points = projectAccounts(
      [account({ id: 'a', monthlyContribution: 100, contributionGrowthPct: 10 })],
      { years: 2, now },
    );
    const year = points.find((point) => point.year === 2);
    expect(year?.contributed).toBeCloseTo(1200 + 1320, 6);
    expect(year?.total).toBeCloseTo(2520, 6);
  });

  it('adds a fixed amount to the monthly contribution once a year', () => {
    const points = projectAccounts(
      [account({
        id: 'a',
        monthlyContribution: 100,
        increaseKind: 'amount',
        increaseValue: 50,
        increaseEvery: 'year',
      })],
      { years: 2, now },
    );
    expect(points.find((point) => point.year === 2)?.contributed).toBeCloseTo(1200 + 1800, 6);
  });

  it('compounds a percent rise from the second month', () => {
    expect(grownMonthly(100, { kind: 'percent', value: 10, every: 'month' }, 0)).toBe(100);
    expect(grownMonthly(100, { kind: 'percent', value: 10, every: 'month' }, 1)).toBeCloseTo(110, 6);
    expect(grownMonthly(100, { kind: 'percent', value: 10, every: 'month' }, 2)).toBeCloseTo(121, 6);
  });

  it('widens the scenario band with risk and keeps conservative at or above zero', () => {
    expect(scenarioReturn(7, 'medium', 'conservative')).toBe(5);
    expect(scenarioReturn(7, 'medium', 'optimistic')).toBe(9);
    expect(scenarioReturn(8, 'high', 'optimistic')).toBe(11);
    expect(scenarioReturn(2, 'low', 'medium')).toBe(2);
    expect(scenarioReturn(0.5, 'low', 'conservative')).toBe(0);
  });

  it('deflates by inflation when asked for today\'s euros', () => {
    const points = projectAccounts(
      [account({ id: 'a', balance: 1000, annualReturnPct: 12 })],
      { years: 1, inflationPct: 2, real: true, now },
    );
    expect(points.find((point) => point.year === 1)?.total).toBeCloseTo(1120 / 1.02, 6);
  });

  it('stops contributions on a closed account but keeps the balance', () => {
    const points = projectAccounts(
      [account({ id: 'a', balance: 500, monthlyContribution: 100, closed: true })],
      { years: 1, now },
    );
    expect(points.find((point) => point.year === 1)?.total).toBeCloseTo(500, 6);
  });

  it('adds a lump sum to contributed money', () => {
    const points = projectAccounts(
      [account({ id: 'a', balance: 100 })],
      { years: 1, lumpSum: 400, now },
    );
    expect(points[0].total).toBeCloseTo(500, 6);
    expect(points.find((point) => point.year === 1)?.contributed).toBeCloseTo(500, 6);
  });

  it('splits a stacked total across accounts', () => {
    const points = projectAccounts(
      [account({ id: 'a', balance: 100 }), account({ id: 'b', balance: 300 })],
      { years: 0, now },
    );
    expect(points[0].byAccount.a).toBeCloseTo(100, 6);
    expect(points[0].byAccount.b).toBeCloseTo(300, 6);
    expect(milestonePoints(projectAccounts(
      [account({ id: 'a', monthlyContribution: 10 })],
      { years: 30, now },
    )).map((point) => point.year)).toEqual([5, 10, 15, 20, 30]);
  });
});
