import { describe, expect, it } from 'vitest';
import { chanceMoneyLasts, earliestConfidentAge, makeMarkets, sampledReturn } from '../src/lib/montecarlo';
import {
  earliestRetirement,
  retirementAtAge,
  type RetirementAccount,
  type RetirementAssumptions,
  type SolveRequest,
} from '../src/lib/retirement';
import { PENSION_UNLOCK_AGE, unlockAgeOf, withdrawalTaxOf } from '../src/lib/types';

// Born 1 Jan 1986, so 40 on 1 Jan 2026. No inflation, no returns, money must last to 50, €1,000 a month.
const now = new Date(2026, 0, 1);
const assumptions: RetirementAssumptions = {
  inflationPct: 0,
  horizonAge: 50,
  scenarioSpreadPct: 2,
  pensionNetFactor: 0.85,
  pensionGrowthPct: 0,
  durchschnittsentgeltAnnual: 51944,
  rentenwert: 42.52,
  regularPensionAge: 67,
  earliestPensionAge: 63,
};

function account(partial: Partial<RetirementAccount> = {}): RetirementAccount {
  return {
    id: 'a',
    owner: 'self',
    balance: 0,
    monthlyContribution: 0,
    contributionGrowthPct: 0,
    annualReturnPct: 0,
    treatment: 'portfolio',
    incomeMonthly: null,
    incomeStartAge: null,
    closed: false,
    ...partial,
  };
}

function request(accounts: RetirementAccount[], partial: Partial<SolveRequest> = {}): SolveRequest {
  return {
    people: [{
      id: 'self',
      name: 'Alex',
      birthDate: '1986-01-01',
      pension: { mode: 'estimate', statedMonthly: null, points: null, grossSalaryMonthly: null, contributionYears: null },
    }],
    accounts,
    scope: 'individual',
    spendingMonthly: 1000,
    assumptions,
    now,
    ...partial,
  };
}

describe('locked accounts', () => {
  const etf = account({ id: 'etf', balance: 50_000 });
  const bav = account({ id: 'bav', balance: 200_000 });

  it('cannot bridge the years before a pension policy opens', () => {
    const open = retirementAtAge(request([etf, bav]), 40);
    expect(open.ok).toBe(true);
    const locked = retirementAtAge(request([etf, { ...bav, unlockAge: 45 }]), 40);
    expect(locked.ok).toBe(false);
    expect(locked.runsOutAge).toBeCloseTo(40 + 50 / 12, 2);
    expect(locked.lockedAtRunOut).toBeCloseTo(200_000, 0);
  });

  it('draws on the policy once it opens', () => {
    const result = retirementAtAge(request([account({ id: 'etf', balance: 60_000 }), { ...bav, unlockAge: 45 }]), 40);
    expect(result.ok).toBe(true);
    const at = (age: number) => result.path.find((p) => Math.abs((p.ages.self ?? 0) - age) < 1e-6)!;
    expect(at(45).byAccount.bav).toBeCloseTo(200_000, 0);
    expect(at(46).byAccount.bav).toBeCloseTo(188_000, 0);
  });

  it('defaults: pension policies open at 62, other locked money at the regular pension age', () => {
    expect(unlockAgeOf({ type: 'bav', accessible: false, unlockAge: null }, 67)).toBe(PENSION_UNLOCK_AGE);
    expect(unlockAgeOf({ type: 'fixed_term', accessible: false, unlockAge: null }, 67)).toBe(67);
    expect(unlockAgeOf({ type: 'bav', accessible: false, unlockAge: 60 }, 67)).toBe(60);
    expect(unlockAgeOf({ type: 'bav', accessible: true, unlockAge: 60 }, 67)).toBeNull();
  });
});

