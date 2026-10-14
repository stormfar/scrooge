/**
 * When can the portfolio cover spending until the horizon age?
 *
 * German state pension
 * - Regular age 67. Claiming earlier than that (from 63) cuts the pension by 0.3% per month, capped at 14.4%.
 *   Delaying past 67 adds 0.5% per month.
 * - You keep earning Entgeltpunkte only while you are still working. A gap between stopping work and claiming does not add points.
 * - Stated mode uses the Renteninformation amount (the projection at 67 if contributions continue). If a gross salary
 *   is also set, the years you will not work are taken back out of that projection. Without a salary or current points,
 *   early retirement only applies the percentage cut, which is optimistic.
 * - Estimate mode is current Entgeltpunkte, or years contributed times salary / Durchschnittsentgelt, plus future years of work.
 * - The result is multiplied by pensionNetFactor (tax and health insurance) and then grown by pensionGrowthPct a year.
 *
 * Spending is inflated. Investment returns are nominal. The earliest age is the first one where the portfolio
 * never falls below zero before the horizon. Household mode stops both people in the same year.
 */

import { selfShare } from './types';
import { adjustAccounts, grownMonthly, increaseFrom, monthlyRate, type PaymentIncrease, type ProjectAccount } from './projection';

export interface PensionFields {
  mode: 'stated' | 'estimate';
  statedMonthly: number | null;
  points: number | null;
  grossSalaryMonthly: number | null;
  contributionYears: number | null;
  /** Raise applied to gross salary for future pension points. Net salary uses the same schedule for display. */
  salaryIncrease?: PaymentIncrease;
  /** From this month on, gross salary becomes `monthly`, then the same raise applies. */
  salaryStep?: { startMonth: number; monthly: number } | null;
}

export interface PensionRules {
  rentenwert: number;
  durchschnittsentgeltAnnual: number;
  regularAge: number;
  earliestAge: number;
  abschlagPerMonth: number;
  delayBonusPerMonth: number;
}

export const ABSCHLAG_PER_MONTH = 0.003;
export const DELAY_BONUS_PER_MONTH = 0.005;
export const ABSCHLAG_MONTHS_CAP = 48;
/** Employee share of the 18.6% pension contribution. */
export const RV_EMPLOYEE_RATE = 0.093;
/** What a pensioner pays for statutory health insurance, before the fund's Zusatzbeitrag. */
export const PENSIONER_KV_RATE = 0.073;
/** Care insurance for a pensioner with one child. Childless is 4.2%. */
export const PENSIONER_PV_RATE = 0.036;

/** Pay that earns Entgeltpunkte. Earnings above the Beitragsbemessungsgrenze do not count. */
export function pensionableMonthly(grossMonthly: number, capMonthly: number): number {
  if (grossMonthly <= 0) return 0;
  if (capMonthly <= 0) return grossMonthly;
  return Math.min(grossMonthly, capMonthly);
}

/** Pensionable monthly pay implied by the employee pension contribution on a payslip. */
export function grossFromRvEmployee(rvEmployeeMonthly: number, capMonthly: number): number {
  if (rvEmployeeMonthly <= 0 || RV_EMPLOYEE_RATE <= 0) return 0;
  return pensionableMonthly(rvEmployeeMonthly / RV_EMPLOYEE_RATE, capMonthly);
}

/**
 * Full Zusatzbeitrag rate, in percent, from the two health lines on a payslip.
 * KV-AN is 7.3% of the health-insurance gross. The employee pays half of the Zusatzbeitrag.
 */
export function zusatzRateFromPayslip(kvEmployeeMonthly: number, zusatzEmployeeMonthly: number): number | null {
  if (kvEmployeeMonthly <= 0 || zusatzEmployeeMonthly < 0) return null;
  const kvGross = kvEmployeeMonthly / PENSIONER_KV_RATE;
  if (kvGross <= 0) return null;
  return (zusatzEmployeeMonthly / kvGross) * 2 * 100;
}

/** Share of the gross pension left after pensioner health and care insurance. Tax is separate. */
export function pensionKeepAfterSocial(zusatzRatePct: number, careRate = PENSIONER_PV_RATE): number {
  const halfZusatz = Math.max(0, zusatzRatePct) / 100 / 2;
  return Math.min(1, Math.max(0, 1 - PENSIONER_KV_RATE - halfZusatz - careRate));
}

