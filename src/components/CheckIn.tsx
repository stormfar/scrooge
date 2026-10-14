import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FieldRow } from './kit';
import { expectedToday } from '../lib/calibration';
import { EURExact, fmtDate } from '../lib/format';
import { latestBalance, todayIso, type Account, type Balance, type BalanceWrite } from '../lib/types';

interface Row {
  balance: string;
  contributed: string;
  note: string;
}

/**
 * One form for every open account. Type today's balance for each; leave a row blank to skip it.
 * "Paid in" is optional: blank means the planned contribution went in, so the app can tell
 * money paid in from growth when it compares the plan with reality.
 */
export function CheckIn({
  open,
  accounts,
  balances,
  saving,
  onSave,
  onClose,
}: {
  open: boolean;
  accounts: Account[];
  balances: Balance[];
  saving: boolean;
  onSave: (rows: BalanceWrite[]) => Promise<void>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [error, setError] = useState<string | null>(null);
  const live = accounts.filter((account) => !account.closedOn);

  const patch = (id: string, next: Partial<Row>) => setRows((current) => {
    const blank: Row = { balance: '', contributed: '', note: '' };
    return { ...current, [id]: { ...blank, ...current[id], ...next } };
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const writes: BalanceWrite[] = [];
    for (const account of live) {
      const row = rows[account.id];
      if (!row || row.balance.trim() === '') continue;
      const balance = Number(row.balance);
      if (!Number.isFinite(balance)) {
        setError(`${account.name}: the balance is not a number`);
        return;
      }
      const contributed = row.contributed.trim() === '' ? null : Number(row.contributed);
      if (contributed != null && !Number.isFinite(contributed)) {
        setError(`${account.name}: paid in is not a number`);
        return;
      }
      writes.push({ accountId: account.id, date, balance, contributed, note: row.note.trim() });
    }
    if (writes.length === 0) {
      setError('Type at least one balance.');
      return;
    }
    setError(null);
    try {
      await onSave(writes);
      setRows({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Check-in</DialogTitle>
          <DialogDescription>
            Today&apos;s balance for each account. Projections start from the newest snapshot, and each check-in shows how far reality is from the plan.
            Leave &ldquo;paid in&rdquo; blank if the usual contribution went in; type the real figure if you paid in more, less, or took money out (negative).
            A date that already has a snapshot replaces it.
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <FieldRow label="Date" className="max-w-48">
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </FieldRow>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Last snapshot</TableHead>
                <TableHead className="text-right">Plan says now</TableHead>
                <TableHead>Balance now</TableHead>
                <TableHead>Paid in since</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {live.map((account) => {
                const last = latestBalance(balances, account.id);
                const plan = expectedToday({
                  monthlyContribution: account.monthlyContribution,
                  expectedReturnPct: account.expectedReturnPct,
                  closed: false,
                  openedOn: account.openedOn,
                  closedOn: account.closedOn,
                  contributionHistory: account.contributionHistory,
                }, last, date);
                const row = rows[account.id];
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium whitespace-normal">{account.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {last ? EURExact(last.balance) : '—'}
                      {last && <div className="text-xs text-muted-foreground">{fmtDate(last.date)}</div>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{plan ? EURExact(plan.balance) : '—'}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        className="min-w-28"
                        aria-label={`${account.name} balance`}
                        placeholder={plan ? String(Math.round(plan.balance)) : ''}
                        value={row?.balance ?? ''}
                        onChange={(event) => patch(account.id, { balance: event.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        className="min-w-24"
                        aria-label={`${account.name} paid in since the last snapshot`}
                        placeholder={plan ? String(Math.round(plan.flows)) : ''}
                        value={row?.contributed ?? ''}
                        onChange={(event) => patch(account.id, { contributed: event.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="min-w-28"
                        aria-label={`${account.name} note`}
                        value={row?.note ?? ''}
                        onChange={(event) => patch(account.id, { note: event.target.value })}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save check-in'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
