import { useId, useRef, useState, type ReactNode } from 'react';
import { InfoIcon } from 'lucide-react';
import { cn } from 'cn';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** A small "i" that explains something on hover or focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={`About ${label}`}
        className="inline-flex size-4 items-center justify-center rounded-full align-middle text-muted-foreground hover:text-foreground"
      >
        <InfoIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="block max-w-sm space-y-1.5 text-left leading-snug">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Label, optional hint, and a control underneath. */
export function FieldRow({ label, hint, htmlFor, children, className }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

/** A number input that keeps what you type, and reports a number or null (blank). */
export function NumberField({
  label,
  hint,
  value,
  step,
  min,
  max,
  resetKey,
  placeholder,
  className,
  onChange,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: number | null;
  step?: string;
  min?: number;
  max?: number;
  /** Change this to reload the text from `value`. */
  resetKey?: string;
  placeholder?: string;
  className?: string;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  const [text, setText] = useState(value == null ? '' : String(value));
  const seen = useRef(resetKey ?? 'keep');
  if (seen.current !== (resetKey ?? 'keep')) {
    seen.current = resetKey ?? 'keep';
    setText(value == null ? '' : String(value));
  }
  return (
    <FieldRow label={label} hint={hint} htmlFor={id} className={className}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step ?? '0.01'}
        min={min}
        max={max}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          if (raw.trim() === '') onChange(null);
          else if (Number.isFinite(Number(raw))) onChange(Number(raw));
        }}
      />
    </FieldRow>
  );
}

/** Pick one of a few options. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'default';
}) {
  return (
    <ToggleGroup
      aria-label={label}
      variant="outline"
      size={size}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        if (picked) onChange(picked);
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className="data-pressed:bg-primary data-pressed:text-primary-foreground">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export function SimpleSelect<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  id?: string;
  className?: string;
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next != null) onChange(next as T);
      }}
    >
      <SelectTrigger id={id} className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function Stat({ label, value, sub, accent }: { label: ReactNode; value: ReactNode; sub?: ReactNode; accent?: boolean }) {
  return (
    <Card className={cn(accent && 'ring-2 ring-primary')}>
      <CardHeader>
        <CardDescription className="text-xs font-medium tracking-wide uppercase">{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {sub && <CardContent className="text-xs text-muted-foreground">{sub}</CardContent>}
    </Card>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Lines of a sum: label on the left, amount on the right. */
export function SumList({ rows }: { rows: { label: ReactNode; value: ReactNode; tone?: 'pos' | 'neg' | 'strong' }[] }) {
  return (
    <dl className="divide-y text-sm">
      {rows.map((row, index) => (
        <div key={index} className={cn('flex items-baseline justify-between gap-4 py-1.5', row.tone === 'strong' && 'font-semibold')}>
          <dt className={cn(row.tone === 'pos' && 'text-emerald-600', row.tone === 'neg' && 'text-destructive')}>{row.label}</dt>
          <dd className={cn('tabular-nums', row.tone === 'pos' && 'text-emerald-600', row.tone === 'neg' && 'text-destructive')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A button that asks before it does something that cannot be undone. */
export function ConfirmButton({
  label,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
  variant = 'destructive',
  size = 'sm',
  confirmVariant = 'destructive',
}: {
  label: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  variant?: 'destructive' | 'ghost' | 'outline';
  size?: 'sm' | 'xs' | 'default';
  confirmVariant?: 'destructive' | 'default';
}) {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant={variant} size={size} />}>{label}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={confirmVariant} onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CheckField({ label, hint, checked, onChange }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next)} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

/** What "today's euros" means, with the user's own inflation rate as the example. */
export function TodaysEurosTip({ inflationPct }: { inflationPct: number }) {
  const years = 20;
  const factor = (1 + inflationPct / 100) ** years;
  const example = Math.round(1000 / factor);
  return (
    <InfoTip label="today's euros">
      <p><b>Today&apos;s euros</b> takes inflation out, so every amount is shown as what it would buy now. Use it to compare the future with your life today.</p>
      <p><b>With inflation</b> shows the actual number of euros in that year, as it will appear on a statement.</p>
      <p>
        At {inflationPct}% a year, prices rise by about {Math.round((factor - 1) * 100)}% over {years} years. So €1,000 in {new Date().getFullYear() + years} buys roughly what €{example.toLocaleString('en-GB')} buys today.
        The rate is set in Retirement, under Pension and assumptions.
      </p>
    </InfoTip>
  );
}
