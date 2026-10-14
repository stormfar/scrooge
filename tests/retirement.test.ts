import { describe, expect, it } from 'vitest';
import {
  ageYears,
  earliestRetirement,
  retirementAtAge,
  grossFromRvEmployee,
  pensionFactor,
  pensionKeepAfterSocial,
  solveRetirement,
  statePensionGrossMonthly,
  zusatzRateFromPayslip,
  type RetirementAccount,
  type RetirementAssumptions,
  type RetirementPersonInput,
  type SolveRequest,
} from '../src/lib/retirement';

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

function person(partial: Partial<RetirementPersonInput> = {}): RetirementPersonInput {
  return {
    id: 'self',
    name: 'Alex',
    birthDate: '1986-01-01',
    pension: { mode: 'estimate', statedMonthly: null, points: null, grossSalaryMonthly: null, contributionYears: null },
    ...partial,
  };
}

function portfolio(partial: Partial<RetirementAccount> = {}): RetirementAccount {
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

function request(partial: Partial<SolveRequest> = {}): SolveRequest {
  return {
    people: [person()],
    accounts: [],
    scope: 'individual',
    spendingMonthly: 1000,
    assumptions,
    now,
    ...partial,
  };
}

describe('state pension', () => {
  it('cuts 0.3% per month before 67, capped at 14.4%, and adds 0.5% after', () => {
    expect(pensionFactor(67, 67)).toBeCloseTo(1, 6);
    expect(pensionFactor(63, 67)).toBeCloseTo(1 - 0.144, 6);
    expect(pensionFactor(60, 67)).toBeCloseTo(1 - 0.144, 6);
    expect(pensionFactor(68, 67)).toBeCloseTo(1.06, 6);
  });

  it('turns current Entgeltpunkte into a monthly pension', () => {
    const gross = statePensionGrossMonthly({
      pension: { mode: 'estimate', statedMonthly: null, points: 10, grossSalaryMonthly: null, contributionYears: null },
      currentAge: 40,
      stopAge: 67,
      claimAge: 67,
      rules: assumptions,
    });
    expect(gross).toBeCloseTo(425.2, 6);
  });

  it('reproduces a stated pension at 67 when salary is known, and reduces it if work stops earlier', () => {
    const pension = {
      mode: 'stated' as const,
      statedMonthly: 1700,
      points: null,
      grossSalaryMonthly: 5000,
      contributionYears: null,
    };
    const at67 = statePensionGrossMonthly({
      pension,
      currentAge: 40,
      stopAge: 67,
      claimAge: 67,
      rules: assumptions,
    });
    const at63 = statePensionGrossMonthly({
      pension,
      currentAge: 40,
      stopAge: 63,
      claimAge: 63,
      rules: assumptions,
    });
    expect(at67).toBeCloseTo(1700, 4);
    expect(at63).toBeLessThan(1700 * (1 - 0.144));
  });

  it('caps pensionable pay, and reads pensionable pay and the Zusatzbeitrag off a payslip', () => {
    const rules = { ...assumptions, contributionCapMonthly: 8450 };
    const pension = {
      mode: 'estimate' as const,
      statedMonthly: null,
      points: 0,
      contributionYears: null,
      salaryIncrease: { kind: 'percent' as const, value: 10, every: 'year' as const },
    };
    const shared = {
      currentAge: 40,
      stopAge: 42,
      claimAge: 67,
      rules,
    };
    const atCap = statePensionGrossMonthly({ ...shared, pension: { ...pension, grossSalaryMonthly: 8450 } });
    const above = statePensionGrossMonthly({ ...shared, pension: { ...pension, grossSalaryMonthly: 12000 } });
    expect(above).toBeCloseTo(atCap, 6);
    const growing = statePensionGrossMonthly({
      ...shared,
      pension: { ...pension, grossSalaryMonthly: 8000 },
    });
    const points = ((8000 * 12) + (8450 * 12)) / 51944;
    expect(growing).toBeCloseTo(points * 42.52, 4);
    const stepped = statePensionGrossMonthly({
      ...shared,
      pension: {
        ...pension,
        grossSalaryMonthly: 8450,
        salaryStep: { startMonth: 0, monthly: 12500 },
      },
    });
    expect(stepped).toBeCloseTo(atCap, 4);
    const lower = statePensionGrossMonthly({
      ...shared,
      pension: {
        ...pension,
        grossSalaryMonthly: 8450,
        salaryIncrease: { kind: 'percent', value: 0, every: 'year' },
        salaryStep: { startMonth: 12, monthly: 4000 },
      },
    });
    expect(lower).toBeLessThan(atCap);
    expect(grossFromRvEmployee(465, 8450)).toBeCloseTo(5000, 4);
    expect(grossFromRvEmployee(8450 * 0.093, 8450)).toBeCloseTo(8450, 4);
    expect(zusatzRateFromPayslip(365, 62.5)).toBeCloseTo(2.5, 4);
    expect(pensionKeepAfterSocial(2.5)).toBeCloseTo(1 - 0.073 - 0.0125 - 0.036, 6);
  });
});

describe('earliest retirement', () => {
  it('retires immediately when the portfolio already covers the horizon', () => {
    const result = earliestRetirement(request({
      accounts: [portfolio({ balance: 1_000_000 })],
      spendingMonthly: 100,
    }));
    expect(result.ok).toBe(true);
    expect(result.stopOffset).toBe(0);
    expect(result.agesAtRetirement.self).toBeCloseTo(40, 5);
  });

  it('counts only your share of a joint account in Just me, and the whole account for the household', () => {
    const full = solveRetirement(request({
      accounts: [portfolio({ owner: 'joint', ownerShare: 1, balance: 10_000, annualReturnPct: 0 })],
      spendingMonthly: 100,
    }));
    const half = solveRetirement(request({
      accounts: [portfolio({ owner: 'joint', ownerShare: 0.5, balance: 10_000, annualReturnPct: 0 })],
      spendingMonthly: 100,
    }));
    const household = solveRetirement(request({
      scope: 'household',
      accounts: [portfolio({ owner: 'joint', ownerShare: 0.5, balance: 10_000, annualReturnPct: 0 })],
      spendingMonthly: 100,
    }));
    expect(half.base.path[0].portfolio).toBeCloseTo(full.base.path[0].portfolio / 2, 0);
    expect(household.base.path[0].portfolio).toBeCloseTo(full.base.path[0].portfolio, 0);
  });

  it('keeps each account in the portfolio path so a chunk can be read on its own', () => {
    const result = solveRetirement(request({
      accounts: [
        portfolio({ id: 'etf', balance: 4_000, annualReturnPct: 0 }),
        portfolio({ id: 'pension', balance: 6_000, annualReturnPct: 0 }),
      ],
      spendingMonthly: 100,
    }));
    const opening = result.base.path[0];
    expect(opening.byAccount.etf).toBeCloseTo(4000, 0);
    expect(opening.byAccount.pension).toBeCloseTo(6000, 0);
    expect(opening.byAccount.etf + opening.byAccount.pension).toBeCloseTo(opening.portfolio, 0);
  });

  it('retires earlier when the monthly contribution rises by a fixed amount each year', () => {
    const flat = earliestRetirement(request({
      accounts: [portfolio({ monthlyContribution: 1000 })],
      spendingMonthly: 1000,
    }));
    const rising = earliestRetirement(request({
      accounts: [portfolio({
        monthlyContribution: 1000,
        increaseKind: 'amount',
        increaseValue: 400,
        increaseEvery: 'year',
      })],
      spendingMonthly: 1000,
    }));
    expect(flat.stopOffset).toBe(5);
    expect(rising.stopOffset).not.toBeNull();
    expect(rising.stopOffset ?? 99).toBeLessThan(5);
  });

  it('earns more pension when gross salary rises each year', () => {
    const rules = assumptions;
    const shared = {
      mode: 'estimate' as const,
      statedMonthly: null,
      points: 10,
      grossSalaryMonthly: 4000,
      contributionYears: null,
    };
    const flat = statePensionGrossMonthly({
      pension: { ...shared, salaryIncrease: { kind: 'percent', value: 0, every: 'year' } },
      currentAge: 40,
      stopAge: 67,
      claimAge: 67,
      rules,
    });
    const raised = statePensionGrossMonthly({
      pension: { ...shared, salaryIncrease: { kind: 'percent', value: 10, every: 'year' } },
      currentAge: 40,
      stopAge: 67,
      claimAge: 67,
      rules,
    });
    expect(raised).toBeGreaterThan(flat);
  });

  it('waits until contributions can fund the years after work stops', () => {
    const result = earliestRetirement(request({
      accounts: [portfolio({ monthlyContribution: 1000 })],
      spendingMonthly: 1000,
    }));
    expect(result.stopOffset).toBe(5);
    expect(result.agesAtRetirement.self).toBeCloseTo(45, 5);
    expect(result.path[result.path.length - 1].portfolio).toBeCloseTo(0, 0);
  });

  it('keeps going when even age 70 runs out', () => {
    const result = earliestRetirement(request({
      assumptions: { ...assumptions, horizonAge: 95 },
      spendingMonthly: 5000,
    }));
    expect(result.ok).toBe(false);
    expect(result.stopOffset).toBeNull();
    expect(result.runsOutAge).not.toBeNull();
  });

  it('uses the partner only when the household toggle is on', () => {
    const people = [
      person(),
      person({ id: 'partner', name: 'Sam', birthDate: '1988-01-01' }),
    ];
    const accounts = [portfolio({ id: 'bev', owner: 'partner', balance: 1_000_000 })];
    const alone = earliestRetirement(request({ people, accounts, spendingMonthly: 100 }));
    const household = earliestRetirement(request({ people, accounts, spendingMonthly: 100, scope: 'household' }));
    expect(alone.ok).toBe(false);
    expect(household.ok).toBe(true);
    expect(household.stopOffset).toBe(0);
    expect(household.agesAtRetirement.partner).toBeCloseTo(38, 2);
  });

  it('asks for a date of birth before it will guess an age', () => {
    const result = earliestRetirement(request({ people: [person({ birthDate: null })] }));
    expect(result.reason).toBe('missing-birth');
  });
});

describe('solveRetirement', () => {
  it('moves the age earlier when more is saved, within the return band', () => {
    const solved = solveRetirement(request({
      accounts: [portfolio({ monthlyContribution: 1000, annualReturnPct: 4 })],
      spendingMonthly: 1000,
      assumptions: { ...assumptions, scenarioSpreadPct: 2 },
    }), { leanSpendingMonthly: 800, comfortableSpendingMonthly: 1300 });
    expect(solved.base.stopOffset).not.toBeNull();
    expect(solved.optimistic.stopOffset).toBeLessThanOrEqual(solved.base.stopOffset ?? 0);
    expect(solved.pessimistic.stopOffset).toBeGreaterThanOrEqual(solved.base.stopOffset ?? 0);
    const extra = solved.sensitivity.find((row) => row.id === 'extra-200');
    expect(extra?.deltaYears).not.toBeNull();
    expect(extra?.deltaYears ?? 0).toBeLessThanOrEqual(0);
  });
});

describe('retirementAtAge', () => {
  it('uses the age you pick and reports when that plan runs out', () => {
    const funded = retirementAtAge(request({
      accounts: [portfolio({ balance: 100_000 })],
      spendingMonthly: 100,
      assumptions: { ...assumptions, horizonAge: 50 },
    }), 45);
    expect(funded.ok).toBe(true);
    expect(funded.agesAtRetirement.self).toBeCloseTo(45, 5);
    const early = retirementAtAge(request({
      accounts: [portfolio({ balance: 0 })],
      spendingMonthly: 1000,
    }), 41);
    expect(early.ok).toBe(false);
    expect(early.runsOutAge).not.toBeNull();
    expect((early.runsOutAge ?? 0)).toBeLessThan(50);
  });
});

describe('ageYears', () => {
  it('is 40 on the same calendar day forty years later', () => {
    expect(ageYears('1986-01-01', now)).toBeCloseTo(40, 5);
  });
});

describe('income breakdown', () => {
  it('shows pay while working, then income accounts and the portfolio covering spending', () => {
    const result = retirementAtAge(request({
      people: [person({ netSalaryMonthly: 3000 })],
      accounts: [
        portfolio({ balance: 500000 }),
        portfolio({ id: 'annuity', treatment: 'income', incomeMonthly: 400, incomeStartAge: 45 }),
      ],
      assumptions: { ...assumptions, horizonAge: 50 },
    }), 42);
    const working = result.path.find((point) => Math.round(point.ages.self) === 41);
    expect(working?.income.salary.self).toBeCloseTo(36000, 6);
    expect(working?.income.portfolioDraw).toBe(0);
    const early = result.path.find((point) => Math.round(point.ages.self) === 43);
    expect(early?.income.salary).toEqual({});
    expect(early?.income.portfolioDraw).toBeCloseTo(12000, 6);
    const later = result.path.find((point) => Math.round(point.ages.self) === 47);
    expect(later?.income.accounts.annuity).toBeCloseTo(4800, 6);
    expect((later?.income.portfolioDraw ?? 0) + (later?.income.accounts.annuity ?? 0)).toBeCloseTo(12000, 6);
  });
});

describe('other incomes in retirement', () => {
  it('covers spending after work stops while it is paid, and halves a joint one for Just me', () => {
    const req = request({
      accounts: [portfolio({ balance: 500000 })],
      otherIncomes: [
        { id: 'rent', owner: 'self', monthly: 300, startMonth: 0, endMonth: null, indexed: true },
        { id: 'kid', owner: 'joint', monthly: 200, startMonth: 0, endMonth: 12 * 4, indexed: false },
        { id: 'hers', owner: 'partner', monthly: 999, startMonth: 0, endMonth: null, indexed: true },
      ],
    });
    const result = retirementAtAge(req, 42);
    const at43 = result.path.find((point) => Math.round(point.ages.self) === 43);
    expect(at43?.income.other).toEqual({ rent: 3600, kid: 1200 });
    expect(at43?.income.portfolioDraw).toBeCloseTo(12000 - 3600 - 1200, 6);
    const at47 = result.path.find((point) => Math.round(point.ages.self) === 47);
    expect(at47?.income.other).toEqual({ rent: 3600 });
  });
});

describe('balance share', () => {
  it('counts your part of a joint balance separately from your share of contributions', () => {
    const plain = retirementAtAge(request({ accounts: [portfolio({ owner: 'joint', ownerShare: 0.5, balance: 100000, monthlyContribution: 1000 })] }), 42);
    const mostlyMine = retirementAtAge(request({ accounts: [portfolio({ owner: 'joint', ownerShare: 0.5, balanceShare: 0.8, balance: 100000, monthlyContribution: 1000 })] }), 42);
    expect(plain.path[0].portfolio).toBeCloseTo(50000, 6);
    expect(mostlyMine.path[0].portfolio).toBeCloseTo(80000, 6);
    // One year on, both have added half of 12 × 1,000.
    expect(mostlyMine.path[1].portfolio - plain.path[1].portfolio).toBeCloseTo(30000, 6);
  });
});
