/** Hand-entered investment, income and retirement data. Stored in data/scrooge.sqlite. */

export const ACCOUNT_TYPES = [
  { id: 'etf', label: 'ETF / index fund', defaultReturn: 7, defaultRisk: 'medium' },
  { id: 'stocks', label: 'Stocks', defaultReturn: 8, defaultRisk: 'high' },
  { id: 'savings', label: 'Savings account', defaultReturn: 2, defaultRisk: 'low' },
  { id: 'fixed_term', label: 'Fixed-term deposit', defaultReturn: 2.5, defaultRisk: 'low' },
  { id: 'crypto', label: 'Crypto', defaultReturn: 8, defaultRisk: 'high' },
  { id: 'bav', label: 'Workplace pension (bAV)', defaultReturn: 4, defaultRisk: 'low' },
  { id: 'riester', label: 'Riester / Rürup', defaultReturn: 3, defaultRisk: 'low' },
  { id: 'private_pension', label: 'Private pension insurance', defaultReturn: 3, defaultRisk: 'low' },
  { id: 'real_estate', label: 'Real estate equity', defaultReturn: 3, defaultRisk: 'medium' },
  { id: 'cash', label: 'Cash', defaultReturn: 0, defaultRisk: 'low' },
  { id: 'other', label: 'Other', defaultReturn: 4, defaultRisk: 'medium' },
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number]['id'];
export type Risk = 'low' | 'medium' | 'high';
export type PersonId = 'self' | 'partner';
export type OwnerId = PersonId | 'joint';
export type HouseholdMode = 'solo' | 'joint';

/** Your fraction of an account. Your own accounts are all yours, your partner's are none, a joint account uses the share you set. */
export function selfShare(account: { owner: string; ownerShare?: number | null }): number {
  if (account.owner === 'partner') return 0;
  if (account.owner === 'self') return 1;
  if (account.owner !== 'joint') return 0;
  const share = account.ownerShare;
  if (share == null || !Number.isFinite(share)) return 0.5;
  return Math.min(1, Math.max(0, share));
}

/** Your partner's fraction. The rest of a joint account is theirs. */
export function partnerShare(account: { owner: string; ownerShare?: number | null }): number {
  if (account.owner === 'partner') return 1;
  if (account.owner === 'self') return 0;
  if (account.owner !== 'joint') return 0;
  return 1 - selfShare(account);
}
export type PensionMode = 'stated' | 'estimate';
/** Portfolio compounds and is drawn down. Income pays a monthly amount and is not also drawn down. */
export type AccountTreatment = 'portfolio' | 'income';
export type RetirementScope = 'individual' | 'household';

export interface Person {
  id: PersonId;
  name: string;
  birthDate: string | null;
  pensionMode: PensionMode;
  /** Gross monthly pension the Renteninformation projects at the regular retirement age, if contributions continue. */
  pensionStatedMonthly: number | null;
  /** Entgeltpunkte already earned. */
  pensionPoints: number | null;
  grossSalaryMonthly: number | null;
  /** Take-home pay per month. This is not used as Entgeltpunkte. */
  netSalaryMonthly: number | null;
  /** Years already contributed, used only when points are unknown. */
  contributionYears: number | null;
  /** Raise applied to net salary, and to gross salary when that is set. */
  salaryIncreaseKind: 'percent' | 'amount';
  salaryIncreaseValue: number;
  salaryIncreaseEvery: 'year' | 'month';
  /** Employee pension contribution on a payslip, euros per month. */
  payslipRvMonthly: number | null;
  /** Employee health contribution (the 7.3% line), euros per month. */
  payslipKvMonthly: number | null;
  /** Employee share of the Zusatzbeitrag, euros per month. */
  payslipZusatzMonthly: number | null;
  /** Full Zusatzbeitrag rate of the health fund, in percent. */
  payslipZusatzRatePct: number | null;
  /** Taken out of the shared pot each month for personal spending. Personal investments come out of this. */
  personalAllowanceMonthly: number | null;
}

