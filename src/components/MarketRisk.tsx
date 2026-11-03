import { useEffect, useState } from 'react';
import { InfoTip } from '@/components/kit';
import { DEFAULT_PATHS, chanceMoneyLasts, earliestConfidentAge, makeMarkets, type ChanceResult, type ConfidentAge } from '@/lib/montecarlo';
import type { SolveRequest } from '@/lib/retirement';
import { cn } from '@/lib/utils';

const MARKETS = makeMarkets(DEFAULT_PATHS, 80);

/** "Stopping at 55 lasts in 78% of simulated markets; for 90%, stop at 58." Computed after the page has drawn. */
export function MarketRisk({ request, stopAge, horizon }: { request: SolveRequest; stopAge: number | null; horizon: number }) {
  const [result, setResult] = useState<{ chance: ChanceResult | null; confident: ConfidentAge } | null>(null);

  useEffect(() => {
    setResult(null);
    if (stopAge == null) return;
    const timer = window.setTimeout(() => {
      setResult({
        chance: chanceMoneyLasts(request, stopAge, MARKETS),
        confident: earliestConfidentAge(request, 0.9, MARKETS),
      });
    }, 30);
    return () => window.clearTimeout(timer);
  }, [request, stopAge]);

  if (stopAge == null) return null;
  if (!result?.chance) return <p className="text-sm text-muted-foreground">Testing the plan against {DEFAULT_PATHS} simulated markets…</p>;
  const pct = Math.round(result.chance.chance * 100);
  const { confident } = result;
  const tone = pct >= 90 ? 'text-emerald-600' : pct >= 70 ? 'text-amber-600' : 'text-destructive';
  return (
    <p className="text-sm text-muted-foreground">
      Markets don&apos;t return the same every year. Stopping at {Math.round(stopAge)}, the money lasts to {horizon} in{' '}
      <span className={cn('font-semibold', tone)}>{pct}%</span> of {result.chance.paths} simulated markets.{' '}
      {confident.age == null
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
