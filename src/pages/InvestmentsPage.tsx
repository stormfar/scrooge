import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheckIcon, DownloadIcon, LockIcon, PlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from 'cn';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ComboChart } from '@/components/charts/ComboChart';
import { AreaChart } from '@/components/charts/AreaChart';
import { ChartLegend, useHiddenSeries, type LegendItem } from '@/components/charts/ChartLegend';
import {
  AccountEditor,
  blankDraft,
  draftFromAccount,
  historyToWrite,
  num,
  previewOf,
  projectOf,
  sharePercent,
  toWrite,
  type Draft,
} from '../components/AccountEditor';
import { CheckIn } from '../components/CheckIn';
import { increaseText } from '../components/IncreaseFields';
import { ConfirmButton, FieldRow, InfoTip, NumberField, PageHeader, Segmented, Stat, TodaysEurosTip } from '../components/kit';
import { useFinanceData } from '../hooks/useFinanceData';
import {
  addBalance,
  addBalances,
  createAccount,
  deleteAccount,
  deleteBalance,
  exportCsv,
  updateAccount,
} from '../lib/api';
import { calibrate, daysSinceCheckIn, plannedAt, SUGGEST_AFTER_MONTHS, type Calibration } from '../lib/calibration';
import type { AvailableChartColorsKeys } from '../lib/chartColors';
import { EUR, EURExact, fmtDate, PCT } from '../lib/format';
import { dayBefore } from '../lib/flows';
import { balanceSplit } from '../lib/portion';
import { projectAccounts, RISK_SPREAD, scenarioReturn, type Scenario } from '../lib/projection';
import {
  accountTypeInfo,
  balancesFor,
  LOCKED_TYPES,
  latestBalance,
  partnerShare,
  personName,
  selfShare,
  todayIso,
  type Account,
  type AccountType,
  type Balance,
} from '../lib/types';

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'medium', label: 'Medium' },
  { value: 'optimistic', label: 'Optimistic' },
];
type Horizon = '5' | '10' | '15' | '20' | '30';
const HORIZONS: { value: Horizon; label: string }[] = ['5', '10', '15', '20', '30'].map((value) => ({ value: value as Horizon, label: `${value} years` }));
const CHECK_IN_AFTER_DAYS = 31;
const ACCOUNT_COLOURS: AvailableChartColorsKeys[] = ['blue', 'amber', 'violet', 'cyan', 'pink', 'lime', 'fuchsia', 'emerald', 'teal', 'sky'];
const RISK_TONE = { low: 'text-emerald-600', medium: 'text-amber-600', high: 'text-destructive' } as const;

