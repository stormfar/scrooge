import { useEffect, useRef, useState } from 'react';
import { InfoTip } from '@/components/kit';
import { DEFAULT_PATHS, type ChanceResult, type ConfidentAge } from '@/lib/montecarlo';
import type { MarketJob } from '@/lib/montecarlo.worker';
import type { SolveRequest } from '@/lib/retirement';
import { cn } from '@/lib/utils';

type Job = MarketJob extends infer J ? (J extends { id: number } ? Omit<J, 'id'> : never) : never;

/** One worker per kind of question, so a slow search never holds up the quick answer. Results for old plans are dropped. */
function useWorkerResult<T>(job: Job | null, delayMs: number): T | null {
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const [result, setResult] = useState<T | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('../lib/montecarlo.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<{ id: number; result: T }>) => {
      if (event.data.id === latest.current) setResult(event.data.result);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  useEffect(() => {
    const id = ++latest.current;
    setResult(null);
    if (!job) return;
    const timer = window.setTimeout(() => worker.current?.postMessage({ ...job, id }), delayMs);
    return () => window.clearTimeout(timer);
  }, [job, delayMs]);

  return result;
}

/** "Stopping at 55 lasts in 78% of simulated markets; for 90%, stop at 58." */
export function MarketRisk({ request, stopAge, horizon }: { request: SolveRequest; stopAge: number | null; horizon: number }) {
  const [chanceJob, setChanceJob] = useState<Job | null>(null);
  const [confidentJob, setConfidentJob] = useState<Job | null>(null);
  useEffect(() => setChanceJob(stopAge == null ? null : { kind: 'chance', request, stopAge }), [request, stopAge]);
  useEffect(() => setConfidentJob({ kind: 'confident', request }), [request]);
  const chance = useWorkerResult<ChanceResult | null>(chanceJob, 250);
  const confident = useWorkerResult<ConfidentAge>(confidentJob, 400);

  if (stopAge == null) return null;
  if (!chance) return <p className="text-sm text-muted-foreground">Testing the plan against {DEFAULT_PATHS} simulated markets…</p>;
  const pct = Math.round(chance.chance * 100);
  const tone = pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-destructive';
  return (
    <p className="text-sm text-muted-foreground">
      Markets don&apos;t return the same every year. Stopping at {Math.round(stopAge)}, the money lasts to {horizon} in{' '}
      <span className={cn('font-semibold', tone)}>{pct}%</span> of {chance.paths} simulated markets.{' '}
      {!confident
        ? 'Working out the age for a 90% chance…'
        : confident.age == null
          ? 'Even working to 70 stays under a 90% chance.'
          : confident.age > Math.round(stopAge)
            ? `For a 90% chance, stop at ${confident.age}.`
            : 'That is above a 90% chance.'}{' '}
      <InfoTip label="simulated markets">
        Each simulated year draws one market move shared by all accounts, scaled by each account&apos;s risk (yearly swings of about
        4% for low, 15% for medium, 25% for high), around its expected return. A bad run in the first years of retirement is what
        usually breaks a plan, and a single average return hides it. Same plan, same markets: the number only changes when the plan does.
      </InfoTip>
    </p>
  );
}
