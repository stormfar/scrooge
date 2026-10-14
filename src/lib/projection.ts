/**
 * Month-by-month compound growth for investment accounts.
 * Contribution is added at the end of the month, so it earns a return from the next month.
 * `contributed` is money put in (today's balance counts as already contributed). `growth` is the rest.
 */

export type IncreaseKind = 'percent' | 'amount';
export type IncreaseEvery = 'year' | 'month';

/** How a monthly payment rises. Percent compounds. Amount adds euros to the monthly payment. */
export interface PaymentIncrease {
  kind: IncreaseKind;
  value: number;
  every: IncreaseEvery;
}

export const NO_INCREASE: PaymentIncrease = { kind: 'percent', value: 0, every: 'year' };

/**
 * Monthly payment at `monthIndex` (0 = the starting amount, before any rise).
 * A yearly rise first applies in month 12. A monthly rise first applies in month 1.
 */
export function grownMonthly(start: number, increase: PaymentIncrease, monthIndex: number): number {
  const steps = increase.every === 'month' ? monthIndex : Math.floor(monthIndex / 12);
  if (steps <= 0 || increase.value === 0) return Math.max(0, start);
  if (increase.kind === 'percent') return Math.max(0, start * (1 + increase.value / 100) ** steps);
  return Math.max(0, start + increase.value * steps);
}

export function increaseFrom(source: {
  contributionGrowthPct?: number;
  increaseKind?: IncreaseKind;
  increaseValue?: number;
  increaseEvery?: IncreaseEvery;
}): PaymentIncrease {
  return {
    kind: source.increaseKind ?? 'percent',
    value: source.increaseValue ?? source.contributionGrowthPct ?? 0,
    every: source.increaseEvery ?? 'year',
  };
}

export interface ProjectAccount {
  id: string;
  name: string;
  balance: number;
  monthlyContribution: number;
  /** Used when increaseValue is omitted: a percent rise once a year. */
  contributionGrowthPct: number;
  increaseKind?: IncreaseKind;
  increaseValue?: number;
  increaseEvery?: IncreaseEvery;
  annualReturnPct: number;
  closed: boolean;
}

export interface ProjectionAdjustments {
  contributionScale?: number;
  /** Euros per month added across open accounts, in proportion to their contributions. */
  extraMonthly?: number;
  returnDeltaPct?: number;
  lumpSum?: number;
}

export interface ProjectionOptions extends ProjectionAdjustments {
  years: number;
  inflationPct?: number;
  /** Divide results by inflation so the chart is in today's euros. */
  real?: boolean;
  now?: Date;
}

export interface ProjectionPoint {
  year: number;
  label: string;
  byAccount: Record<string, number>;
  /** Money put in so far per account (today's balance counts as put in). */
  contributedByAccount: Record<string, number>;
  total: number;
  contributed: number;
  growth: number;
}

export const MILESTONE_YEARS = [5, 10, 15, 20, 30] as const;

export type Scenario = 'conservative' | 'medium' | 'optimistic';
export type RiskLevel = 'low' | 'medium' | 'high';

/** Percentage points either side of the expected return, wider for riskier accounts. */
export const RISK_SPREAD: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

/** Return for a scenario. A conservative return never drops below 0 unless the expected one already does. */
export function scenarioReturn(expectedPct: number, risk: RiskLevel, scenario: Scenario): number {
  if (scenario === 'medium') return expectedPct;
  const spread = RISK_SPREAD[risk];
  if (scenario === 'optimistic') return expectedPct + spread;
  return expectedPct >= 0 ? Math.max(0, expectedPct - spread) : expectedPct - spread;
}

export function monthlyRate(annualPct: number): number {
  const annual = Math.max(-99, annualPct) / 100;
  return (1 + annual) ** (1 / 12) - 1;
}

export function adjustAccounts(accounts: ProjectAccount[], adj: ProjectionAdjustments): ProjectAccount[] {
  const scale = adj.contributionScale ?? 1;
  const delta = adj.returnDeltaPct ?? 0;
  const extra = adj.extraMonthly ?? 0;
  const open = accounts.filter((a) => !a.closed);
  const base = open.reduce((sum, a) => sum + Math.max(0, a.monthlyContribution), 0);
  const lump = adj.lumpSum ?? 0;
  const positive = accounts.reduce((sum, a) => sum + Math.max(0, a.balance), 0);

  return accounts.map((account, index) => {
    let contribution = account.closed ? 0 : Math.max(0, account.monthlyContribution) * scale;
    if (!account.closed && extra !== 0) {
      if (base > 0) contribution += extra * (Math.max(0, account.monthlyContribution) / base);
      else if (open[0]?.id === account.id) contribution += extra;
    }
    let balance = account.balance;
    if (lump !== 0) {
      if (positive > 0) balance += lump * (Math.max(0, account.balance) / positive);
      else if (index === 0) balance += lump;
    }
    return {
      ...account,
      balance,
      monthlyContribution: Math.max(0, contribution),
      annualReturnPct: account.annualReturnPct + delta,
    };
  });
}

export function projectAccounts(accounts: ProjectAccount[], options: ProjectionOptions): ProjectionPoint[] {
  const years = Math.max(0, Math.min(80, Math.floor(options.years)));
  const prepared = adjustAccounts(accounts, options);
  const state = prepared.map((account) => ({
    ...account,
    baseContribution: account.closed ? 0 : account.monthlyContribution,
    increase: increaseFrom(account),
  }));
  let contributed = state.reduce((sum, account) => sum + account.balance, 0);
  const paidIn: Record<string, number> = Object.fromEntries(state.map((account) => [account.id, account.balance]));
  const startYear = (options.now ?? new Date()).getFullYear();
  const inflation = options.inflationPct ?? 0;
  const real = options.real === true && inflation !== 0;

  const point = (year: number): ProjectionPoint => {
    const deflate = real ? 1 / (1 + inflation / 100) ** year : 1;
    const byAccount: Record<string, number> = {};
    let total = 0;
    for (const account of state) {
      const value = account.balance * deflate;
      byAccount[account.id] = value;
      total += value;
    }
    const contributedNow = contributed * deflate;
    return {
      year,
      label: year === 0 ? 'Now' : String(startYear + year),
      byAccount,
      contributedByAccount: Object.fromEntries(Object.entries(paidIn).map(([id, value]) => [id, value * deflate])),
      total,
      contributed: contributedNow,
      growth: total - contributedNow,
    };
  };

  const points = [point(0)];
  for (let month = 1; month <= years * 12; month++) {
    for (const account of state) {
      const contribution = account.closed ? 0 : grownMonthly(account.baseContribution, account.increase, month - 1);
      account.balance = account.balance * (1 + monthlyRate(account.annualReturnPct)) + contribution;
      contributed += contribution;
      paidIn[account.id] += contribution;
    }
    if (month % 12 === 0) points.push(point(month / 12));
  }
  return points;
}

export function milestonePoints(points: ProjectionPoint[], years: readonly number[] = MILESTONE_YEARS): ProjectionPoint[] {
  const out: ProjectionPoint[] = [];
  for (const year of years) {
    const found = points.find((point) => point.year === year);
    if (found) out.push(found);
  }
  return out;
}
