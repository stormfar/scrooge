/// <reference lib="webworker" />
// Runs the simulated markets off the main thread so the Retirement page never freezes.
import { DEFAULT_CONFIDENCE, DEFAULT_PATHS, chanceMoneyLasts, earliestConfidentAge, makeMarkets } from './montecarlo';
import type { SolveRequest } from './retirement';

export type MarketJob =
  | { id: number; kind: 'chance'; request: SolveRequest; stopAge: number }
  | { id: number; kind: 'confident'; request: SolveRequest };

const markets = makeMarkets(DEFAULT_PATHS, 80);
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<MarketJob>) => {
  const job = event.data;
  const result = job.kind === 'chance'
    ? chanceMoneyLasts(job.request, job.stopAge, markets)
    : earliestConfidentAge(job.request, DEFAULT_CONFIDENCE, markets);
  scope.postMessage({ id: job.id, result });
};