export interface RetirementAccount {
  id: string;
  owner: string;
  balance: number;
  monthlyContribution: number;
  contributionGrowthPct: number;
  increaseKind?: PaymentIncrease['kind'];
  increaseValue?: number;
  increaseEvery?: PaymentIncrease['every'];
  annualReturnPct: number;
  treatment: 'portfolio' | 'income';
  incomeMonthly: number | null;
  incomeStartAge: number | null;
  closed: boolean;
  /** Your fraction of contributions and income. Used in Just me; household retirement keeps the whole account. */
  ownerShare?: number;
  /** Your fraction of today's balance when it differs from ownerShare, for example money you put in before it became joint. */
  balanceShare?: number;
}

export interface RetirementPersonInput {
  id: string;
  name: string;
  birthDate: string | null;
  pension: PensionFields;
  /** When set, replaces the shared pension net factor for this person. */
  netFactor?: number | null;
  /** Take-home pay per month today. Only drawn on the income chart; spending while working is assumed to come from it. */
  netSalaryMonthly?: number | null;
}

export interface RetirementAssumptions {
  inflationPct: number;
  horizonAge: number;
  scenarioSpreadPct: number;
  pensionNetFactor: number;
  pensionGrowthPct: number;
  /** Beitragsbemessungsgrenze, euros per month. Zero means no cap. */
  contributionCapMonthly?: number;
  durchschnittsentgeltAnnual: number;
  rentenwert: number;
  regularPensionAge: number;
  earliestPensionAge: number;
}

/** An income that is not salary or pension, placed in months from now. */
export interface RetirementIncome {
  id: string;
  owner: string;
  monthly: number;
  /** Month offset when it starts (0 or less = already paid). */
  startMonth: number;
  /** Month offset when it stops, or null. */
  endMonth: number | null;
  /** Rises with inflation. */
  indexed: boolean;
}

export interface SolveRequest {
  people: RetirementPersonInput[];
  accounts: RetirementAccount[];
  otherIncomes?: RetirementIncome[];
  scope: 'individual' | 'household';
  /** Today's euros per month, housing included, lifestyle already applied. */
  spendingMonthly: number;
  assumptions: RetirementAssumptions;
  now?: Date;
  returnDeltaPct?: number;
  extraMonthly?: number;
}

export interface PathYear {
  yearOffset: number;
  ages: Record<string, number>;
  portfolio: number;
  /** Nominal balance of each drawdown account at this point. The sum is `portfolio`. */
  byAccount: Record<string, number>;
  spendingAnnual: number;
  pensionAnnual: number;
  /** Where the money comes from this year, nominal euros per year. Sums to at most spending once work stops. */
  income: IncomeBreakdown;
}

export interface IncomeBreakdown {
  /** Take-home pay while still working, by person id. */
  salary: Record<string, number>;
  /** Net state pension by person id. */
  statePension: Record<string, number>;
  /** Accounts that pay a monthly income, by account id. */
  accounts: Record<string, number>;
  /** Other incomes such as Kindergeld, by income id. Shown while working too, but only counted against spending after work stops. */
  other: Record<string, number>;
  /** Taken out of the portfolio to cover the rest of spending. */
  portfolioDraw: number;
}

export interface ScenarioResult {
  ok: boolean;
  reason?: 'missing-birth';
  missingPersonId?: string;
  stopOffset: number | null;
  agesAtRetirement: Record<string, number>;
  runsOutAge: number | null;
  path: PathYear[];
  /** Net state pension at the claim date, in today's euros (before later pension growth). */
  statePensionNetMonthly: number;
  otherIncomeMonthly: number;
}

export interface SensitivityRow {
  id: string;
  label: string;
  stopOffset: number | null;
  deltaYears: number | null;
}

export interface RetirementSolution {
  pessimistic: ScenarioResult;
  base: ScenarioResult;
  optimistic: ScenarioResult;
  sensitivity: SensitivityRow[];
}

