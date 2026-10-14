import { describe, expect, it } from 'vitest';
import { incomeShare, pot, retirementSpending, type HouseholdInput } from '../src/lib/household';

const base: HouseholdInput = {
  mode: 'joint',
  selfNetMonthly: 6300,
  partnerNetMonthly: 2800,
  selfAllowanceMonthly: 1200,
  partnerAllowanceMonthly: 1200,
  rentMonthly: 2343,
  sharedSpendMonthly: 1800,
  accounts: [
    { owner: 'joint', monthlyContribution: 500, closedOn: null },
    { owner: 'joint', monthlyContribution: 1000, closedOn: null },
    { owner: 'self', monthlyContribution: 259, closedOn: null },
    { owner: 'self', monthlyContribution: 100, closedOn: '2025-01-01' },
  ],
};

describe('pot', () => {
  it('pays allowances, rent, shared costs and joint investments out of both take-home pays', () => {
    const p = pot(base);
    expect(p.inMonthly).toBe(9100);
    expect(p.jointInvestMonthly).toBe(1500);
    expect(p.outMonthly).toBe(2400 + 2343 + 1800 + 1500);
    expect(p.unallocatedMonthly).toBe(9100 - 8043);
  });

  it('takes personal investments out of the allowance, and ignores closed accounts', () => {
    const p = pot(base);
    expect(p.selfInvestMonthly).toBe(259);
    expect(p.selfLivingMonthly).toBe(941);
    expect(p.partnerLivingMonthly).toBe(1200);
  });
});

describe('other incomes', () => {
  it('adds incomes paid into the pot while they are being paid', () => {
    const incomes = [
      { amountMonthly: 255, intoPot: true, startsOn: null, endsOn: '2041-05-01' },
      { amountMonthly: 400, intoPot: false, startsOn: null, endsOn: null },
      { amountMonthly: 100, intoPot: true, startsOn: '2030-01-01', endsOn: null },
    ];
    expect(pot({ ...base, incomes, today: '2026-10-13' }).otherInMonthly).toBe(255);
    expect(pot({ ...base, incomes, today: '2042-01-01' }).otherInMonthly).toBe(100);
    expect(pot({ ...base, mode: 'solo', incomes, today: '2026-10-13' }).otherInMonthly).toBe(655);
  });
});

describe('retirement spending', () => {
  it('household is rent plus shared costs plus what each person lives on, without any contributions', () => {
    const spend = retirementSpending({ ...base, scope: 'household', lifestyle: 1, sharedCostShare: null, spendingOverride: null, housingOverride: null });
    expect(spend.housingBase).toBe(2343);
    expect(spend.otherBase).toBe(1800 + 941 + 1200);
    expect(spend.totalMonthly).toBeCloseTo(2343 + 3941, 6);
  });

  it('just me weights shared costs by take-home pay unless a share is set', () => {
    const share = incomeShare(6300, 2800) as number;
    expect(share).toBeCloseTo(0.6923, 4);
    const weighted = retirementSpending({ ...base, scope: 'individual', lifestyle: 1, sharedCostShare: null, spendingOverride: null, housingOverride: null });
    expect(weighted.housingBase).toBeCloseTo(2343 * share, 6);
    expect(weighted.otherBase).toBeCloseTo(1800 * share + 941, 6);
    const half = retirementSpending({ ...base, scope: 'individual', lifestyle: 1, sharedCostShare: 0.5, spendingOverride: null, housingOverride: null });
    expect(half.housingBase).toBe(2343 / 2);
  });

  it('applies lifestyle to both lines and lets overrides replace them', () => {
    const spend = retirementSpending({ ...base, scope: 'household', lifestyle: 1.25, sharedCostShare: null, spendingOverride: 3000, housingOverride: 1000 });
    expect(spend.totalMonthly).toBe(5000);
    expect(spend.leanMonthly).toBe(3200);
  });

  it('solo is rent plus other spending', () => {
    const spend = retirementSpending({ ...base, mode: 'solo', scope: 'household', lifestyle: 1, sharedCostShare: null, spendingOverride: null, housingOverride: null });
    expect(spend.housingBase).toBe(2343);
    expect(spend.otherBase).toBe(1800);
  });
});
