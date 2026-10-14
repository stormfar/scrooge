import type { Pot } from '../lib/household';
import type { HouseholdMode } from '../lib/types';
import { EURExact } from '../lib/format';
import { SumList } from './kit';

/** In, out, and what is left of the pot each month. */
export function PotSummary({ pot, mode, selfName, partnerName }: { pot: Pot; mode: HouseholdMode; selfName: string; partnerName: string }) {
  const left = pot.unallocatedMonthly;
  const joint = mode === 'joint';
  const pay = pot.inMonthly - pot.otherInMonthly;
  return (
    <div className="space-y-2">
      <SumList
        rows={[
          { label: joint ? 'Both take-home pays' : 'Take-home pay', value: EURExact(pay) },
          ...(pot.otherInMonthly > 0 ? [{ label: 'Other income into the pot', value: EURExact(pot.otherInMonthly) }] : []),
          ...(joint ? [{ label: 'Personal allowances', value: `−${EURExact(pot.allowancesMonthly)}` }] : []),
          { label: 'Rent', value: `−${EURExact(pot.rentMonthly)}` },
          { label: joint ? 'Other shared costs' : 'Other spending', value: `−${EURExact(pot.sharedSpendMonthly)}` },
          ...(pot.jointInvestMonthly > 0 ? [{ label: joint ? 'Joint investments' : 'Investments', value: `−${EURExact(pot.jointInvestMonthly)}` }] : []),
          ...(!joint && pot.selfInvestMonthly > 0 ? [{ label: 'Your investments', value: `−${EURExact(pot.selfInvestMonthly)}` }] : []),
          { label: left < 0 ? 'Short each month' : 'Left over each month', value: `${left < 0 ? '−' : ''}${EURExact(Math.abs(left))}`, tone: left < 0 ? 'neg' : 'pos' },
        ]}
      />
      {joint && (pot.selfInvestMonthly > 0 || pot.partnerInvestMonthly > 0) && (
        <p className="text-xs text-muted-foreground">
          Personal investments come out of each allowance. {selfName} lives on {EURExact(pot.selfLivingMonthly)}
          {pot.selfInvestMonthly > 0 ? ` after ${EURExact(pot.selfInvestMonthly)} invested` : ''}; {partnerName} on {EURExact(pot.partnerLivingMonthly)}
          {pot.partnerInvestMonthly > 0 ? ` after ${EURExact(pot.partnerInvestMonthly)} invested` : ''}.
        </p>
      )}
    </div>
  );
}