export function InvestmentsPage() {
  const { data, error, saving, mutate } = useFinanceData();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);
  const [balanceDate, setBalanceDate] = useState(todayIso());
  const [balanceAmount, setBalanceAmount] = useState('');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [horizon, setHorizon] = useState<Horizon>('10');
  const [scenario, setScenario] = useState<Scenario>('medium');
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [contribPct, setContribPct] = useState(100);
  const [returnDelta, setReturnDelta] = useState(0);
  const [lumpSum, setLumpSum] = useState(0);
  const [real, setReal] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const knownIds = useRef<Set<string> | null>(null);
  const pendingId = useRef<string | null>(null);
  const creating = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const saveTimer = useRef<number | null>(null);
  const persistRef = useRef<(snapshot: Draft) => Promise<void>>(async () => {});
  // Locked money (pension policies and the like) starts hidden in the all-accounts chart. The legend can show it.
  const allSeries = useHiddenSeries(() => data?.accounts.filter((account) => !account.accessible).map((account) => account.name) ?? []);
  const oneSeries = useHiddenSeries();
  draftRef.current = draft;

  const source = useMemo(() => {
    if (!data) return [];
    const known = knownIds.current;
    const rows = data.accounts
      .filter((account) => !draft || Boolean(draft.id) || (known?.has(account.id) ?? true))
      .map((account) => projectOf(account, latestBalance(data.balances, account.id)?.balance ?? 0));
    if (draft) {
      const preview = previewOf(draft);
      const index = rows.findIndex((row) => row.id === preview.id);
      if (index >= 0) rows[index] = preview;
      else rows.push(preview);
    }
    return rows;
  }, [data, draft]);

  const points = useMemo(() => {
    if (!data) return [];
    return projectAccounts(
      source.map((account) => ({ ...account, annualReturnPct: scenarioReturn(account.annualReturnPct, account.risk, scenario) })),
      {
        years: Number(horizon),
        inflationPct: data.settings.inflationPct,
        real,
        contributionScale: contribPct / 100,
        returnDeltaPct: returnDelta,
        lumpSum,
        now: new Date(),
      },
    );
  }, [data, source, scenario, horizon, real, contribPct, returnDelta, lumpSum]);

  const calibrations = useMemo(() => {
    const out = new Map<string, Calibration | null>();
    if (!data) return out;
    for (const account of data.accounts) {
      out.set(account.id, calibrate({
        monthlyContribution: account.monthlyContribution,
        expectedReturnPct: account.expectedReturnPct,
        closed: Boolean(account.closedOn),
        openedOn: account.openedOn,
        closedOn: account.closedOn,
        contributionHistory: account.contributionHistory,
      }, balancesFor(data.balances, account.id)));
    }
    return out;
  }, [data]);

  async function persistDraft(snapshot: Draft) {
    if (!snapshot.name.trim()) return;
    const id = snapshot.id ?? pendingId.current;
    if (!id && creating.current) return;
    setFormError(null);
    const balanceChanged = snapshot.balance.trim() !== '' && snapshot.balance !== snapshot.savedBalance;
    try {
      if (!id) {
        creating.current = true;
        const before = knownIds.current ?? new Set<string>();
        const next = await mutate(() => createAccount(toWrite(snapshot, true)));
        const created = next.accounts.find((account) => !before.has(account.id));
        creating.current = false;
        if (!created) return;
        pendingId.current = created.id;
        setDraft((current) => (!current || current.id ? current : { ...current, id: created.id, savedBalance: snapshot.balance }));
        return;
      }
      const portionChanged = snapshot.owner === 'joint' && snapshot.portionOn && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.portionDate)
        && snapshot.portionBalance.trim() !== '' && snapshot.portionBalance !== snapshot.savedPortionBalance;
      await mutate(async () => {
        let latest = await updateAccount(id, toWrite(snapshot, false));
        if (portionChanged) latest = await addBalance({ accountId: id, date: snapshot.portionDate, balance: num(snapshot.portionBalance), note: 'Portion date' });
        if (balanceChanged) latest = await addBalance({ accountId: id, date: snapshot.balanceDate || todayIso(), balance: num(snapshot.balance) });
        return latest;
      });
      if (balanceChanged || portionChanged) {
        setDraft((current) => {
          if (!current || (current.id !== id && pendingId.current !== id)) return current;
          return {
            ...current,
            id,
            ...(balanceChanged && current.balance === snapshot.balance ? { savedBalance: snapshot.balance } : {}),
            ...(portionChanged && current.portionBalance === snapshot.portionBalance ? { savedPortionBalance: snapshot.portionBalance } : {}),
          };
        });
      }
    } catch (err) {
      creating.current = false;
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }
  persistRef.current = persistDraft;

  useEffect(() => {
    if (!draft?.name.trim()) return undefined;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const snapshot = draft;
    saveTimer.current = window.setTimeout(() => {
      void persistRef.current(snapshot);
    }, 500);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [draft]);

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const current = draftRef.current;
    if (current?.name.trim()) void persistRef.current(current);
  }, []);

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      if (patch.owner && patch.owner !== current.owner && patch.myShare == null) {
        next.myShare = patch.owner === 'joint' ? '50' : patch.owner === 'partner' ? '0' : '100';
      }
      return next;
    });
  }

  function changeType(type: AccountType) {
    setDraft((current) => {
      if (!current) return current;
      const previous = accountTypeInfo(current.type);
      const next = accountTypeInfo(type);
      return {
        ...current,
        type,
        expectedReturnPct: num(current.expectedReturnPct) === previous.defaultReturn ? String(next.defaultReturn) : current.expectedReturnPct,
        risk: current.risk === previous.defaultRisk ? next.defaultRisk : current.risk,
        // Follow the new type's usual accessibility unless it was changed by hand.
        accessible: current.accessible === !LOCKED_TYPES.includes(current.type) ? !LOCKED_TYPES.includes(type) : current.accessible,
      };
    });
  }

  function openDraft(next: Draft) {
    setFormError(null);
    pendingId.current = next.id ?? null;
    knownIds.current = next.id || !data ? null : new Set(data.accounts.map((account) => account.id));
    setDraft(next);
  }

  async function closeDraft() {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const current = draftRef.current;
    if (current?.name.trim()) await persistDraft(current);
    setDraft(null);
  }

  async function saveBalance() {
    if (!balanceFor) return;
    setFormError(null);
    try {
      await mutate(() => addBalance({ accountId: balanceFor.id, date: balanceDate, balance: num(balanceAmount) }));
      setBalanceFor(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!data) return null;

  const joint = data.settings.householdMode === 'joint';
  const selfName = personName(data.people, 'self');
  const partnerName = personName(data.people, 'partner');
  const openIds = new Set(data.accounts.filter((account) => !account.closedOn).map((account) => account.id));
  const sinceCheckIn = daysSinceCheckIn(data.balances, openIds, todayIso());
  const scale = contribPct / 100;
  const whatIfActive = contribPct !== 100 || returnDelta !== 0 || lumpSum !== 0;

  let yoursBalance = 0;
  let yoursMonthly = 0;
  let theirsBalance = 0;
  let theirsMonthly = 0;
  /** `balanceShare` is your part of the balance; contributions always split by ownerShare. */
  const addPortions = (balance: number, contribution: number, owner: string, ownerShare: number, closed: boolean, balanceShare = selfShare({ owner, ownerShare })) => {
    yoursBalance += balance * balanceShare;
    theirsBalance += balance * (owner === 'self' ? 0 : owner === 'partner' ? 1 : 1 - balanceShare);
    if (!closed) {
      yoursMonthly += contribution * selfShare({ owner, ownerShare }) * scale;
      theirsMonthly += contribution * partnerShare({ owner, ownerShare }) * scale;
    }
  };
  for (const account of data.accounts) {
    if (draft?.id === account.id) continue;
    addPortions(latestBalance(data.balances, account.id)?.balance ?? 0, account.monthlyContribution, account.owner, account.ownerShare, Boolean(account.closedOn), balanceSplit(account, data.balances).share);
  }
  if (draft) {
    const ownerShare = num(draft.myShare, 50) / 100;
    const split = balanceSplit({
      id: draft.id ?? '',
      owner: draft.owner,
      ownerShare,
      portionDate: draft.portionOn ? draft.portionDate || null : null,
      portionSelf: draft.portionOn ? num(draft.portionSelf) : null,
      monthlyContribution: num(draft.monthlyContribution),
    }, data.balances);
    addPortions(num(draft.balance), num(draft.monthlyContribution), draft.owner, ownerShare, Boolean(draft.closedOn), split.share);
  }
  const monthly = source.filter((account) => !account.closed).reduce((sum, account) => sum + account.monthlyContribution, 0) * scale;

  // Money that could be taken out now. Uses saved accounts only, with the open form's tick when editing.
  let accessibleTotal = 0;
  let accessibleSelf = 0;
  let lockedTotal = 0;
  for (const account of data.accounts) {
    const balance = latestBalance(data.balances, account.id)?.balance ?? 0;
    const open = draft?.id === account.id ? draft.accessible : account.accessible;
    if (!open) {
      lockedTotal += balance;
      continue;
    }
    accessibleTotal += balance;
    accessibleSelf += balance * (account.owner === 'self' ? 1 : account.owner === 'partner' ? 0 : balanceSplit(account, data.balances).share);
  }
  const end = points[points.length - 1];

  // All accounts: one stacked bar per account and year, and the money paid in as a line.
  const names = source.map((account) => account.name);
  const allData = points.map((point) => ({
    when: point.label,
    ...Object.fromEntries(source.map((account) => [account.name, Math.round(point.byAccount[account.id] ?? 0)])),
    'Paid in': Math.round(source
      .filter((account) => !allSeries.hidden.has(account.name))
      .reduce((sum, account) => sum + (point.contributedByAccount[account.id] ?? 0), 0)),
  }));

  // One account: recorded snapshots, the plan from the first snapshot, then the projection.
  const selected = source.find((account) => account.id === selectedId) ?? source[0] ?? null;
  const selectedAccount = selected ? data.accounts.find((account) => account.id === selected.id) ?? null : null;
  const snapshots = selected ? balancesFor(data.balances, selected.id) : [];
  // With a contribution history, the opening date is a known point: the account held nothing yet.
  const fromOpening = Boolean(selectedAccount?.openedOn && selectedAccount.contributionHistory.length && snapshots.length
    && (selectedAccount.openedOn as string) < snapshots[0].date);
  const history = fromOpening && selectedAccount
    ? [{ id: -1, accountId: selectedAccount.id, date: dayBefore(selectedAccount.openedOn as string), balance: 0, contributed: null, note: 'Opened' }, ...snapshots]
    : snapshots;
  const future = points.filter((point) => point.year > 0);
  const planName = fromOpening ? 'Plan from opening' : 'Plan from first snapshot';
  const planFrom = (date: string) => (selectedAccount && history.length >= 2
    ? Math.round(plannedAt({ ...selectedAccount, closed: Boolean(selectedAccount.closedOn) }, history[0].balance, history[0].date, date))
    : null);
  const accountData = history.length
    ? [
        ...history.map((row, index) => ({
          when: fmtDate(row.date),
          Recorded: row.balance,
          [planName]: planFrom(row.date),
          Projection: index === history.length - 1 ? row.balance : null,
        })),
        ...future.map((point) => ({
          when: point.label,
          Recorded: null,
          [planName]: null,
          Projection: selected ? Math.round(point.byAccount[selected.id] ?? 0) : 0,
        })),
      ]
    : points.map((point) => ({ when: point.label, Projection: selected ? Math.round(point.byAccount[selected.id] ?? 0) : 0 }));
  const accountItems: LegendItem[] = [
    ...(history.length ? [{ name: 'Recorded', color: 'gray' as const, line: true }] : []),
    ...(history.length >= 2 ? [{ name: planName, color: 'amber' as const, line: true, dashed: true }] : []),
    { name: 'Projection', color: 'blue', line: true },
  ];
  const accountShown = oneSeries.visible(accountItems);
  const allItems: LegendItem[] = [
    ...names.map((name, index) => ({ name, color: ACCOUNT_COLOURS[index % ACCOUNT_COLOURS.length] })),
    { name: 'Paid in', color: 'slate', line: true, dashed: true },
  ];
  const allBars = allSeries.visible(allItems.filter((item) => !item.line));
  const allLines = allSeries.visible(allItems.filter((item) => item.line));
  const selectedReturn = selected ? scenarioReturn(selected.annualReturnPct, selected.risk, scenario) : 0;

  return (
    <>
      <PageHeader
        title="Investments"
        description="Balances you record, compounded monthly at the return you expect. Projections start from each account's newest snapshot."
        actions={(
          <>
            <Button onClick={() => setCheckInOpen(true)} disabled={openIds.size === 0}><CalendarCheckIcon />Check-in</Button>
            <Button variant="outline" onClick={() => openDraft(blankDraft())}><PlusIcon />Add account</Button>
            <Button
              variant="ghost"
              onClick={() => {
                void exportCsv()
                  .then((result) => toast.success(`Wrote ${result.files.length} CSVs to ${result.directory}`))
                  .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
              }}
            >
              <DownloadIcon />Export CSV
            </Button>
          </>
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      {openIds.size > 0 && sinceCheckIn != null && sinceCheckIn > CHECK_IN_AFTER_DAYS && (
        <Alert>
          <CalendarCheckIcon />
          <AlertTitle>Time for a check-in</AlertTitle>
          <AlertDescription>The last one was {sinceCheckIn} days ago. A monthly check-in keeps the projections honest.</AlertDescription>
          <AlertAction><Button size="sm" onClick={() => setCheckInOpen(true)}>Check in now</Button></AlertAction>
        </Alert>
      )}

      <div className={cn('grid gap-4 sm:grid-cols-2', joint ? 'lg:grid-cols-3 xl:grid-cols-5' : 'lg:grid-cols-3')}>
        <Stat label="Total now" value={EUR(points[0]?.total ?? 0)} sub={`${EURExact(monthly)} / month going in`} />
        {joint && <Stat label={`${selfName}'s now`} value={EUR(yoursBalance)} sub={`${EURExact(yoursMonthly)} / month`} />}
        {joint && <Stat label={`${partnerName}'s now`} value={EUR(theirsBalance)} sub={`${EURExact(theirsMonthly)} / month`} />}
        <Stat
          label="Accessible now"
          value={EUR(accessibleTotal)}
          sub={joint
            ? `${selfName} ${EUR(accessibleSelf)} · ${partnerName} ${EUR(accessibleTotal - accessibleSelf)} · ${EUR(lockedTotal)} locked`
            : `${EUR(lockedTotal)} locked away`}
        />
        {end && source.length > 0 && (
          <Stat
            accent
            label={`In ${horizon} years · ${end.label}`}
            value={EUR(end.total)}
            sub={`${EUR(end.contributed)} paid in · ${EUR(end.growth)} growth${real ? ", today's euros" : ''}`}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>Click a name to show it in the account chart below.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                {joint && <TableHead>Owner</TableHead>}
                <TableHead>
                  <span className="inline-flex items-center gap-1">
                    Return
                    <InfoTip label="return">
                      <p>The expected return per year that the charts compound, and how risky the account is.</p>
                      <p>Risk sets how far the conservative and optimistic scenarios move the return.</p>
                    </InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Contribution
                    <InfoTip label="contribution"><p>What goes in each month now, and how that amount rises.</p></InfoTip>
                  </span>
                </TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    Versus plan
                    <InfoTip label="versus plan">
                      <p>Where the balance is compared with where the plan said it would be, counting from the first snapshot.</p>
                      <p>Realised is the return the snapshots show once money paid in is taken out. After {SUGGEST_AFTER_MONTHS} months of history it is offered as a replacement for the expected return. Nothing changes until you accept it.</p>
                    </InfoTip>
                  </span>
                </TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.accounts.length === 0 && (
                <TableRow><TableCell colSpan={joint ? 7 : 6} className="text-muted-foreground">No accounts yet. Add one, and the charts follow as you type.</TableCell></TableRow>
              )}
              {data.accounts.map((account) => {
                const snap = latestBalance(data.balances, account.id);
                const info = accountTypeInfo(account.type);
                const cal = calibrations.get(account.id) ?? null;
                const balance = snap?.balance ?? 0;
                const split = balanceSplit(account, data.balances);
                return (
                  <TableRow key={account.id} className={cn('align-top', account.closedOn && 'opacity-60', selected?.id === account.id && 'bg-muted/50')}>
                    <TableCell className="whitespace-normal">
                      <button type="button" className="text-left font-medium hover:underline" onClick={() => setSelectedId(account.id)}>{account.name}</button>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="secondary">{info.label}</Badge>
                        {account.treatment === 'income' && <Badge variant="outline">pays income</Badge>}
                        {account.closedOn && <Badge variant="outline">closed</Badge>}
                        {!account.accessible && (
                          <Tooltip>
                            <TooltipTrigger render={<Badge variant="outline" className="gap-1 text-amber-700" />}>
                              <LockIcon className="size-3" />locked
                            </TooltipTrigger>
                            <TooltipContent>Not accessible: taking this money out early would cost heavy tax or penalties. Left out of &ldquo;Accessible now&rdquo;. Change it with Edit.</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </TableCell>
                    {joint && (
                      <TableCell className="whitespace-normal">
                        {account.owner === 'joint' ? 'Joint' : personName(data.people, account.owner)}
                        {account.owner === 'joint' && (
                          <div className="text-xs text-muted-foreground">
                            {split.anchored ? 'Contributions ' : ''}{sharePercent(account.ownerShare)}% {selfName} · {sharePercent(partnerShare(account))}% {partnerName}
                          </div>
                        )}
                        {split.anchored && <div className="text-xs text-muted-foreground">Balance {sharePercent(split.share)}% {selfName}</div>}
                        {split.missingSnapshot && <div className="text-xs text-destructive">No snapshot on {fmtDate(account.portionDate ?? '')}, so the balance splits {sharePercent(account.ownerShare)}%</div>}
                      </TableCell>
                    )}
                    <TableCell>
                      {PCT(account.expectedReturnPct)}
                      <div className={cn('text-xs capitalize', RISK_TONE[account.risk])}>{account.risk} risk</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {EURExact(balance)}
                      <div className="text-xs text-muted-foreground">{snap ? fmtDate(snap.date) : 'no snapshot'}</div>
                      {account.owner === 'joint' && (
                        <div className="text-xs text-muted-foreground">{selfName} {EUR(split.selfAmount)} · {partnerName} {EUR(split.partnerAmount)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {EURExact(account.monthlyContribution)}
                      <div className="text-xs text-muted-foreground">{increaseText(account.contributionIncreaseKind, account.contributionIncreaseValue, account.contributionIncreaseEvery)}</div>
                    </TableCell>
                    <TableCell className="text-right">
                      <VersusPlan account={account} cal={cal} onUse={(pct) => void mutate(() => updateAccount(account.id, { expectedReturnPct: pct }))} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => openDraft(draftFromAccount(
                          account,
                          snap?.balance ?? null,
                          data.balances.find((row) => row.accountId === account.id && row.date === account.portionDate)?.balance ?? null,
                        ))}>Edit</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setFormError(null);
                            setBalanceFor(account);
                            setBalanceDate(todayIso());
                            setBalanceAmount(snap ? String(snap.balance) : '');
                          }}
                        >
                          Balance
                        </Button>
                        <ConfirmButton
                          label="Delete"
                          title={`Delete ${account.name}?`}
                          description="Its snapshot history goes with it. This cannot be undone."
                          onConfirm={() => void mutate(() => deleteAccount(account.id))}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Horizon</span>
            <Segmented label="Horizon" value={horizon} options={HORIZONS} onChange={setHorizon} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Scenario</span>
            <Segmented label="Scenario" value={scenario} options={SCENARIOS} onChange={setScenario} />
            <InfoTip label="scenarios">
              <p>Medium uses the expected return on each account.</p>
              <p>Conservative and optimistic move it down or up by ±{RISK_SPREAD.low} point for low risk, ±{RISK_SPREAD.medium} for medium, ±{RISK_SPREAD.high} for high. A 7% medium-risk ETF becomes 5% or 9%. Conservative never goes below 0%.</p>
            </InfoTip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={whatIfOpen || whatIfActive ? 'secondary' : 'outline'} size="sm" aria-expanded={whatIfOpen} onClick={() => setWhatIfOpen((on) => !on)}>
              <SlidersHorizontalIcon />What-if{whatIfActive ? ' (on)' : ''}
            </Button>
            <Button variant={real ? 'secondary' : 'outline'} size="sm" aria-pressed={real} onClick={() => setReal((on) => !on)}>
              Today&apos;s euros
            </Button>
            <TodaysEurosTip inflationPct={data.settings.inflationPct} />
          </div>
          {whatIfOpen && (
            <>
              <Separator />
              <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <NumberField label="Contributions, %" hint="Of what you pay in now. 0 stops paying in." value={contribPct} step="10" min={0} max={300} resetKey={`c${contribPct === 100}`} onChange={(value) => setContribPct(value ?? 100)} />
                <NumberField label="Return adjustment, points" hint="Added to every account, on top of the scenario." value={returnDelta} step="0.5" resetKey={`r${returnDelta === 0}`} onChange={(value) => setReturnDelta(value ?? 0)} />
                <NumberField label="One-off lump sum, €" hint="Put in today, split by balance." value={lumpSum} step="1000" min={0} resetKey={`l${lumpSum === 0}`} onChange={(value) => setLumpSum(value ?? 0)} />
                <div className="flex items-end">
                  <Button variant="ghost" onClick={() => { setContribPct(100); setReturnDelta(0); setLumpSum(0); }}>Reset what-ifs</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All accounts</CardTitle>
          <CardDescription>{real ? `Today's euros, ${data.settings.inflationPct}% inflation.` : 'Nominal euros, before inflation.'} The dashed line is the money paid in (today's balances plus every contribution until then); the part of each bar above it is growth. Locked accounts start hidden. Click a legend entry to show or hide it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {source.length > 0 && <ChartLegend items={allItems} hidden={allSeries.hidden} onToggle={allSeries.toggle} onShowAll={allSeries.showAll} />}
          {source.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add an account to see where the contributions land.</p>
          ) : (
            <ComboChart
              className="h-80"
              data={allData}
              index="when"
              showLegend={false}
              tooltipFooter={(payload) => {
                const total = payload.filter((item) => item.chartType === 'bar').reduce((sum, item) => sum + (item.value ?? 0), 0);
                const paid = payload.find((item) => item.chartType === 'line')?.value;
                return [
                  { label: 'Total', value: EUR(total) },
                  ...(paid == null ? [] : [{ label: total >= paid ? 'Growth' : 'Loss', value: EUR(Math.abs(total - paid)) }]),
                ];
              }}
              barSeries={{ ...allBars, type: 'stacked', valueFormatter: EUR, yAxisWidth: 80 }}
              lineSeries={{ ...allLines, valueFormatter: EUR, dashedCategories: ['Paid in'] }}
            />
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle>{selected.name}</CardTitle>
            <CardDescription>
              {SCENARIOS.find((item) => item.value === scenario)?.label}: {PCT(selectedReturn)} a year
              {returnDelta !== 0 ? `, ${returnDelta > 0 ? '+' : '−'}${Math.abs(returnDelta)} from the what-if` : ''}. Expected {PCT(selected.annualReturnPct)}, {selected.risk} risk.
            </CardDescription>
            {source.length > 1 && (
              <CardAction>
                <Segmented label="Account" value={selected.id} options={source.map((account) => ({ value: account.id, label: account.name }))} onChange={setSelectedId} />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <ChartLegend items={accountItems} hidden={oneSeries.hidden} onToggle={oneSeries.toggle} onShowAll={oneSeries.showAll} />
            <AreaChart
              className="h-72"
              data={accountData}
              index="when"
              categories={accountShown.categories}
              colors={accountShown.colors}
              dashedCategories={[planName]}
              valueFormatter={EUR}
              yAxisWidth={80}
              showLegend={false}
            />
            {snapshots.length > 0 && (
              <Collapsible>
                <CollapsibleTrigger render={<Button variant="ghost" size="sm" />}>
                  {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                        <TableHead className="text-right">Paid in since previous</TableHead>
                        <TableHead>Note</TableHead>
                        <TableHead className="w-0" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshots.slice().reverse().map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{fmtDate(row.date)}</TableCell>
                          <TableCell className="text-right tabular-nums">{EURExact(row.balance)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.contributed == null ? <span className="text-muted-foreground">as planned</span> : EURExact(row.contributed)}</TableCell>
                          <TableCell className="whitespace-normal">{row.note}</TableCell>
                          <TableCell>
                            <ConfirmButton
                              label="Delete"
                              size="xs"
                              variant="ghost"
                              title={`Delete the ${fmtDate(row.date)} snapshot?`}
                              description="Projections will start from the snapshot before it."
                              onConfirm={() => void mutate(() => deleteBalance(row.id))}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      <AccountEditor
        draft={draft}
        split={draft && draft.owner === 'joint' ? balanceSplit({
          id: draft.id ?? '',
          owner: 'joint',
          ownerShare: num(draft.myShare, 50) / 100,
          portionDate: draft.portionOn && draft.portionDate ? draft.portionDate : null,
          portionSelf: draft.portionOn && draft.portionSelf.trim() !== '' ? num(draft.portionSelf) : null,
          monthlyContribution: num(draft.monthlyContribution),
          openedOn: draft.openedOn || null,
          closedOn: draft.closedOn || null,
          contributionHistory: historyToWrite(draft.history),
        }, draftBalances(data.balances, draft)) : null}
        mode={data.settings.householdMode}
        selfName={selfName}
        partnerName={partnerName}
        saving={saving}
        error={formError}
        onChange={updateDraft}
        onType={changeType}
        onClose={() => void closeDraft()}
      />

      <CheckIn
        open={checkInOpen}
        accounts={data.accounts}
        balances={data.balances}
        saving={saving}
        onSave={async (rows) => {
          await mutate(() => addBalances(rows));
          setCheckInOpen(false);
          toast.success(`Saved ${rows.length} balance${rows.length === 1 ? '' : 's'}`);
        }}
        onClose={() => setCheckInOpen(false)}
      />

      <Dialog open={balanceFor != null} onOpenChange={(open) => { if (!open) setBalanceFor(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a balance</DialogTitle>
            <DialogDescription>{balanceFor?.name}. A new date adds a snapshot; the same date replaces it. For all accounts at once, use Check-in.</DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void saveBalance(); }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FieldRow label="Date"><Input type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value)} required /></FieldRow>
              <FieldRow label="Balance"><Input type="number" step="0.01" value={balanceAmount} onChange={(event) => setBalanceAmount(event.target.value)} required /></FieldRow>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBalanceFor(null)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save snapshot'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function VersusPlan({ account, cal, onUse }: { account: Account; cal: Calibration | null; onUse: (pct: number) => void }) {
  if (!cal) return <span className="text-xs text-muted-foreground">After 2 snapshots</span>;
  const ahead = cal.varianceTotal >= 0;
  const realised = cal.realisedReturnPct == null ? null : Math.round(cal.realisedReturnPct * 10) / 10;
  return (
    <div className="space-y-0.5">
      <div className={cn('font-medium tabular-nums', ahead ? 'text-emerald-600' : 'text-destructive')}>{ahead ? '+' : '−'}{EUR(Math.abs(cal.varianceTotal))}</div>
      <div className="text-xs text-muted-foreground">
        since {cal.fromOpening ? 'opening' : fmtDate(cal.firstDate)}
        {Math.abs(cal.contributionGap) >= 1 ? ` · paid in ${cal.contributionGap > 0 ? '+' : '−'}${EUR(Math.abs(cal.contributionGap))}` : ''}
      </div>
      {realised != null && (
        <div className="inline-flex items-center justify-end gap-1 text-xs text-muted-foreground">
          {cal.assumedFlows ? '≈ ' : ''}realised {PCT(realised)} / yr
          {cal.assumedFlows && (
            <InfoTip label="this estimate">
              <p>This guesses what was paid in: {EURExact(account.monthlyContribution)} every month since {fmtDate(cal.firstDate)}, about {EUR(cal.plannedFlows)} in all. If you paid in less, the real return is higher; if more, lower.</p>
              <p>For a reliable figure, add the real total to the {fmtDate(cal.lastDate)} snapshot: do a check-in dated {fmtDate(cal.lastDate)} with the same balance ({EURExact(cal.actualBalance)}) and the real amount in &ldquo;Paid in since&rdquo;. It replaces that snapshot. Until then nothing is suggested.</p>
            </InfoTip>
          )}
        </div>
      )}
      {cal.suggestedReturnPct != null && (
        <ConfirmButton
          label={`Use ${PCT(cal.suggestedReturnPct)}`}
          variant="outline"
          size="xs"
          confirmVariant="default"
          confirmLabel={`Use ${PCT(cal.suggestedReturnPct)}`}
          title="Change the expected return?"
          description={`This changes ${account.name}'s expected return from ${PCT(account.expectedReturnPct)} to ${PCT(cal.suggestedReturnPct)}, the return its snapshots show since ${fmtDate(cal.firstDate)}. Every projection and the retirement plan will use it. You can change it back with Edit.`}
          onConfirm={() => onUse(cal.suggestedReturnPct as number)}
        />
      )}
    </div>
  );
}

/** Saved snapshots plus what the open form says, so the split in the form moves as you type. */
function draftBalances(balances: Balance[], draft: Draft): Balance[] {
  if (!draft.id) return balances;
  const extra: Balance[] = [];
  const put = (date: string, value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value.trim() === '' || !Number.isFinite(Number(value))) return;
    const existing = balances.find((row) => row.accountId === draft.id && row.date === date);
    extra.push({ id: Number.MAX_SAFE_INTEGER - extra.length, accountId: draft.id as string, date, balance: Number(value), contributed: existing?.contributed ?? null, note: '' });
  };
  if (draft.portionOn) put(draft.portionDate, draft.portionBalance);
  put(draft.balanceDate, draft.balance);
  const replaced = new Set(extra.map((row) => row.date));
  return [...balances.filter((row) => row.accountId !== draft.id || !replaced.has(row.date)), ...extra];
}
