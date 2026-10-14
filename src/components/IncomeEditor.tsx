import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckField, FieldRow, SimpleSelect } from './kit';
import type { HouseholdMode, IncomeWrite, OtherIncome, OwnerId } from '../lib/types';

export type IncomeDraft = Partial<OtherIncome> & { amountText?: string };

/** Add or change an income such as Kindergeld. Saved with the button, so a half-typed entry never lands in the plan. */
export function IncomeEditor({
  draft,
  mode,
  selfName,
  partnerName,
  saving,
  onSave,
  onClose,
}: {
  draft: IncomeDraft | null;
  mode: HouseholdMode;
  selfName: string;
  partnerName: string;
  saving: boolean;
  onSave: (id: string | undefined, income: IncomeWrite) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog open={draft != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {draft && (
          <IncomeForm key={draft.id ?? draft.name ?? 'new'} draft={draft} mode={mode} selfName={selfName} partnerName={partnerName} saving={saving} onSave={onSave} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function IncomeForm({
  draft,
  mode,
  selfName,
  partnerName,
  saving,
  onSave,
  onClose,
}: {
  draft: IncomeDraft;
  mode: HouseholdMode;
  selfName: string;
  partnerName: string;
  saving: boolean;
  onSave: (id: string | undefined, income: IncomeWrite) => Promise<void>;
  onClose: () => void;
}) {
  const joint = mode === 'joint';
  const [name, setName] = useState(draft.name ?? '');
  const [owner, setOwner] = useState<OwnerId>(draft.owner ?? (joint ? 'joint' : 'self'));
  const [amount, setAmount] = useState(draft.amountMonthly == null ? '' : String(draft.amountMonthly));
  const [startsOn, setStartsOn] = useState(draft.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(draft.endsOn ?? '');
  const [intoPot, setIntoPot] = useState(draft.intoPot ?? true);
  const [indexed, setIndexed] = useState(draft.indexed ?? true);
  const [notes, setNotes] = useState(draft.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const kindergeld = /kindergeld/i.test(name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!name.trim()) return setError('Give it a name.');
    if (amount.trim() === '' || !Number.isFinite(value) || value < 0) return setError('The amount must be a number of euros per month.');
    if (startsOn && endsOn && startsOn >= endsOn) return setError('The end date must be after the start date.');
    setError(null);
    try {
      await onSave(draft.id, {
        name: name.trim(),
        owner,
        amountMonthly: value,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        intoPot: joint ? intoPot : true,
        indexed,
        notes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <DialogHeader>
        <DialogTitle>{draft.id ? 'Edit income' : 'Add income'}</DialogTitle>
        <DialogDescription>Money that is not salary: Kindergeld, rent from a flat, a side business. Euros per month in today&apos;s money.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} autoFocus /></FieldRow>
        <FieldRow label="€ per month"><Input type="number" min={0} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></FieldRow>
        {joint && (
          <FieldRow label="Whose">
            <SimpleSelect
              value={owner}
              options={[{ value: 'joint', label: 'Joint' }, { value: 'self', label: selfName }, { value: 'partner', label: partnerName }]}
              onChange={setOwner}
            />
          </FieldRow>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Starts" hint="Blank if it is already paid."><Input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></FieldRow>
        <FieldRow label="Stops" hint={kindergeld ? 'Kindergeld usually stops when the child turns 18, or 25 in training or study.' : 'Blank if it does not stop.'}>
          <Input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
        </FieldRow>
      </div>
      <div className="grid gap-3">
        {joint && <CheckField label="Paid into the shared pot" hint="Off means its owner keeps it." checked={intoPot} onChange={setIntoPot} />}
        <CheckField label="Rises with inflation" hint="Keeps the same value in today's euros. Off means the euro amount stays fixed." checked={indexed} onChange={setIndexed} />
      </div>
      <FieldRow label="Notes"><Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} /></FieldRow>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </DialogFooter>
    </form>
  );
}
