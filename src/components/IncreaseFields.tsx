import { EURExact } from '../lib/format';
import { grownMonthly, type IncreaseEvery, type IncreaseKind } from '../lib/projection';
import { FieldRow, SimpleSelect } from './kit';
import { Input } from '@/components/ui/input';

export function increaseText(kind: IncreaseKind, value: number, every: IncreaseEvery): string {
  if (!value) return 'No increase';
  const unit = every === 'month' ? 'month' : 'year';
  if (kind === 'percent') return `${value}% / ${unit}`;
  return `${EURExact(value)} / ${unit}`;
}

export function IncreaseFields({
  legend,
  kind,
  value,
  every,
  start,
  allowMonthly = true,
  onChange,
}: {
  legend: string;
  kind: IncreaseKind;
  value: string;
  every: IncreaseEvery;
  start: number;
  /** Salary is reviewed once a year. Contributions can still rise each month. */
  allowMonthly?: boolean;
  onChange: (next: { kind: IncreaseKind; value: string; every: IncreaseEvery }) => void;
}) {
  const cadence: IncreaseEvery = allowMonthly && every === 'month' ? 'month' : 'year';
  const amount = value.trim() === '' ? 0 : Number(value);
  const increase = { kind, value: Number.isFinite(amount) ? amount : 0, every: cadence };
  const later = grownMonthly(start, increase, cadence === 'month' ? 1 : 12);
  const when = cadence === 'month' ? 'one month' : 'one year';
  const detail = !increase.value
    ? `Stays at ${EURExact(start)} a month.`
    : kind === 'percent'
      ? `After ${when}, ${EURExact(later)} a month (${increase.value}% more each ${cadence}).`
      : `After ${when}, ${EURExact(later)} a month (${EURExact(increase.value)} added each ${cadence}).`;
  const emit = (next: { kind?: IncreaseKind; value?: string; every?: IncreaseEvery }) => onChange({
    kind: next.kind ?? kind,
    value: next.value ?? value,
    every: allowMonthly ? (next.every ?? cadence) : 'year',
  });

  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <div className={allowMonthly ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
        <FieldRow label="Kind">
          <SimpleSelect
            value={kind}
            options={[{ value: 'percent', label: 'Percent' }, { value: 'amount', label: 'Fixed amount' }]}
            onChange={(next) => emit({ kind: next })}
          />
        </FieldRow>
        <FieldRow label={kind === 'percent' ? 'Percent' : 'Euros added'}>
          <Input type="number" step={kind === 'percent' ? '0.1' : '1'} value={value} onChange={(event) => emit({ value: event.target.value })} />
        </FieldRow>
        {allowMonthly && (
          <FieldRow label="How often">
            <SimpleSelect
              value={cadence}
              options={[{ value: 'year', label: 'Each year' }, { value: 'month', label: 'Each month' }]}
              onChange={(next) => emit({ every: next })}
            />
          </FieldRow>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </fieldset>
  );
}