export function ageYears(birthDate: string, on: Date): number {
  const [year, month, day] = birthDate.split('-').map(Number);
  const birth = new Date(year, (month ?? 1) - 1, day ?? 1);
  return (on.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

export function formatAge(years: number): string {
  if (!Number.isFinite(years)) return '—';
  const whole = Math.floor(years + 1e-9);
  let months = Math.round((years - whole) * 12);
  if (months >= 12) return String(whole + 1);
  if (months <= 0) return String(whole);
  return `${whole}y ${months}m`;
}

export function pensionFactor(claimAge: number, regularAge: number): number {
  const months = Math.round((claimAge - regularAge) * 12);
  if (months < 0) return 1 - Math.min(ABSCHLAG_MONTHS_CAP, -months) * ABSCHLAG_PER_MONTH;
  return 1 + months * DELAY_BONUS_PER_MONTH;
}

function annualPoints(monthlySalary: number, durchschnitt: number): number {
  if (durchschnitt <= 0 || monthlySalary <= 0) return 0;
  return (monthlySalary * 12) / durchschnitt;
}

/** Gross monthly state pension, in today's euros, at the claim age. */
export function statePensionGrossMonthly(args: {
  pension: PensionFields;
  currentAge: number;
  stopAge: number;
  claimAge: number;
  rules: Pick<PensionRules, 'rentenwert' | 'durchschnittsentgeltAnnual'> & { regularPensionAge: number; contributionCapMonthly?: number };
}): number {
  const { pension, currentAge, stopAge, claimAge, rules } = args;
  const factor = pensionFactor(claimAge, rules.regularPensionAge);
  const salary = pensionableMonthly(pension.grossSalaryMonthly ?? 0, rules.contributionCapMonthly ?? 0);
  const perYear = annualPoints(salary, rules.durchschnittsentgeltAnnual);
  const accrualYears = Math.max(0, Math.min(stopAge, claimAge) - currentAge);
  const increase = pension.salaryIncrease ?? { kind: 'percent' as const, value: 0, every: 'year' as const };
  const accrued = pointsFromSalary(salary, increase, accrualYears, rules.durchschnittsentgeltAnnual, rules.contributionCapMonthly ?? 0, pension.salaryStep);

  const fromPoints = (pointsNow: number) => {
    const points = Math.max(0, pointsNow) + accrued;
    return Math.max(0, points * rules.rentenwert * factor);
  };

  if (pension.points != null) return fromPoints(pension.points);

  if (pension.mode === 'stated' && pension.statedMonthly != null && pension.statedMonthly > 0) {
    if (salary > 0 && rules.rentenwert > 0) {
      const pointsAtRegular = pension.statedMonthly / rules.rentenwert;
      const yearsToRegular = Math.max(0, rules.regularPensionAge - currentAge);
      const pointsNow = pointsAtRegular - yearsToRegular * perYear;
      return fromPoints(pointsNow);
    }
    return Math.max(0, pension.statedMonthly * factor);
  }

  if (pension.contributionYears != null && salary > 0) {
    return fromPoints(pension.contributionYears * perYear);
  }
  return 0;
}

/** Entgeltpunkte earned over `years` of work. A zero raise matches salary × years / average earnings. */
function pointsFromSalary(
  monthly: number,
  increase: PaymentIncrease,
  years: number,
  durchschnitt: number,
  capMonthly = 0,
  step?: { startMonth: number; monthly: number } | null,
): number {
  const pay = pensionableMonthly(monthly, capMonthly);
  if (durchschnitt <= 0 || pay <= 0 || years <= 0) return 0;
  const months = years * 12;
  const capped = (amount: number) => pensionableMonthly(amount, capMonthly);
  const at = (month: number) => {
    if (step && step.monthly > 0 && month >= step.startMonth) {
      return capped(grownMonthly(step.monthly, increase, month - step.startMonth));
    }
    return capped(grownMonthly(pay, increase, month));
  };
  if (!increase.value && !step) return (pay * months) / durchschnitt;
  let points = 0;
  const whole = Math.floor(months);
  for (let month = 0; month < whole; month++) points += at(month) / durchschnitt;
  const fraction = months - whole;
  if (fraction > 0) points += (at(whole) / durchschnitt) * fraction;
  return points;
}

function includedPeople(req: SolveRequest): RetirementPersonInput[] {
  if (req.scope === 'household') return req.people;
  return req.people.filter((person) => person.id === 'self');
}

function isDrawdown(account: RetirementAccount): boolean {
  return !(account.treatment === 'income' && (account.incomeMonthly ?? 0) > 0);
}

interface SimResult {
  ok: boolean;
  runsOutAge: number | null;
  path: PathYear[];
  statePensionNetMonthly: number;
  otherIncomeMonthly: number;
}

function simulate(req: SolveRequest, people: RetirementPersonInput[], stopOffset: number, now: Date): SimResult {
  const assumptions = req.assumptions;
  const accounts = req.accounts.map((account) => {
    const share = req.scope === 'individual' ? selfShare(account) : 1;
    const balanceShare = req.scope === 'individual' ? account.balanceShare ?? share : 1;
    if (share === 1 && balanceShare === 1) return account;
    return {
      ...account,
      balance: account.balance * balanceShare,
      monthlyContribution: account.monthlyContribution * share,
      incomeMonthly: account.incomeMonthly == null ? null : account.incomeMonthly * share,
    };
  });
  const agesNow: Record<string, number> = {};
  for (const person of people) agesNow[person.id] = ageYears(person.birthDate as string, now);
  const primary = people.find((person) => person.id === 'self') ?? people[0];
  const youngest = Math.min(...people.map((person) => agesNow[person.id]));
  const yearsToHorizon = assumptions.horizonAge - youngest;
  const months = Math.max(0, Math.ceil(yearsToHorizon * 12));

  const portfolioAccounts = accounts.filter((account) => {
    if (!isDrawdown(account)) return false;
    if (req.scope === 'individual' && account.owner !== 'self' && account.owner !== 'joint') return false;
    return true;
  });
  const adjusted = adjustAccounts(
    portfolioAccounts.map((account): ProjectAccount => ({
      id: account.id,
      name: account.id,
      balance: account.balance,
      monthlyContribution: account.closed ? 0 : account.monthlyContribution,
      contributionGrowthPct: account.contributionGrowthPct,
      increaseKind: account.increaseKind,
      increaseValue: account.increaseValue,
      increaseEvery: account.increaseEvery,
      annualReturnPct: account.annualReturnPct,
      closed: account.closed,
    })),
    { extraMonthly: req.extraMonthly, returnDeltaPct: req.returnDeltaPct },
  );
  const state = adjusted.map((account) => ({ ...account }));

  const incomeAccounts = accounts.filter((account) => {
    if (isDrawdown(account)) return false;
    if (req.scope === 'individual' && account.owner !== 'self' && account.owner !== 'joint') return false;
    return true;
  });

  const incomes = (req.otherIncomes ?? []).flatMap((income) => {
    if (income.owner === 'self' || req.scope === 'household') return [income];
    if (income.owner === 'joint') return [{ ...income, monthly: income.monthly * 0.5 }];
    return [];
  });

  const claimByPerson: Record<string, number> = {};
  const grossByPerson: Record<string, number> = {};
  for (const person of people) {
    const ageNow = agesNow[person.id];
    const stopAge = ageNow + stopOffset;
    const claim = Math.max(stopAge, assumptions.earliestPensionAge);
    claimByPerson[person.id] = claim;
    grossByPerson[person.id] = statePensionGrossMonthly({
      pension: person.pension,
      currentAge: ageNow,
      stopAge,
      claimAge: claim,
      rules: assumptions,
    });
  }

  const ownerAge = (owner: string) => {
    if (owner === 'joint' || owner === 'self') return agesNow.self ?? agesNow[primary.id];
    return agesNow[owner] ?? agesNow.self ?? agesNow[primary.id];
  };

  const monthMoney = (yearOffset: number) => {
    const infl = (1 + assumptions.inflationPct / 100) ** yearOffset;
    const pensionGrowth = (1 + assumptions.pensionGrowthPct / 100) ** yearOffset;
    let pension = 0;
    const statePension: Record<string, number> = {};
    const accountIncome: Record<string, number> = {};
    for (const person of people) {
      const age = agesNow[person.id] + yearOffset;
      if (age + 1e-9 >= claimByPerson[person.id]) {
        const amount = grossByPerson[person.id] * (person.netFactor ?? assumptions.pensionNetFactor) * pensionGrowth;
        statePension[person.id] = amount;
        pension += amount;
      }
    }
    for (const account of incomeAccounts) {
      const start = account.incomeStartAge ?? assumptions.regularPensionAge;
      if (ownerAge(account.owner) + yearOffset + 1e-9 >= start) {
        const amount = (account.incomeMonthly ?? 0) * infl;
        accountIncome[account.id] = amount;
        pension += amount;
      }
    }
    const other: Record<string, number> = {};
    let otherTotal = 0;
    const month = Math.round(yearOffset * 12);
    for (const income of incomes) {
      if (month < income.startMonth || (income.endMonth != null && month >= income.endMonth)) continue;
      const amount = income.monthly * (income.indexed ? infl : 1);
      other[income.id] = amount;
      otherTotal += amount;
    }
    return { spending: req.spendingMonthly * infl, pension: pension + otherTotal, statePension, accountIncome, other };
  };

  const salaryAt = (month: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const person of people) {
      const net = person.netSalaryMonthly ?? 0;
      if (net > 0) out[person.id] = grownMonthly(net, person.pension.salaryIncrease ?? { kind: 'percent', value: 0, every: 'year' }, month);
    }
    return out;
  };

  const portfolioOf = () => state.reduce((sum, account) => sum + account.balance, 0);
  const path: PathYear[] = [];
  const yearly = (record: Record<string, number>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value * 12]));
  const snapshot = (month: number, money: ReturnType<typeof monthMoney>, drawMonthly: number, working: boolean, salaryMonth: number) => {
    const yearOffset = month / 12;
    const ages: Record<string, number> = {};
    for (const person of people) ages[person.id] = agesNow[person.id] + yearOffset;
    path.push({
      yearOffset,
      ages,
      portfolio: portfolioOf(),
      byAccount: Object.fromEntries(state.map((account) => [account.id, account.balance])),
      spendingAnnual: money.spending * 12,
      pensionAnnual: money.pension * 12,
      income: {
        salary: working ? yearly(salaryAt(salaryMonth)) : {},
        statePension: yearly(money.statePension),
        accounts: yearly(money.accountIncome),
        other: yearly(money.other),
        portfolioDraw: drawMonthly * 12,
      },
    });
  };

  const opening = monthMoney(0);
  const workingAtStart = stopOffset > 1e-9;
  snapshot(0, opening, workingAtStart ? 0 : Math.max(0, opening.spending - opening.pension), workingAtStart, 0);

  let ok = true;
  let runsOutAge: number | null = null;
  for (let month = 0; month < months; month++) {
    const yearOffset = month / 12;
    const money = monthMoney(yearOffset);
    const { spending, pension } = money;
    const working = yearOffset < stopOffset - 1e-9;
    for (const account of state) {
      const contribution = working && !account.closed
        ? grownMonthly(account.monthlyContribution, increaseFrom(account), month)
        : 0;
      account.balance = account.balance * (1 + monthlyRate(account.annualReturnPct)) + contribution;
    }
    const withdrawal = working ? 0 : Math.max(0, spending - pension);
    const total = portfolioOf();
    if (withdrawal > total + 0.01) {
      ok = false;
      runsOutAge = (agesNow[primary.id] ?? 0) + yearOffset;
      for (const account of state) account.balance = 0;
      snapshot(month + 1, money, withdrawal, working, month);
      break;
    }
    if (withdrawal > 0 && total > 0) {
      const keep = (total - withdrawal) / total;
      for (const account of state) account.balance *= keep;
    }
    if ((month + 1) % 12 === 0 || month + 1 === months) snapshot(month + 1, money, withdrawal, working, month);
  }

  let statePensionNetMonthly = 0;
  for (const person of people) statePensionNetMonthly += grossByPerson[person.id] * (person.netFactor ?? assumptions.pensionNetFactor);
  if (stopOffset >= yearsToHorizon - 1e-9) ok = false;
  let otherIncomeMonthly = 0;
  for (const account of incomeAccounts) otherIncomeMonthly += account.incomeMonthly ?? 0;

  return { ok, runsOutAge, path, statePensionNetMonthly, otherIncomeMonthly };
}

