/**
 * Money going into an account over time, month by month.
 *
 * A contribution lands once a month, on the day of the month the account was opened (the 1st when that is
 * unknown). With a contribution history, the history decides each month's amount and months it does not
 * cover count as paused. Without one, the account's current monthly contribution is assumed for every month,
 * and the result says so.
 */

import type { ContributionPeriod } from './types';

export interface FlowAccount {
  monthlyContribution: number;
  openedOn?: string | null;
  closedOn?: string | null;
  contributionHistory?: ContributionPeriod[];
}

export interface Payment {
  date: string;
  amount: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar months from one date to another; days count as a fraction of the starting month. */
export function monthsBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (![y1, m1, d1, y2, m2, d2].every(Number.isFinite)) return 0;
  const daysInMonth = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / daysInMonth);
}

/** The day before a date. The "since opening" start uses it, so a contribution on the opening day counts. */
export function dayBefore(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

function paymentDay(account: FlowAccount): number {
  const day = account.openedOn ? Number(account.openedOn.slice(8, 10)) : 1;
  return Number.isFinite(day) ? Math.min(28, Math.max(1, day)) : 1;
}

/** The amount for a month (YYYY-MM) from the history, or null when no period covers it. */
export function historyAmount(history: ContributionPeriod[], month: string): number | null {
  for (const period of history) {
    if (month >= period.fromMonth && (period.toMonth == null || month <= period.toMonth)) return period.amountMonthly;
  }
  return null;
}

/** Contributions that land after `from` and on or before `to`. */
export function paymentsBetween(account: FlowAccount, from: string, to: string): { payments: Payment[]; assumed: boolean } {
  const history = account.contributionHistory ?? [];
  const day = paymentDay(account);
  const payments: Payment[] = [];
  let assumed = false;
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  for (let guard = 0; guard < 2400; guard++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    if (date > to) break;
    const inRange = date > from
      && (!account.openedOn || date >= account.openedOn)
      && (!account.closedOn || date < account.closedOn);
    if (inRange) {
      if (history.length) {
        const amount = historyAmount(history, date.slice(0, 7)) ?? 0;
        if (amount !== 0) payments.push({ date, amount });
      } else {
        assumed = true;
        if (account.monthlyContribution > 0) payments.push({ date, amount: account.monthlyContribution });
      }
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { payments, assumed };
}

/**
 * The flows for one gap between snapshots. A recorded "paid in" total wins: the schedule's timing is kept and
 * scaled to that total, or it lands in the middle of the gap when the schedule has nothing.
 */
export function flowsForGap(account: FlowAccount, from: string, to: string, recorded: number | null): { payments: Payment[]; planned: Payment[]; assumed: boolean } {
  const schedule = paymentsBetween(account, from, to);
  if (recorded == null) return { payments: schedule.payments, planned: schedule.payments, assumed: schedule.assumed };
  const planned = schedule.payments;
  const plannedTotal = planned.reduce((sum, payment) => sum + payment.amount, 0);
  if (recorded >= 0 && plannedTotal > 0) {
    const scale = recorded / plannedTotal;
    return { payments: planned.map((payment) => ({ ...payment, amount: payment.amount * scale })), planned, assumed: false };
  }
  if (recorded === 0) return { payments: [], planned, assumed: false };
  return { payments: [{ date: midpoint(from, to), amount: recorded }], planned, assumed: false };
}

function midpoint(from: string, to: string): string {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return new Date((a + b) / 2).toISOString().slice(0, 10);
}

/** Grow `start` from `from` to `to` at a monthly rate, adding each payment on its date. */
export function growWith(start: number, payments: Payment[], from: string, to: string, monthlyRate: number): number {
  let balance = start;
  let at = from;
  for (const payment of payments) {
    balance = balance * (1 + monthlyRate) ** monthsBetween(at, payment.date) + payment.amount;
    at = payment.date;
  }
  return balance * (1 + monthlyRate) ** monthsBetween(at, to);
}

/** The steady monthly return that turns `start` plus the payments into `end`. Null when none fits. */
export function solveRate(start: number, payments: Payment[], from: string, to: string, end: number): number | null {
  let low = -0.5;
  let high = 0.5;
  const at = (g: number) => growWith(start, payments, from, to, g) - end;
  if (at(low) > 0 || at(high) < 0) return null;
  for (let step = 0; step < 200; step++) {
    const mid = (low + high) / 2;
    if (at(mid) > 0) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}