describe('tax on withdrawals', () => {
  it('grosses up a taxed payout', () => {
    const untaxed = retirementAtAge(request([account({ balance: 99_000 })]), 40);
    const taxed = retirementAtAge(request([account({ balance: 99_000, taxKind: 'payout', taxPct: 25 })]), 40);
    expect(untaxed.runsOutAge).toBeCloseTo(40 + 99 / 12, 2);
    expect(taxed.runsOutAge).toBeCloseTo(40 + 74 / 12, 2);
    const year = taxed.path.find((p) => p.yearOffset === 1)!;
    expect(year.withdrawalTaxAnnual).toBeCloseTo(4000, 0);
    expect(year.income.portfolioDraw).toBeCloseTo(12_000, 0);
  });

  it('taxes only the gain, and the gain share stays put as money comes out', () => {
    const result = retirementAtAge(request([account({ balance: 99_000, costBasis: 49_500, taxKind: 'gains', taxPct: 20 })]), 40);
    // 10% of every euro taken out is tax: 99,000 / 1,111.11 = 89.1 months.
    expect(result.runsOutAge).toBeCloseTo(40 + 89 / 12, 2);
  });

  it('treats a missing cost basis as no gains yet', () => {
    const result = retirementAtAge(request([account({ balance: 99_000, taxKind: 'gains', taxPct: 20 })]), 40);
    expect(result.runsOutAge).toBeCloseTo(40 + 99 / 12, 2);
  });

  it('leaves gains under the yearly allowance untaxed', () => {
    const result = retirementAtAge(
      request([account({ balance: 99_000, costBasis: 49_500, taxKind: 'gains', taxPct: 20 })], { taxAllowanceAnnual: 6000 }),
      40,
    );
    expect(result.runsOutAge).toBeCloseTo(40 + 99 / 12, 2);
  });

  it('has German defaults per account type, overridable per account', () => {
    expect(withdrawalTaxOf({ type: 'etf', withdrawalTaxPct: null })).toEqual({ kind: 'gains', pct: 18.46 });
    expect(withdrawalTaxOf({ type: 'bav', withdrawalTaxPct: null }).kind).toBe('payout');
    expect(withdrawalTaxOf({ type: 'crypto', withdrawalTaxPct: null })).toEqual({ kind: 'none', pct: 0 });
    expect(withdrawalTaxOf({ type: 'etf', withdrawalTaxPct: 0 })).toEqual({ kind: 'gains', pct: 0 });
  });
});

describe('simulated markets', () => {
  const markets = makeMarkets(200, 80, 7);

  it('averages out at the expected return', () => {
    const draws = makeMarkets(4000, 1, 3).shocks.map(([z]) => sampledReturn(7, 'medium', z));
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length;
    expect(mean).toBeGreaterThan(6);
    expect(mean).toBeLessThan(8);
  });

  it('is certain when money is plenty and hopeless when it is short', () => {
    expect(chanceMoneyLasts(request([account({ balance: 1_000_000, risk: 'high', annualReturnPct: 5 })]), 40, markets)?.chance).toBe(1);
    expect(chanceMoneyLasts(request([account({ balance: 10_000, risk: 'low' })]), 40, markets)?.chance).toBe(0);
  });

  it('gives the same answer for the same plan', () => {
    const req = request([account({ balance: 105_000, risk: 'high', annualReturnPct: 4 })], { assumptions: { ...assumptions, horizonAge: 60 } });
    expect(chanceMoneyLasts(req, 45, markets)).toEqual(chanceMoneyLasts(req, 45, markets));
  });

  it('asks to work longer than the average-return answer for a 90% chance with volatile money', () => {
    const req = request(
      [account({ balance: 50_000, monthlyContribution: 2000, risk: 'high', annualReturnPct: 6 })],
      { assumptions: { ...assumptions, horizonAge: 90 }, spendingMonthly: 2000 },
    );
    const average = earliestRetirement(req).agesAtRetirement.self!;
    const confident = earliestConfidentAge(req, 0.9, markets);
    expect(confident.age).not.toBeNull();
    expect(confident.age!).toBeGreaterThan(average);
    expect(confident.chance!).toBeGreaterThanOrEqual(0.9);
  });
});