export function retirementAtAge(req: SolveRequest, stopAge: number): ScenarioResult {
  const now = req.now ?? new Date();
  const people = includedPeople(req);
  const missing = people.find((person) => !person.birthDate);
  if (!people.length || missing) return missingBirth(missing);
  const primary = people.find((person) => person.id === 'self') ?? people[0];
  const primaryAge = ageYears(primary.birthDate as string, now);
  const stopOffset = Math.max(0, stopAge - primaryAge);
  const sim = simulate(req, people, stopOffset, now);
  const agesAtRetirement: Record<string, number> = {};
  for (const person of people) agesAtRetirement[person.id] = ageYears(person.birthDate as string, now) + stopOffset;
  return {
    ok: sim.ok,
    stopOffset,
    agesAtRetirement,
    runsOutAge: sim.ok ? null : sim.runsOutAge,
    path: sim.path,
    statePensionNetMonthly: sim.statePensionNetMonthly,
    otherIncomeMonthly: sim.otherIncomeMonthly,
  };
}

function missingBirth(missing: RetirementPersonInput | undefined): ScenarioResult {
  return {
    ok: false,
    reason: 'missing-birth',
    missingPersonId: missing?.id,
    stopOffset: null,
    agesAtRetirement: {},
    runsOutAge: null,
    path: [],
    statePensionNetMonthly: 0,
    otherIncomeMonthly: 0,
  };
}

