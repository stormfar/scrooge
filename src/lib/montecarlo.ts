/**
 * How likely is a plan to last? The deterministic solver assumes the same return every year. Real markets
 * vary, and a bad run early in retirement hurts most. This replays the plan over many simulated markets.
 *
 * - Each year draws one market shock, shared by all accounts (they tend to fall together); an account moves
 *   by it in proportion to its volatility, so a savings account barely moves and an equity fund swings.
 * - Annual returns are lognormal with the account's expected return as their mean.
 * - Seeded, so the same plan always gives the same answer, and every age sees the same markets
 *   (comparing ages compares plans, not luck).
 */

import { primaryAgeNow, simulateAtAge, type SolveRequest } from './retirement';
import type { Risk } from './types';

/** Yearly standard deviation of returns, in percentage points. */
export const RISK_VOLATILITY: Record<Risk, number> = { low: 4, medium: 15, high: 25 };

export const DEFAULT_PATHS = 500;
export const DEFAULT_CONFIDENCE = 0.9;

/** Small fast seeded generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normals(seed: number, count: number): number[] {
  const next = rng(seed);
  const out: number[] = [];
  while (out.length < count) {
    const u = Math.max(next(), 1e-12);
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    out.push(r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v));
  }
  return out.slice(0, count);
}

/** One simulated year's return for an account with this expected return and risk, given the market shock z. */
export function sampledReturn(expectedPct: number, risk: Risk, z: number): number {
  const sigma = RISK_VOLATILITY[risk] / 100;
  const growth = Math.max(0.01, 1 + expectedPct / 100);
  const mu = Math.log(growth) - (sigma * sigma) / 2;
  return (Math.exp(mu + sigma * z) - 1) * 100;
}

export interface Markets {
  shocks: number[][];
}

export function makeMarkets(paths: number, years: number, seed = 1): Markets {
  return { shocks: Array.from({ length: paths }, (_, p) => normals(seed * 100_003 + p, years)) };
}

export interface ChanceResult {
  paths: number;
  lasted: number;
  /** 0 to 1. */
  chance: number;
}

/** Share of simulated markets in which the money lasts to the horizon when work stops at `stopAge`. */
export function chanceMoneyLasts(req: SolveRequest, stopAge: number, markets = makeMarkets(DEFAULT_PATHS, 80)): ChanceResult | null {
  let lasted = 0;
  for (const shocks of markets.shocks) {
    const sim = simulateAtAge(req, stopAge, {
      lean: true,
      returns: (_i, year, expected, risk) => sampledReturn(expected, risk, shocks[Math.min(year, shocks.length - 1)]),
    });
    if (!sim) return null;
    if (sim.ok) lasted++;
  }
  const paths = markets.shocks.length;
  return { paths, lasted, chance: paths ? lasted / paths : 0 };
}

export interface ConfidentAge {
  /** Earliest whole age (primary person) with at least `confidence` chance, or null if none up to 70. */
  age: number | null;
  chance: number | null;
  confidence: number;
}

/**
 * Earliest age at which the plan lasts in at least `confidence` of simulated markets. Searches whole ages
 * by bisection (stopping later never makes a plan worse).
 */
export function earliestConfidentAge(
  req: SolveRequest,
  confidence = DEFAULT_CONFIDENCE,
  markets = makeMarkets(DEFAULT_PATHS, 80),
): ConfidentAge {
  const now = primaryAgeNow(req);
  if (now == null) return { age: null, chance: null, confidence };
  let lo = Math.max(Math.ceil(now), 18);
  let hi = 70;
  const at = (age: number) => chanceMoneyLasts(req, age, markets)?.chance ?? 0;
  const top = at(hi);
  if (top < confidence) return { age: null, chance: top, confidence };
  let best = { age: hi, chance: top };
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const c = at(mid);
    if (c >= confidence) {
      best = { age: mid, chance: c };
      hi = mid;
    } else lo = mid + 1;
  }
  if (lo !== best.age) best = { age: lo, chance: at(lo) };
  return { ...best, confidence };
}
