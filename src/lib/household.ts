/**
 * The household money model, entered in setup. It replaces any link to bank data.
 *
 * Joint: both take-home pays go into one pot. Each person takes a personal allowance out of it.
 * The pot pays rent, other shared costs, and the joint investments. Personal investments are paid
 * out of that person's allowance, so their living cost is the allowance minus those contributions.
 *
 * Solo: rent plus other monthly spending. There is no pot and no partner.
 */

import { incomeActive, todayIso, type HouseholdMode, type OtherIncome, type OwnerId, type RetirementScope } from './types';

export interface HouseholdAccount {
  owner: OwnerId;
  monthlyContribution: number;
  closedOn: string | null;
}

export interface HouseholdInput {
  mode: HouseholdMode;
  selfNetMonthly: number;
  partnerNetMonthly: number;
  selfAllowanceMonthly: number;
  partnerAllowanceMonthly: number;
  rentMonthly: number;
  sharedSpendMonthly: number;
  accounts: HouseholdAccount[];
  /** Other incomes such as Kindergeld. Those paid into the pot (all of them in solo mode) add to what comes in. */
  incomes?: Pick<OtherIncome, 'amountMonthly' | 'intoPot' | 'startsOn' | 'endsOn'>[];
  /** Date used to decide which incomes are being paid. Defaults to today. */
  today?: string;
}

export interface Pot {
  inMonthly: number;
  /** The part of inMonthly that is not take-home pay. */
  otherInMonthly: number;
  allowancesMonthly: number;
  rentMonthly: number;
  sharedSpendMonthly: number;
  jointInvestMonthly: number;
  outMonthly: number;
  /** In minus out. Negative means the plan spends more than comes in. */
  unallocatedMonthly: number;
  selfInvestMonthly: number;
  partnerInvestMonthly: number;
  /** Allowance left after personal investments: what each person actually lives on. */
  selfLivingMonthly: number;
  partnerLivingMonthly: number;
}

function openContributions(accounts: HouseholdAccount[], owner: OwnerId): number {
  return accounts
    .filter((account) => account.owner === owner && !account.closedOn)
    .reduce((sum, account) => sum + Math.max(0, account.monthlyContribution), 0);
}

export function pot(input: HouseholdInput): Pot {
  const selfInvest = openContributions(input.accounts, 'self');
  const partnerInvest = openContributions(input.accounts, 'partner');
  const selfLiving = Math.max(0, input.selfAllowanceMonthly - selfInvest);
  const partnerLiving = Math.max(0, input.partnerAllowanceMonthly - partnerInvest);
  const today = input.today ?? todayIso();
  const otherIn = (input.incomes ?? [])
    .filter((income) => (input.mode === 'solo' || income.intoPot) && incomeActive(income, today))
    .reduce((sum, income) => sum + Math.max(0, income.amountMonthly), 0);
  if (input.mode === 'solo') {
    const inMonthly = Math.max(0, input.selfNetMonthly) + otherIn;
    const outMonthly = input.rentMonthly + input.sharedSpendMonthly + selfInvest + openContributions(input.accounts, 'joint');
    return {
      inMonthly,
      otherInMonthly: otherIn,
      allowancesMonthly: 0,
      rentMonthly: input.rentMonthly,
      sharedSpendMonthly: input.sharedSpendMonthly,
      jointInvestMonthly: openContributions(input.accounts, 'joint'),
      outMonthly,
      unallocatedMonthly: inMonthly - outMonthly,
      selfInvestMonthly: selfInvest,
      partnerInvestMonthly: 0,
      selfLivingMonthly: input.sharedSpendMonthly,
      partnerLivingMonthly: 0,
    };
  }
  const inMonthly = Math.max(0, input.selfNetMonthly) + Math.max(0, input.partnerNetMonthly) + otherIn;
  const allowances = Math.max(0, input.selfAllowanceMonthly) + Math.max(0, input.partnerAllowanceMonthly);
  const jointInvest = openContributions(input.accounts, 'joint');
  const outMonthly = allowances + input.rentMonthly + input.sharedSpendMonthly + jointInvest;
  return {
    inMonthly,
    otherInMonthly: otherIn,
    allowancesMonthly: allowances,
    rentMonthly: input.rentMonthly,
    sharedSpendMonthly: input.sharedSpendMonthly,
    jointInvestMonthly: jointInvest,
    outMonthly,
    unallocatedMonthly: inMonthly - outMonthly,
    selfInvestMonthly: selfInvest,
    partnerInvestMonthly: partnerInvest,
    selfLivingMonthly: selfLiving,
    partnerLivingMonthly: partnerLiving,
  };
}

/** Your fraction of joint take-home. Missing either pay means there is no split to weight by. */
export function incomeShare(selfNet: number, partnerNet: number): number | null {
  if (!(selfNet > 0) || !(partnerNet > 0)) return null;
  return selfNet / (selfNet + partnerNet);
}

export interface RetirementSpendingInput extends HouseholdInput {
  scope: RetirementScope;
  lifestyle: number;
  /** Your share of rent and shared costs in Just me. Null means weighted by take-home pay, or half without both pays. */
  sharedCostShare: number | null;
  /** Replaces the model's non-housing figure, before the lifestyle multiplier. */
  spendingOverride: number | null;
  housingOverride: number | null;
}

/**
 * Monthly spending in retirement, in today's euros. Investment contributions stop when work stops,
 * so neither joint nor personal contributions are part of it.
 */
export function retirementSpending(input: RetirementSpendingInput) {
  const p = pot(input);
  const solo = input.mode === 'solo';
  const share = solo
    ? 1
    : input.sharedCostShare ?? incomeShare(input.selfNetMonthly, input.partnerNetMonthly) ?? 0.5;
  const household = input.scope === 'household' && !solo;
  const housingBase = household ? input.rentMonthly : input.rentMonthly * share;
  const otherBase = solo
    ? input.sharedSpendMonthly
    : household
      ? input.sharedSpendMonthly + p.selfLivingMonthly + p.partnerLivingMonthly
      : input.sharedSpendMonthly * share + p.selfLivingMonthly;
  const otherAtCurrent = input.spendingOverride ?? otherBase;
  const housingAtCurrent = input.housingOverride ?? housingBase;
  const otherMonthly = otherAtCurrent * input.lifestyle;
  const housingMonthly = housingAtCurrent * input.lifestyle;
  return {
    pot: p,
    share,
    otherBase,
    housingBase,
    otherMonthly,
    housingMonthly,
    totalMonthly: otherMonthly + housingMonthly,
    leanMonthly: (otherAtCurrent + housingAtCurrent) * 0.8,
    comfortableMonthly: (otherAtCurrent + housingAtCurrent) * 1.25,
  };
}