export function earliestRetirement(req: SolveRequest): ScenarioResult {
  const now = req.now ?? new Date();
  const people = includedPeople(req);
  const missing = people.find((person) => !person.birthDate);
  if (!people.length || missing) return missingBirth(missing);

  const primary = people.find((person) => person.id === 'self') ?? people[0];
  const primaryAge = ageYears(primary.birthDate as string, now);
  const maxOffset = Math.max(0, Math.ceil(70 - primaryAge));
  let last: SimResult | null = null;
  let foundOffset: number | null = null;
  for (let offset = 0; offset <= maxOffset; offset++) {
    const sim = simulate(req, people, offset, now);
    last = sim;
    if (sim.ok) {
      foundOffset = offset;
      break;
    }
  }
  const sim = last as SimResult;
  const stopOffset = foundOffset;
  const agesAtRetirement: Record<string, number> = {};
  if (stopOffset != null) {
    for (const person of people) agesAtRetirement[person.id] = ageYears(person.birthDate as string, now) + stopOffset;
  }
  return {
    ok: stopOffset != null,
    stopOffset,
    agesAtRetirement,
    runsOutAge: stopOffset == null ? sim.runsOutAge : null,
    path: sim.path,
    statePensionNetMonthly: sim.statePensionNetMonthly,
    otherIncomeMonthly: sim.otherIncomeMonthly,
  };
}

