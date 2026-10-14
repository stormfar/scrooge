/**
 * Compare the plan with what the snapshots say.
 *
 * Each snapshot is a balance on a date. A snapshot can also say how much was actually paid in (or taken out)
 * since the previous one. Otherwise the account's contribution history says what went in each month, and
 * without a history the current monthly contribution is assumed (and flagged). An account's opening date
 * counts as a starting balance of zero, so a history lets the comparison run from the very start.
 *
 * Realised return solves a steady monthly return for each gap between snapshots, with each payment on its
 * own date, so money paid in is not mistaken for growth. Nothing here changes an account; the page only suggests.
 */

import { dayBefore, flowsForGap, growWith, monthsBetween, paymentsBetween, solveRate, type FlowAccount } from './flows';
import { monthlyRate } from './projection';
import type { Balance } from './types';

export { monthsBetween } from './flows';

const DAY = 24 * 60 * 60 * 1000;

/** The minimum history before a realised return is offered as a replacement. Shorter spans are mostly noise. */
export const SUGGEST_AFTER_MONTHS = 6;

export interface CalibrationAccount extends FlowAccount {
  expectedReturnPct: number;
  closed: boolean;
}

export interface Calibration {
  snapshots: number;
  spanMonths: number;
  firstDate: string;
  lastDate: string;
  actualBalance: number;
  /** Where the plan said the balance would be on the last snapshot date, starting from the first snapshot. */
  plannedBalance: number;
  /** Actual minus planned. */
  varianceTotal: number;
  /** Paid in more (positive) or less (negative) than planned. */
  contributionGap: number;
  /** The rest of the variance: the market did better or worse than the expected return. */
  returnGap: number;
  plannedFlows: number;
  actualFlows: number;
  /** Annual percent, or null when there is not enough to measure. */
  realisedReturnPct: number | null;
  /**
   * Realised return to offer, or null when the span is short, close to the expected return,
   * or any gap between snapshots had to assume what was paid in.
   */
  suggestedReturnPct: number | null;
  /** At least one gap had neither a recorded "paid in" nor a contribution history, so the current contribution was assumed. */
  assumedFlows: boolean;
  /** The comparison starts at the opening date with a balance of zero, not at the first snapshot. */
  fromOpening: boolean;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / DAY);
}

/** Grow a balance for a number of months at the expected return, adding the contribution at each month end. */
export function plannedFrom(balance: number, account: CalibrationAccount, months: number): { balance: number; flows: number } {
  const contribution = account.closed ? 0 : Math.max(0, account.monthlyContribution);
  const rate = monthlyRate(account.expectedReturnPct);
  const whole = Math.floor(months);
  let value = balance;
  for (let month = 0; month < whole; month++) value = value * (1 + rate) + contribution;
  const part = months - whole;
  if (part > 0) value = value * (1 + rate) ** part + contribution * part;
  return { balance: value, flows: contribution * months };
}

export function calibrate(account: CalibrationAccount, snapshots: Balance[]): Calibration | null {
  const rows = snapshots.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  // With a history, the opening date is a known starting point: nothing was in the account yet.
  const fromOpening = Boolean(account.openedOn && account.contributionHistory?.length && rows.length && account.openedOn < rows[0].date);
  if (fromOpening) rows.unshift({ id: -1, accountId: rows[0].accountId, date: dayBefore(account.openedOn as string), balance: 0, contributed: null, note: '' });
  if (rows.length < 2) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const spanMonths = monthsBetween(first.date, last.date);
  if (spanMonths <= 0) return null;

  const planRate = monthlyRate(account.expectedReturnPct);
  let growth = 1;
  let measured = 0;
  let plannedFlows = 0;
  let actualFlows = 0;
  let assumedFlows = false;
  let plannedBalance = first.balance;
  for (let index = 1; index < rows.length; index++) {
    const start = rows[index - 1];
    const end = rows[index];
    const months = monthsBetween(start.date, end.date);
    if (months <= 0) continue;
    const gap = flowsForGap(account, start.date, end.date, end.contributed);
    if (gap.assumed) assumedFlows = true;
    plannedFlows += gap.planned.reduce((sum, payment) => sum + payment.amount, 0);
    actualFlows += gap.payments.reduce((sum, payment) => sum + payment.amount, 0);
    plannedBalance = growWith(plannedBalance, gap.planned, start.date, end.date, planRate);
    const g = solveRate(start.balance, gap.payments, start.date, end.date, end.balance);
    if (g == null) continue;
    growth *= (1 + g) ** months;
    measured += months;
  }

  const varianceTotal = last.balance - plannedBalance;
  const contributionGap = actualFlows - plannedFlows;
  const realisedReturnPct = measured > 0 && growth > 0 ? ((growth ** (12 / measured)) - 1) * 100 : null;
  // A realised return built on a guessed contribution is mostly the guess, so it is never offered.
  const suggestedReturnPct = realisedReturnPct != null
    && !assumedFlows
    && spanMonths >= SUGGEST_AFTER_MONTHS
    && Math.abs(realisedReturnPct - account.expectedReturnPct) >= 0.5
    ? Math.round(realisedReturnPct * 10) / 10
    : null;

  return {
    snapshots: rows.length - (fromOpening ? 1 : 0),
    spanMonths,
    firstDate: first.date,
    lastDate: last.date,
    actualBalance: last.balance,
    plannedBalance,
    varianceTotal,
    contributionGap,
    returnGap: varianceTotal - contributionGap,
    plannedFlows,
    actualFlows,
    realisedReturnPct,
    suggestedReturnPct,
    assumedFlows,
    fromOpening,
  };
}

/** Where the plan puts the balance on `date`, starting from a known balance and following the contribution history. */
export function plannedAt(account: CalibrationAccount, startBalance: number, startDate: string, date: string): number {
  const { payments } = paymentsBetween(account, startDate, date);
  return growWith(startBalance, payments, startDate, date, monthlyRate(account.expectedReturnPct));
}

/** What the plan expects the balance to be today, from the latest snapshot. Used to prefill a check-in. */
export function expectedToday(account: CalibrationAccount, latest: Balance | null, today: string): { balance: number; flows: number; months: number } | null {
  if (!latest) return null;
  const months = monthsBetween(latest.date, today);
  const { payments } = paymentsBetween(account, latest.date, today);
  return {
    balance: growWith(latest.balance, payments, latest.date, today, monthlyRate(account.expectedReturnPct)),
    flows: payments.reduce((sum, payment) => sum + payment.amount, 0),
    months,
  };
}

/** Days since the most recent snapshot on any open account. Null when nothing has been recorded. */
export function daysSinceCheckIn(balances: Balance[], openIds: Set<string>, today: string): number | null {
  let latest: string | null = null;
  for (const row of balances) {
    if (!openIds.has(row.accountId)) continue;
    if (!latest || row.date > latest) latest = row.date;
  }
  if (!latest) return null;
  return daysBetween(latest, today);
}
