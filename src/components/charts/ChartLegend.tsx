import { useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { getColorClassName, type AvailableChartColorsKeys } from '@/lib/chartColors';

export interface LegendItem {
  name: string;
  color: AvailableChartColorsKeys;
  /** Drawn as a line rather than a filled block. */
  line?: boolean;
  dashed?: boolean;
}

/** Which series are hidden. Hidden series are left out of the chart, so its axes rescale to what is left. */
export function useHiddenSeries(initiallyHidden: () => string[] = () => []) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(initiallyHidden()));
  const toggle = (name: string) => setHidden((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
  const showAll = () => setHidden(new Set());
  /** The items still shown, in order, with their colours kept in step. */
  const visible = (items: LegendItem[]) => {
    const shown = items.filter((item) => !hidden.has(item.name));
    return { categories: shown.map((item) => item.name), colors: shown.map((item) => item.color) };
  };
  return { hidden, toggle, showAll, visible };
}

/** A legend you can click: each entry hides or shows its series. The last visible entry cannot be hidden. */
export function ChartLegend({
  items,
  hidden,
  onToggle,
  onShowAll,
}: {
  items: LegendItem[];
  hidden: Set<string>;
  onToggle: (name: string) => void;
  onShowAll: () => void;
}) {
  const visibleCount = items.filter((item) => !hidden.has(item.name)).length;
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Chart series">
      {items.map((item) => {
        const off = hidden.has(item.name);
        const last = !off && visibleCount <= 1;
        return (
          <Button
            key={item.name}
            variant="ghost"
            size="xs"
            aria-pressed={!off}
            disabled={last}
            title={last ? 'At least one series stays visible' : off ? `Show ${item.name}` : `Hide ${item.name}`}
            onClick={() => onToggle(item.name)}
            className={cn('font-normal', off && 'text-muted-foreground line-through')}
          >
            {item.line ? (
              <span
                className={cn('h-0.5 w-3.5 shrink-0 rounded-full', off ? 'bg-muted-foreground/40' : getColorClassName(item.color, 'bg'), item.dashed && 'opacity-70')}
                aria-hidden
              />
            ) : (
              <span className={cn('size-2.5 shrink-0 rounded-sm', off ? 'bg-muted-foreground/40' : getColorClassName(item.color, 'bg'))} aria-hidden />
            )}
            {item.name}
          </Button>
        );
      })}
      {hidden.size > 0 && (
        <Button variant="ghost" size="xs" onClick={onShowAll} className="text-muted-foreground">
          <EyeIcon />Show all
        </Button>
      )}
    </div>
  );
}