function deltaYears(scenario: ScenarioResult, base: ScenarioResult): number | null {
  if (scenario.stopOffset == null || base.stopOffset == null) return null;
  return scenario.stopOffset - base.stopOffset;
}

export function solveRetirement(
  req: SolveRequest,
  lifestyle?: { leanSpendingMonthly: number; comfortableSpendingMonthly: number },
): RetirementSolution {
  const spread = req.assumptions.scenarioSpreadPct;
  const pessimistic = earliestRetirement({ ...req, returnDeltaPct: (req.returnDeltaPct ?? 0) - spread });
  const base = earliestRetirement(req);
  const optimistic = earliestRetirement({ ...req, returnDeltaPct: (req.returnDeltaPct ?? 0) + spread });

  const row = (id: string, label: string, scenario: ScenarioResult): SensitivityRow => ({
    id,
    label,
    stopOffset: scenario.stopOffset,
    deltaYears: deltaYears(scenario, base),
  });

  const sensitivity: SensitivityRow[] = [
    row('extra-200', 'Save €200 more per month', earliestRetirement({ ...req, extraMonthly: (req.extraMonthly ?? 0) + 200 })),
    row('less-200', 'Save €200 less per month', earliestRetirement({ ...req, extraMonthly: (req.extraMonthly ?? 0) - 200 })),
    row('return-up', 'Return 1 point higher', earliestRetirement({ ...req, returnDeltaPct: (req.returnDeltaPct ?? 0) + 1 })),
    row('return-down', 'Return 1 point lower', earliestRetirement({ ...req, returnDeltaPct: (req.returnDeltaPct ?? 0) - 1 })),
  ];
  if (lifestyle) {
    sensitivity.push(
      row('lean', 'Lean lifestyle', earliestRetirement({ ...req, spendingMonthly: lifestyle.leanSpendingMonthly })),
      row('comfortable', 'Comfortable lifestyle', earliestRetirement({ ...req, spendingMonthly: lifestyle.comfortableSpendingMonthly })),
    );
  }

  return { pessimistic, base, optimistic, sensitivity };
}