export interface Account {
  id: string;
  owner: OwnerId;
  name: string;
  type: AccountType;
  openedOn: string | null;
  monthlyContribution: number;
  /** Kept in step with a percent-per-year increase so older readers still see it. */
  contributionGrowthPct: number;
  contributionIncreaseKind: 'percent' | 'amount';
  contributionIncreaseValue: number;
  contributionIncreaseEvery: 'year' | 'month';
  expectedReturnPct: number;
  interestRatePct: number | null;
  risk: Risk;
  notes: string;
  closedOn: string | null;
  treatment: AccountTreatment;
  incomeMonthly: number | null;
  incomeStartAge: number | null;
  /**
   * Your fraction of a joint account, from 0 to 1. Your accounts stay at 1 and your partner's at 0.
   * New contributions are always split this way. The balance is too, unless a portion is set below.
   */
  ownerShare: number;
  /**
   * Joint accounts only: a date with a balance snapshot on which you know how much of the balance was yours,
   * for example the day it became joint. From then on your part grows with the account and contributions
   * are split by ownerShare. Null means the balance is split by ownerShare too.
   */
  portionDate: string | null;
  /** Your part of the balance on portionDate, in euros. */
  portionSelf: number | null;
  /** Money you could take out now without heavy tax or penalties. A pension policy usually is not. */
  accessible: boolean;
  /**
   * What went in each month in the past, oldest first. Once there is any, months it does not cover count as
   * paused. Projections still use monthlyContribution and its increase; this only describes the past.
   */
  contributionHistory: ContributionPeriod[];
}

/** A stretch of months with the same monthly contribution. Months are YYYY-MM and inclusive. */
export interface ContributionPeriod {
  fromMonth: string;
  /** Null means it is still going. */
  toMonth: string | null;
  amountMonthly: number;
  note: string;
}

export interface Balance {
  id: number;
  accountId: string;
  date: string;
  balance: number;
  /** Net money paid in (negative = taken out) since the previous snapshot. Null means it went as planned. */
  contributed: number | null;
  note: string;
}

export interface FinanceSettings {
  inflationPct: number;
  horizonAge: number;
  scenarioSpreadPct: number;
  pensionNetFactor: number;
  pensionGrowthPct: number;
  /** Provisional average earnings (Durchschnittsentgelt), euros per year. */
  durchschnittsentgeltAnnual: number;
  /** Current pension value per Entgeltpunkt, euros per month. */
  rentenwert: number;
  /** Beitragsbemessungsgrenze, euros per month. Pay above this earns no extra pension points. */
  contributionCapMonthly: number;
  /** Share of the pension kept after income tax, applied only when a payslip Zusatzbeitrag is set. */
  pensionTaxKeep: number;
  regularPensionAge: number;
  earliestPensionAge: number;
  withdrawal: 'gap';
  lifestyle: number;
  retirementScope: RetirementScope;
  /** False until the setup flow has been completed once. */
  onboarded: boolean;
  householdMode: HouseholdMode;
  /** Rent or housing cost for the whole household, euros per month. */
  rentMonthly: number;
  /** Shared costs from the pot other than rent and investments: food, holidays, utilities, childcare. In solo mode, your other spending. */
  sharedSpendMonthly: number;
  /** Your share of shared costs for Just me retirement. Null means weighted by take-home pay. */
  sharedCostShare: number | null;
  /** Null means "use the household model". */
  spendingPersonalMonthly: number | null;
  spendingHouseholdMonthly: number | null;
  housingPersonalMonthly: number | null;
  housingHouseholdMonthly: number | null;
}

