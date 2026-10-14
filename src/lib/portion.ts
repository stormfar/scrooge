/**
 * Whose money is in a joint account, when it did not all go in 50/50.
 *
 * Works like fund units. On the portion date you know your part of the balance. For each gap between
 * snapshots after that, a steady monthly return is solved so the earlier balance plus that gap's
 * contributions, each on its own date, grows into the later balance. Both parts earn that same return.
 * Contributions are split by the contribution share (ownerShare). A gap's contributions come from what the
 * later snapshot says was paid in, else the contribution history, else the current monthly contribution.
 */

import { flowsForGap, growWith, solveRate } from './flows';
import { balancesFor, selfShare, type Account, type Balance } from './types';

export interface BalanceSplit {
  /** Your fraction of the newest balance. */
  share: number;
  selfAmount: number;
  partnerAmount: number;
  /** True when a portion date with a matching snapshot drives the split. */
  anchored: boolean;
  /** A portion date is set but has no snapshot on that date, so the plain share is used. */
  missingSnapshot: boolean;
}

/** Balance after `months` at a monthly rate `g`, with `flow` added at the end of each month. */
function grow(start: number, flow: number, g: number, months: number): number {
  const factor = (1 + g) ** months;
  const annuity = Math.abs(g) < 1e-12 ? months : (factor - 1) / g;
  return start * factor + flow * annuity;
}

/** The steady monthly return that turns `start` plus monthly `flow` into `end`. Null when none fits. */
export function solveMonthlyReturn(start: number, flow: number, months: number, end: number): number | null {
  let low = -0.5;
  let high = 0.5;
  const at = (g: number) => grow(start, flow, g, months) - end;
  if (at(low) > 0 || at(high) < 0) return null;
  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    if (at(mid) > 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/** Carry your part from one snapshot to the next. */
export function carryPortion(args: {
  start: number;
  end: number;
  selfStart: number;
  paidIn: number;
  months: number;
  contributionShare: number;
}): number {
  const { start, end, selfStart, paidIn, months, contributionShare } = args;
  if (months <= 0 || end <= 0) return Math.max(0, Math.min(selfStart, end));
  const flow = paidIn / months;
  const g = solveMonthlyReturn(start, flow, months, end);
  const selfEnd = g == null
    // Nothing steady fits (for example, money taken out). Split by what each side had plus what each put in.
    ? end * ((selfStart + paidIn * contributionShare) / Math.max(1e-9, start + paidIn))
    : grow(selfStart, flow * contributionShare, g, months);
  return Math.min(end, Math.max(0, selfEnd));
}

export function balanceSplit(
  account: Pick<Account, 'id' | 'owner' | 'ownerShare' | 'portionDate' | 'portionSelf' | 'monthlyContribution'>
    & Partial<Pick<Account, 'openedOn' | 'closedOn' | 'contributionHistory'>>,
  balances: Balance[],
): BalanceSplit {
  const rows = balancesFor(balances, account.id);
  const latest = rows[rows.length - 1]?.balance ?? 0;
  const plain = selfShare(account);
  const fallback = (missingSnapshot: boolean): BalanceSplit => ({
    share: plain,
    selfAmount: latest * plain,
    partnerAmount: latest * (1 - plain),
    anchored: false,
    missingSnapshot,
  });
  if (account.owner !== 'joint' || !account.portionDate || account.portionSelf == null) return fallback(false);
  const anchor = rows.findIndex((row) => row.date === account.portionDate);
  if (anchor < 0) return fallback(true);

  let selfAmount = Math.min(account.portionSelf, Math.max(0, rows[anchor].balance));
  for (let index = anchor + 1; index < rows.length; index++) {
    const before = rows[index - 1];
    const after = rows[index];
    const { payments } = flowsForGap(account, before.date, after.date, after.contributed);
    const g = solveRate(before.balance, payments, before.date, after.date, after.balance);
    const paidIn = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const next = g == null
      // Nothing steady fits (for example, money taken out). Split by what each side had plus what each put in.
      ? after.balance * ((selfAmount + paidIn * plain) / Math.max(1e-9, before.balance + paidIn))
      : growWith(selfAmount, payments.map((payment) => ({ ...payment, amount: payment.amount * plain })), before.date, after.date, g);
    selfAmount = Math.min(Math.max(0, after.balance), Math.max(0, next));
  }
  const total = rows[rows.length - 1].balance;
  return {
    share: total > 0 ? selfAmount / total : plain,
    selfAmount,
    partnerAmount: Math.max(0, total - selfAmount),
    anchored: true,
    missingSnapshot: false,
  };
}
