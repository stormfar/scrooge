import { useMemo } from 'react';
import { retirementSpending } from '../lib/household';
import {
  pensionKeepAfterSocial,
  solveRetirement,
  type PensionFields,
  type SolveRequest,
} from '../lib/retirement';
import { monthsBetween } from '../lib/calibration';
import { balanceSplit } from '../lib/portion';
import { latestBalance, todayIso, type FinanceData, type Person } from '../lib/types';

export function pensionOf(person: Person): PensionFields {
  return {
    mode: person.pensionMode,
    statedMonthly: person.pensionStatedMonthly,
    points: person.pensionPoints,
    grossSalaryMonthly: person.grossSalaryMonthly,
    contributionYears: person.contributionYears,
    salaryIncrease: {
      kind: person.salaryIncreaseKind,
      value: person.salaryIncreaseValue,
      every: 'year',
    },
  };
}

/** Spending in retirement from the household setup and the saved overrides. */
export function spendingFor(finance: FinanceData) {
  const self = finance.people.find((person) => person.id === 'self');
  const partner = finance.people.find((person) => person.id === 'partner');
  const scope = finance.settings.householdMode === 'solo' ? 'individual' : finance.settings.retirementScope;
  return retirementSpending({
    mode: finance.settings.householdMode,
    scope,
    selfNetMonthly: self?.netSalaryMonthly ?? 0,
    partnerNetMonthly: partner?.netSalaryMonthly ?? 0,
    selfAllowanceMonthly: self?.personalAllowanceMonthly ?? 0,
    partnerAllowanceMonthly: partner?.personalAllowanceMonthly ?? 0,
    rentMonthly: finance.settings.rentMonthly,
    sharedSpendMonthly: finance.settings.sharedSpendMonthly,
    accounts: finance.accounts,
    incomes: finance.incomes,
    lifestyle: finance.settings.lifestyle,
    sharedCostShare: finance.settings.sharedCostShare,
    spendingOverride: scope === 'individual' ? finance.settings.spendingPersonalMonthly : finance.settings.spendingHouseholdMonthly,
    housingOverride: scope === 'individual' ? finance.settings.housingPersonalMonthly : finance.settings.housingHouseholdMonthly,
  });
}

/** The solver request both Retirement and Income use, so the two pages always show the same plan. */
export function planRequest(finance: FinanceData, leftOut: string[] = [], now = new Date()): SolveRequest {
  const spending = spendingFor(finance);
  const scope = finance.settings.householdMode === 'solo' ? 'individual' : finance.settings.retirementScope;
  return {
    people: finance.people.map((person) => ({
      id: person.id,
      name: person.name,
      birthDate: person.birthDate,
      pension: pensionOf(person),
      netFactor: person.payslipZusatzRatePct == null
        ? null
        : pensionKeepAfterSocial(person.payslipZusatzRatePct) * finance.settings.pensionTaxKeep,
      netSalaryMonthly: person.netSalaryMonthly,
    })),
    accounts: finance.accounts.filter((account) => !leftOut.includes(account.id)).map((account) => ({
      id: account.id,
      owner: account.owner,
      balance: latestBalance(finance.balances, account.id)?.balance ?? 0,
      monthlyContribution: account.monthlyContribution,
      contributionGrowthPct: account.contributionGrowthPct,
      increaseKind: account.contributionIncreaseKind,
      increaseValue: account.contributionIncreaseValue,
      increaseEvery: account.contributionIncreaseEvery,
      annualReturnPct: account.expectedReturnPct,
      treatment: account.treatment,
      incomeMonthly: account.incomeMonthly,
      incomeStartAge: account.incomeStartAge,
      closed: Boolean(account.closedOn),
      ownerShare: account.ownerShare,
      balanceShare: balanceSplit(account, finance.balances).share,
    })),
    otherIncomes: finance.incomes.map((income) => ({
      id: income.id,
      owner: income.owner,
      monthly: income.amountMonthly,
      startMonth: income.startsOn ? signedMonths(todayIso(now), income.startsOn) : 0,
      endMonth: income.endsOn ? signedMonths(todayIso(now), income.endsOn) : null,
      indexed: income.indexed,
    })),
    scope,
    spendingMonthly: spending.totalMonthly,
    assumptions: {
      inflationPct: finance.settings.inflationPct,
      horizonAge: finance.settings.horizonAge,
      scenarioSpreadPct: finance.settings.scenarioSpreadPct,
      pensionNetFactor: finance.settings.pensionNetFactor,
      pensionGrowthPct: finance.settings.pensionGrowthPct,
      durchschnittsentgeltAnnual: finance.settings.durchschnittsentgeltAnnual,
      rentenwert: finance.settings.rentenwert,
      regularPensionAge: finance.settings.regularPensionAge,
      earliestPensionAge: finance.settings.earliestPensionAge,
      contributionCapMonthly: finance.settings.contributionCapMonthly,
    },
    now,
  };
}

function signedMonths(from: string, to: string): number {
  return to >= from ? Math.round(monthsBetween(from, to)) : -Math.round(monthsBetween(to, from));
}

const NONE: string[] = [];

export function useRetirementPlan(finance: FinanceData | null, leftOut: string[] = NONE) {
  return useMemo(() => {
    if (!finance) return null;
    const now = new Date();
    const spending = spendingFor(finance);
    const request = planRequest(finance, leftOut, now);
    const solved = solveRetirement(request, {
      leanSpendingMonthly: spending.leanMonthly,
      comfortableSpendingMonthly: spending.comfortableMonthly,
    });
    return { spending, request, solved, now };
  }, [finance, leftOut]);
}
