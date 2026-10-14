import type { FormEvent } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckField, FieldRow, SimpleSelect } from './kit';
import type { BalanceSplit } from '../lib/portion';
import { fmtDate } from '../lib/format';
import { EURExact } from '../lib/format';
import type { IncreaseEvery, IncreaseKind, ProjectAccount } from '../lib/projection';
import {
  ACCOUNT_TYPES,
  accountTypeInfo,
  LOCKED_TYPES,
  todayIso,
  type Account,
  type AccountTreatment,
  type AccountType,
  type AccountWrite,
  type HouseholdMode,
  type OwnerId,
  type Risk,
} from '../lib/types';
import { IncreaseFields } from './IncreaseFields';

export type ScenarioAccount = ProjectAccount & { risk: Risk };

export const PREVIEW_ID = '__preview__';

export interface Draft {
  id?: string;
  owner: OwnerId;
  name: string;
  type: AccountType;
  openedOn: string;
  monthlyContribution: string;
  increaseKind: IncreaseKind;
  increaseValue: string;
  increaseEvery: IncreaseEvery;
  expectedReturnPct: string;
  interestRatePct: string;
  risk: Risk;
  notes: string;
  closedOn: string;
  treatment: AccountTreatment;
  incomeMonthly: string;
  incomeStartAge: string;
  balance: string;
  savedBalance: string;
  balanceDate: string;
  myShare: string;
  /** Joint only: part of the balance is yours alone, as of a date. */
  portionOn: boolean;
  portionDate: string;
  /** The account balance on portionDate; saved as a snapshot. */
  portionBalance: string;
  savedPortionBalance: string;
  portionSelf: string;
  /** Could be taken out now without heavy tax or penalties. */
  accessible: boolean;
  history: HistoryRow[];
}