/** Money that is not salary: Kindergeld, rent from a flat, a side business. Euros per month, today's value. */
export interface OtherIncome {
  id: string;
  owner: OwnerId;
  name: string;
  amountMonthly: number;
  /** First month it is paid, YYYY-MM-DD. Null means it is already being paid. */
  startsOn: string | null;
  /** First month it is no longer paid. Null means it does not stop. */
  endsOn: string | null;
  /** Paid into the household pot. Off means it is kept by its owner. */
  intoPot: boolean;
  /** Rises with inflation, so the amount stays the same in today's euros. */
  indexed: boolean;
  notes: string;
}

export type IncomeWrite = Omit<OtherIncome, 'id'>;

export interface FinanceData {
  people: Person[];
  accounts: Account[];
  balances: Balance[];
  incomes: OtherIncome[];
  settings: FinanceSettings;
}

/** Whether an income is being paid on a date. */
export function incomeActive(income: Pick<OtherIncome, 'startsOn' | 'endsOn'>, on: string): boolean {
  if (income.startsOn && income.startsOn > on) return false;
  if (income.endsOn && income.endsOn <= on) return false;
  return true;
}

export interface AccountWrite {
  owner: OwnerId;
  name: string;
  type: AccountType;
  openedOn?: string | null;
  monthlyContribution?: number;
  contributionGrowthPct?: number;
  contributionIncreaseKind?: 'percent' | 'amount';
  contributionIncreaseValue?: number;
  contributionIncreaseEvery?: 'year' | 'month';
  expectedReturnPct?: number;
  interestRatePct?: number | null;
  risk?: Risk;
  notes?: string;
  closedOn?: string | null;
  treatment?: AccountTreatment;
  incomeMonthly?: number | null;
  incomeStartAge?: number | null;
  /** Your fraction when the owner is joint. Ignored for an account owned by one person. */
  ownerShare?: number;
  portionDate?: string | null;
  portionSelf?: number | null;
  accessible?: boolean;
  /** Replaces the whole history when given. */
  contributionHistory?: ContributionPeriod[];
  balance?: number;
  balanceDate?: string | null;
}

export interface BalanceWrite {
  accountId: string;
  date: string;
  balance: number;
  contributed?: number | null;
  note?: string;
}

/** July 2026 statutory figures. Editable in the retirement assumptions. */
export const DEFAULT_SETTINGS: FinanceSettings = {
  inflationPct: 2,
  horizonAge: 95,
  scenarioSpreadPct: 2,
  pensionNetFactor: 0.85,
  pensionGrowthPct: 1.5,
  durchschnittsentgeltAnnual: 51944,
  rentenwert: 42.52,
  contributionCapMonthly: 8450,
  pensionTaxKeep: 0.9,
  regularPensionAge: 67,
  earliestPensionAge: 63,
  withdrawal: 'gap',
  lifestyle: 1,
  retirementScope: 'individual',
  onboarded: false,
  householdMode: 'joint',
  rentMonthly: 0,
  sharedSpendMonthly: 0,
  sharedCostShare: null,
  spendingPersonalMonthly: null,
  spendingHouseholdMonthly: null,
  housingPersonalMonthly: null,
  housingHouseholdMonthly: null,
};

/** Types that are usually locked until retirement. New accounts of these types start as not accessible. */
export const LOCKED_TYPES: readonly AccountType[] = ['bav', 'riester', 'private_pension'];

export function accountTypeInfo(type: AccountType) {
  return ACCOUNT_TYPES.find((t) => t.id === type) ?? ACCOUNT_TYPES[ACCOUNT_TYPES.length - 1];
}

export function latestBalance(balances: Balance[], accountId: string): Balance | null {
  let best: Balance | null = null;
  for (const row of balances) {
    if (row.accountId !== accountId) continue;
    if (!best || row.date > best.date || (row.date === best.date && row.id > best.id)) best = row;
  }
  return best;
}

export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function balancesFor(balances: Balance[], accountId: string): Balance[] {
  return balances
    .filter((row) => row.accountId === accountId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

export function personName(people: Person[], id: PersonId, fallback = id === 'self' ? 'You' : 'Partner'): string {
  return people.find((person) => person.id === id)?.name || fallback;
}