export interface HistoryRow {
  fromMonth: string;
  toMonth: string;
  amount: string;
  note: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Only finished rows are saved, so a half-typed period never reaches the plan. */
export function historyToWrite(rows: HistoryRow[]) {
  return rows
    .filter((row) => MONTH.test(row.fromMonth) && row.amount.trim() !== '' && Number.isFinite(Number(row.amount)))
    .map((row) => ({
      fromMonth: row.fromMonth,
      toMonth: MONTH.test(row.toMonth) ? row.toMonth : null,
      amountMonthly: Number(row.amount),
      note: row.note,
    }));
}

export function num(value: string, fallback = 0): number {
  if (value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNum(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sharePercent(fraction: number): string {
  return String(Math.round(fraction * 1000) / 10);
}

export function jointMine(draft: Draft): number {
  return Math.min(1, Math.max(0, num(draft.myShare, 50) / 100));
}

export function blankDraft(prefill?: Partial<Draft>): Draft {
  const info = accountTypeInfo(prefill?.type ?? 'etf');
  return {
    owner: 'self',
    name: '',
    type: 'etf',
    openedOn: '',
    monthlyContribution: '',
    increaseKind: 'percent',
    increaseValue: '0',
    increaseEvery: 'year',
    expectedReturnPct: String(info.defaultReturn),
    interestRatePct: '',
    risk: info.defaultRisk,
    notes: '',
    closedOn: '',
    treatment: 'portfolio',
    incomeMonthly: '',
    incomeStartAge: '',
    balance: '',
    savedBalance: '',
    balanceDate: todayIso(),
    myShare: '100',
    portionOn: false,
    portionDate: '',
    portionBalance: '',
    savedPortionBalance: '',
    portionSelf: '',
    accessible: !LOCKED_TYPES.includes(prefill?.type ?? 'etf'),
    history: [],
    ...prefill,
  };
}

export function draftFromAccount(account: Account, balance: number | null, portionBalance: number | null = null): Draft {
  return blankDraft({
    id: account.id,
    owner: account.owner,
    name: account.name,
    type: account.type,
    openedOn: account.openedOn ?? '',
    monthlyContribution: String(account.monthlyContribution),
    increaseKind: account.contributionIncreaseKind,
    increaseValue: String(account.contributionIncreaseValue),
    increaseEvery: account.contributionIncreaseEvery,
    expectedReturnPct: String(account.expectedReturnPct),
    interestRatePct: account.interestRatePct == null ? '' : String(account.interestRatePct),
    risk: account.risk,
    notes: account.notes,
    closedOn: account.closedOn ?? '',
    treatment: account.treatment,
    incomeMonthly: account.incomeMonthly == null ? '' : String(account.incomeMonthly),
    incomeStartAge: account.incomeStartAge == null ? '' : String(account.incomeStartAge),
    balance: balance == null ? '' : String(balance),
    savedBalance: balance == null ? '' : String(balance),
    balanceDate: todayIso(),
    myShare: sharePercent(account.ownerShare),
    portionOn: account.portionDate != null,
    portionDate: account.portionDate ?? '',
    portionBalance: portionBalance == null ? '' : String(portionBalance),
    savedPortionBalance: portionBalance == null ? '' : String(portionBalance),
    portionSelf: account.portionSelf == null ? '' : String(account.portionSelf),
    accessible: account.accessible,
    history: account.contributionHistory.map((period) => ({
      fromMonth: period.fromMonth,
      toMonth: period.toMonth ?? '',
      amount: String(period.amountMonthly),
      note: period.note,
    })),
  });
}

export function projectOf(account: Account, balance: number): ScenarioAccount {
  return {
    id: account.id,
    name: account.name,
    risk: account.risk,
    balance,
    monthlyContribution: account.monthlyContribution,
    contributionGrowthPct: account.contributionGrowthPct,
    increaseKind: account.contributionIncreaseKind,
    increaseValue: account.contributionIncreaseValue,
    increaseEvery: account.contributionIncreaseEvery,
    annualReturnPct: account.expectedReturnPct,
    closed: Boolean(account.closedOn),
  };
}

export function previewOf(draft: Draft): ScenarioAccount {
  return {
    id: draft.id ?? PREVIEW_ID,
    name: draft.name.trim() || 'New account',
    risk: draft.risk,
    balance: num(draft.balance),
    monthlyContribution: num(draft.monthlyContribution),
    contributionGrowthPct: 0,
    increaseKind: draft.increaseKind,
    increaseValue: num(draft.increaseValue),
    increaseEvery: draft.increaseEvery,
    annualReturnPct: num(draft.expectedReturnPct),
    closed: Boolean(draft.closedOn),
  };
}

export function toWrite(draft: Draft, includeBalance: boolean): AccountWrite {
  return {
    owner: draft.owner,
    name: draft.name,
    type: draft.type,
    openedOn: draft.openedOn || null,
    monthlyContribution: num(draft.monthlyContribution),
    contributionIncreaseKind: draft.increaseKind,
    contributionIncreaseValue: num(draft.increaseValue),
    contributionIncreaseEvery: draft.increaseEvery,
    expectedReturnPct: num(draft.expectedReturnPct),
    interestRatePct: optionalNum(draft.interestRatePct),
    risk: draft.risk,
    notes: draft.notes,
    closedOn: draft.closedOn || null,
    treatment: draft.treatment,
    incomeMonthly: optionalNum(draft.incomeMonthly),
    incomeStartAge: optionalNum(draft.incomeStartAge),
    ownerShare: draft.owner === 'joint' ? jointMine(draft) : undefined,
    portionDate: draft.owner === 'joint' && draft.portionOn && draft.portionDate && draft.portionSelf.trim() !== '' ? draft.portionDate : null,
    portionSelf: draft.owner === 'joint' && draft.portionOn && draft.portionDate && draft.portionSelf.trim() !== '' ? num(draft.portionSelf) : null,
    accessible: draft.accessible,
    contributionHistory: historyToWrite(draft.history),
    ...(includeBalance ? { balance: num(draft.balance), balanceDate: draft.balanceDate || todayIso() } : {}),
  };
}

export function AccountEditor({
  draft,
  mode,
  selfName,
  partnerName,
  saving,
  error,
  split,
  onChange,
  onType,
  onClose,
}: {
  draft: Draft | null;
  mode: HouseholdMode;
  selfName: string;
  partnerName: string;
  saving: boolean;
  /** Who owns the balance now, worked out from the draft. */
  split: BalanceSplit | null;
  error: string | null;
  onChange: (patch: Partial<Draft>) => void;
  onType: (type: AccountType) => void;
  onClose: () => void;
}) {
  const owners: { value: OwnerId; label: string }[] = mode === 'joint'
    ? [{ value: 'self', label: selfName }, { value: 'partner', label: partnerName }, { value: 'joint', label: 'Joint' }]
    : [{ value: 'self', label: selfName }];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onClose();
  };
  return (
    <Dialog open={draft != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft?.id ? 'Edit account' : 'Add account'}</DialogTitle>
          <DialogDescription>The totals move as you type. A name is enough for it to be kept; there is no save button to remember.</DialogDescription>
        </DialogHeader>
        {draft && (
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Name">
                <Input value={draft.name} onChange={(event) => onChange({ name: event.target.value })} required autoFocus />
              </FieldRow>
              {owners.length > 1 && (
                <FieldRow label="Owner">
                  <SimpleSelect value={draft.owner} options={owners} onChange={(owner) => onChange({ owner })} />
                </FieldRow>
              )}
            </div>
            {draft.owner === 'joint' && (
              <fieldset className="grid gap-4 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">Whose money</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FieldRow label="Your share of contributions, %" hint={`Each month's contribution splits this way. The rest is ${partnerName}'s.`}>
                    <Input type="number" min={0} max={100} step="0.1" value={draft.myShare} onChange={(event) => onChange({ myShare: event.target.value })} />
                  </FieldRow>
                  <p className="self-end text-xs text-muted-foreground">
                    {EURExact(num(draft.monthlyContribution) * jointMine(draft))} a month is yours and {EURExact(num(draft.monthlyContribution) * (1 - jointMine(draft)))} is {partnerName}&apos;s.
                  </p>
                </div>
                <CheckField
                  label="Part of the balance is only mine"
                  hint="For money you put in before it became joint. Give a date when you know the balance and how much of it was yours; from then on your part grows with the account and new contributions split as above."
                  checked={draft.portionOn}
                  onChange={(portionOn) => onChange({ portionOn })}
                />
                {draft.portionOn && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FieldRow label="On" hint="For example, the day it became joint.">
                      <Input type="date" value={draft.portionDate} onChange={(event) => onChange({ portionDate: event.target.value })} />
                    </FieldRow>
                    <FieldRow label="Balance that day, €" hint="Saved as a snapshot.">
                      <Input type="number" min={0} step="0.01" value={draft.portionBalance} onChange={(event) => onChange({ portionBalance: event.target.value })} />
                    </FieldRow>
                    <FieldRow label="Yours that day, €" hint="All of it, if it was only your money.">
                      <Input type="number" min={0} step="0.01" value={draft.portionSelf} onChange={(event) => onChange({ portionSelf: event.target.value })} />
                    </FieldRow>
                  </div>
                )}
                {split && (
                  <p className="text-sm">
                    {split.anchored
                      ? <>Now: <b>{EURExact(split.selfAmount)}</b> ({sharePercent(split.share)}%) is yours and <b>{EURExact(split.partnerAmount)}</b> is {partnerName}&apos;s{draft.portionDate ? `, counting from ${fmtDate(draft.portionDate)}` : ''}.</>
                      : <>Now: {EURExact(num(draft.balance) * jointMine(draft))} is yours and {EURExact(num(draft.balance) * (1 - jointMine(draft)))} is {partnerName}&apos;s.</>}
                  </p>
                )}
              </fieldset>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Type">
                <SimpleSelect value={draft.type} options={ACCOUNT_TYPES.map((type) => ({ value: type.id, label: type.label }))} onChange={onType} />
              </FieldRow>
              <FieldRow label="Risk">
                <SimpleSelect
                  value={draft.risk}
                  options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]}
                  onChange={(risk) => onChange({ risk })}
                />
              </FieldRow>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Current total">
                <Input type="number" step="0.01" value={draft.balance} onChange={(event) => onChange({ balance: event.target.value })} />
              </FieldRow>
              <FieldRow label="Balance date" hint="A new total is stored as a snapshot.">
                <Input type="date" value={draft.balanceDate} onChange={(event) => onChange({ balanceDate: event.target.value })} />
              </FieldRow>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Monthly contribution" hint="Euros per month now, before any increase.">
                <Input type="number" min="0" step="0.01" value={draft.monthlyContribution} onChange={(event) => onChange({ monthlyContribution: event.target.value })} />
              </FieldRow>
              <FieldRow label="Expected return, % a year" hint="Compounded monthly.">
                <Input type="number" step="0.1" value={draft.expectedReturnPct} onChange={(event) => onChange({ expectedReturnPct: event.target.value })} required />
              </FieldRow>
            </div>
            <IncreaseFields
              legend="Contribution increase"
              kind={draft.increaseKind}
              value={draft.increaseValue}
              every={draft.increaseEvery}
              start={num(draft.monthlyContribution)}
              onChange={(next) => onChange({ increaseKind: next.kind, increaseValue: next.value, increaseEvery: next.every })}
            />
            <HistoryFields
              rows={draft.history}
              openedOn={draft.openedOn}
              current={num(draft.monthlyContribution)}
              onChange={(history) => onChange({ history })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Opened">
                <Input type="date" value={draft.openedOn} onChange={(event) => onChange({ openedOn: event.target.value })} />
              </FieldRow>
              <FieldRow label="Closed" hint="Blank if it is still open.">
                <Input type="date" value={draft.closedOn} onChange={(event) => onChange({ closedOn: event.target.value })} />
              </FieldRow>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <FieldRow label="In retirement" className="sm:col-span-3">
                <SimpleSelect
                  value={draft.treatment}
                  options={[{ value: 'portfolio', label: 'Stays invested and can be drawn down' }, { value: 'income', label: 'Pays a monthly income' }]}
                  onChange={(treatment) => onChange({ treatment })}
                />
              </FieldRow>
              {draft.treatment === 'income' && (
                <>
                  <FieldRow label="Monthly income" hint="Today's euros.">
                    <Input type="number" min="0" step="0.01" value={draft.incomeMonthly} onChange={(event) => onChange({ incomeMonthly: event.target.value })} />
                  </FieldRow>
                  <FieldRow label="Starts at age" hint="Blank uses the regular pension age.">
                    <Input type="number" min="0" max="100" value={draft.incomeStartAge} onChange={(event) => onChange({ incomeStartAge: event.target.value })} />
                  </FieldRow>
                </>
              )}
            </div>
            <CheckField
              label="I can take this money out now"
              hint="Untick for pensions and anything you could only withdraw with heavy tax, penalties or a long notice period. Investments shows how much is accessible, for example towards buying a home."
              checked={draft.accessible}
              onChange={(accessible) => onChange({ accessible })}
            />
            <FieldRow label="Notes">
              <Textarea value={draft.notes} onChange={(event) => onChange({ notes: event.target.value })} rows={2} />
            </FieldRow>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit">{saving ? 'Saving…' : 'Done'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function HistoryFields({
  rows,
  openedOn,
  current,
  onChange,
}: {
  rows: HistoryRow[];
  openedOn: string;
  current: number;
  onChange: (rows: HistoryRow[]) => void;
}) {
  const set = (index: number, patch: Partial<HistoryRow>) => onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const add = () => {
    const last = rows[rows.length - 1];
    const start = last?.toMonth && MONTH.test(last.toMonth) ? nextMonth(last.toMonth) : rows.length ? '' : openedOn.slice(0, 7);
    onChange([...rows, { fromMonth: start, toMonth: '', amount: rows.length ? '' : String(current || ''), note: '' }]);
  };
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Contribution history</legend>
      <p className="text-xs text-muted-foreground">
        What went in each month in the past. It makes &ldquo;versus plan&rdquo; and the realised return accurate. Once there is a history, months it does not cover count as paused.
        Leave &ldquo;to&rdquo; empty on the period that is still going. Projections still use the monthly contribution above.
      </p>
      {rows.length > 0 && (
        <div className="grid gap-2">
          <div className="hidden grid-cols-[1fr_1fr_1fr_1.4fr_auto] gap-2 text-xs font-medium text-muted-foreground sm:grid">
            <span>From</span><span>To</span><span>€ / month</span><span>Note</span><span className="w-8" />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.4fr_auto]">
              <Input type="month" aria-label="From month" value={row.fromMonth} onChange={(event) => set(index, { fromMonth: event.target.value })} />
              <Input type="month" aria-label="To month (empty if still going)" value={row.toMonth} onChange={(event) => set(index, { toMonth: event.target.value })} />
              <Input type="number" min={0} step="1" aria-label="Euros per month" value={row.amount} onChange={(event) => set(index, { amount: event.target.value })} />
              <Input aria-label="Note" placeholder="e.g. paused" value={row.note} onChange={(event) => set(index, { note: event.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove period" onClick={() => onChange(rows.filter((_, at) => at !== index))}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={add}><PlusIcon />Add period</Button>
      </div>
    </fieldset>
  );
}

function nextMonth(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, '0')}`;
}
