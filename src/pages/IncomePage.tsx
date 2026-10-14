import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BabyIcon, PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ComboChart } from '@/components/charts/ComboChart';
import { ChartLegend, useHiddenSeries, type LegendItem } from '@/components/charts/ChartLegend';
import { IncreaseFields } from '../components/IncreaseFields';
import { IncomeEditor, type IncomeDraft } from '../components/IncomeEditor';
import { ConfirmButton, NumberField, PageHeader, Segmented, TodaysEurosTip } from '../components/kit';
import { PotSummary } from '../components/PotSummary';
import { useEditableFinance } from '../hooks/useEditableFinance';
import { useFinanceData } from '../hooks/useFinanceData';
import { useRetirementPlan } from '../hooks/useRetirementPlan';
import { createIncome, deleteIncome, updateIncome, updatePerson, updateSettings } from '../lib/api';
import type { AvailableChartColorsKeys } from '../lib/chartColors';
import { EUR, EURExact, fmtDate } from '../lib/format';
import { grownMonthly } from '../lib/projection';
import {
  grossFromRvEmployee,
  pensionKeepAfterSocial,
  zusatzRateFromPayslip,
  type PathYear,
} from '../lib/retirement';
import { incomeActive, personName, selfShare, todayIso, type FinanceData, type FinanceSettings, type Person } from '../lib/types';

type Money = 'today' | 'nominal';

export function IncomePage() {
  const { data, mutate, saving } = useFinanceData();
  const { finance, patchSettings, patchPerson } = useEditableFinance(data, mutate, updateSettings, updatePerson);
  const plan = useRetirementPlan(finance);
  const [money, setMoney] = useState<Money>('today');
  const [incomeDraft, setIncomeDraft] = useState<IncomeDraft | null>(null);
  if (!finance || !plan) return null;

  const mode = finance.settings.householdMode;
  const joint = mode === 'joint';
  const people = finance.people.filter((person) => joint || person.id === 'self');
  const selfName = personName(finance.people, 'self');
  const partnerName = personName(finance.people, 'partner');
  const base = plan.solved.base;
  const inflation = finance.settings.inflationPct;
  const todays = money === 'today';
  const deflate = (amount: number, yearOffset: number) => (todays && inflation !== 0 ? amount / (1 + inflation / 100) ** yearOffset : amount);
  const included = new Set(plan.request.scope === 'household' ? plan.request.people.map((person) => person.id) : ['self']);
  const today = todayIso();
  const ownerLabel = (owner: string) => (owner === 'joint' ? 'Joint' : personName(finance.people, owner === 'partner' ? 'partner' : 'self'));

  return (
    <>
      <PageHeader
        title="Income"
        description={(
          <>
            Pay and other income now, and where the money comes from once you stop working. Retirement figures follow the plan on{' '}
            <Link to="/retirement" className="underline underline-offset-4">Retirement</Link>, {plan.request.scope === 'household' ? 'for the household' : 'for you alone'}.
          </>
        )}
      />

      <Card>
        <CardHeader>
          <CardTitle>{joint ? 'The household pot' : 'Money in and out'}</CardTitle>
          <CardDescription>Per month, as things are today.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-8 md:grid-cols-2">
          <PotSummary pot={plan.spending.pot} mode={mode} selfName={selfName} partnerName={partnerName} />
          <div className="grid content-start gap-4">
            <NumberField label="Rent or housing € / month" step="1" min={0} value={finance.settings.rentMonthly} onChange={(value) => patchSettings({ rentMonthly: value ?? 0 })} />
            <NumberField
              label={joint ? 'Other shared costs € / month' : 'Other spending € / month'}
              hint={joint ? 'Food, holidays, utilities, childcare. Not investments.' : 'Not investments.'}
              step="1"
              min={0}
              value={finance.settings.sharedSpendMonthly}
              onChange={(value) => patchSettings({ sharedSpendMonthly: value ?? 0 })}
            />
            {joint && (
              <SharedShareField
                settings={finance.settings}
                selfNet={finance.people.find((person) => person.id === 'self')?.netSalaryMonthly ?? 0}
                partnerNet={finance.people.find((person) => person.id === 'partner')?.netSalaryMonthly ?? 0}
                onSave={(value) => patchSettings({ sharedCostShare: value })}
              />
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Other income</CardTitle>
          <CardDescription>
            Kindergeld, rent from a flat, a side business. While you work it adds to the pot; once you stop, it pays part of your spending for as long as it lasts.
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setIncomeDraft({ name: 'Kindergeld', owner: joint ? 'joint' : 'self', intoPot: true, indexed: true })}>
              <BabyIcon />Kindergeld
            </Button>
            <Button size="sm" onClick={() => setIncomeDraft({})}><PlusIcon />Add income</Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Income</TableHead>
                {joint && <TableHead>Whose</TableHead>}
                <TableHead className="text-right">Per month</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {finance.incomes.length === 0 && (
                <TableRow><TableCell colSpan={joint ? 5 : 4} className="text-muted-foreground">Nothing yet. Add Kindergeld or any other regular income.</TableCell></TableRow>
              )}
              {finance.incomes.map((income) => {
                const active = incomeActive(income, today);
                return (
                  <TableRow key={income.id} className={active ? '' : 'text-muted-foreground'}>
                    <TableCell className="whitespace-normal">
                      <span className="font-medium">{income.name}</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!active && <Badge variant="outline">{income.startsOn && income.startsOn > today ? 'not yet' : 'ended'}</Badge>}
                        {joint && <Badge variant="secondary">{income.intoPot ? 'into the pot' : 'kept by owner'}</Badge>}
                        {!income.indexed && <Badge variant="outline">fixed amount</Badge>}
                      </div>
                    </TableCell>
                    {joint && <TableCell>{ownerLabel(income.owner)}</TableCell>}
                    <TableCell className="text-right tabular-nums">{EURExact(income.amountMonthly)}</TableCell>
                    <TableCell className="whitespace-normal">
                      {income.startsOn ? `From ${fmtDate(income.startsOn)}` : 'Now'}
                      {' – '}
                      {income.endsOn ? `until ${fmtDate(income.endsOn)}` : 'no end'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => setIncomeDraft(income)}>Edit</Button>
                        <ConfirmButton
                          label="Delete"
                          title={`Delete ${income.name}?`}
                          description="It leaves the pot and the retirement plan."
                          onConfirm={() => void mutate(() => deleteIncome(income.id))}
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

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Pay</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {people.map((person) => (
            <SalaryCard
              key={person.id}
              person={person}
              joint={joint}
              cap={finance.settings.contributionCapMonthly}
              taxKeep={finance.settings.pensionTaxKeep}
              sharedKeep={finance.settings.pensionNetFactor}
              yearsOut={base.stopOffset ?? 0}
              onSave={(patch) => patchPerson(person.id, patch)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Income in retirement</h2>
          <div className="flex items-center gap-2">
            <Segmented label="Money" value={money} options={[{ value: 'today', label: "Today's euros" }, { value: 'nominal', label: 'With inflation' }]} onChange={setMoney} />
            <TodaysEurosTip inflationPct={inflation} />
          </div>
        </div>
        {base.reason === 'missing-birth' ? (
          <p className="text-sm text-muted-foreground">
            Add {base.missingPersonId === 'partner' ? `${partnerName}'s` : 'your'} date of birth in <Link to="/setup" className="underline">Setup</Link> to see this.
          </p>
        ) : (
          <>
            <IncomeSources finance={finance} path={base.path} included={included} scope={plan.request.scope} deflate={deflate} todays={todays} />
            <Card>
              <CardHeader>
                <CardTitle>Where the money comes from</CardTitle>
                <CardDescription>
                  One bar per year of {selfName}&apos;s life. Until you stop, pay covers spending. After that, pensions and other income come first, and the portfolio fills the rest up to the spending line.
                  {base.ok ? '' : ' The bars stop where the portfolio runs out.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LifetimeChart
                  path={base.path}
                  people={people.filter((person) => included.has(person.id))}
                  names={{
                    ...Object.fromEntries(finance.accounts.map((account) => [account.id, account.name])),
                    ...Object.fromEntries(finance.incomes.map((income) => [income.id, income.name])),
                  }}
                  deflate={deflate}
                />
              </CardContent>
            </Card>
          </>
        )}
      </section>

      <IncomeEditor
        draft={incomeDraft}
        mode={mode}
        selfName={selfName}
        partnerName={partnerName}
        saving={saving}
        onClose={() => setIncomeDraft(null)}
        onSave={async (id, income) => {
          await mutate(() => (id ? updateIncome(id, income) : createIncome(income)));
          setIncomeDraft(null);
          toast.success(id ? `Updated ${income.name}` : `Added ${income.name}`);
        }}
      />
    </>
  );
}

function SharedShareField({ settings, selfNet, partnerNet, onSave }: { settings: FinanceSettings; selfNet: number; partnerNet: number; onSave: (value: number | null) => void }) {
  const weighted = selfNet > 0 && partnerNet > 0 ? Math.round((selfNet / (selfNet + partnerNet)) * 1000) / 10 : 50;
  return (
    <NumberField
      label="Your share of shared costs, %"
      hint={`Used for Just me retirement. Blank weights it by take-home pay: ${weighted}%.`}
      step="1"
      min={0}
      max={100}
      value={settings.sharedCostShare == null ? null : Math.round(settings.sharedCostShare * 1000) / 10}
      onChange={(value) => onSave(value == null ? null : Math.min(100, Math.max(0, value)) / 100)}
    />
  );
}

function payslipHealthPatch(kv: number | null, zusatz: number | null): Partial<Person> {
  const rate = kv != null && zusatz != null ? zusatzRateFromPayslip(kv, zusatz) : null;
  return {
    payslipKvMonthly: kv,
    payslipZusatzMonthly: zusatz,
    ...(rate != null ? { payslipZusatzRatePct: Math.round(rate * 100) / 100 } : {}),
  };
}

function SalaryCard({
  person,
  joint,
  cap,
  taxKeep,
  sharedKeep,
  yearsOut,
  onSave,
}: {
  person: Person;
  joint: boolean;
  cap: number;
  taxKeep: number;
  sharedKeep: number;
  yearsOut: number;
  onSave: (patch: Partial<Person>) => void;
}) {
  const [increaseValue, setIncreaseValue] = useState(String(person.salaryIncreaseValue ?? 0));
  const net = person.netSalaryMonthly ?? 0;
  const socialKeep = person.payslipZusatzRatePct == null ? null : pensionKeepAfterSocial(person.payslipZusatzRatePct);
  const keep = socialKeep == null ? null : socialKeep * taxKeep;
  const laterNet = grownMonthly(net, { kind: person.salaryIncreaseKind, value: person.salaryIncreaseValue, every: 'year' }, Math.round(Math.max(0, yearsOut) * 12));
  return (
    <Card>
      <CardHeader><CardTitle>{person.name}</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Take-home € / month" step="1" min={0} value={person.netSalaryMonthly} onChange={(value) => onSave({ netSalaryMonthly: value })} />
          {joint && <NumberField label="Allowance € / month" hint="From the pot. Personal investments come out of it." step="1" min={0} value={person.personalAllowanceMonthly} onChange={(value) => onSave({ personalAllowanceMonthly: value })} />}
        </div>
        <NumberField
          label="Gross salary € / year"
          hint="Sets future pension points, up to the yearly cap."
          value={person.grossSalaryMonthly == null ? null : Math.round(person.grossSalaryMonthly * 12)}
          resetKey={`${person.id}-annual-rv-${person.payslipRvMonthly ?? ''}`}
          step="1"
          onChange={(value) => onSave({ grossSalaryMonthly: value == null ? null : value / 12 })}
        />
        {person.grossSalaryMonthly != null && cap > 0 && person.grossSalaryMonthly > cap && (
          <p className="text-xs text-muted-foreground">Points use {EUR(cap * 12)} a year of this {EUR(person.grossSalaryMonthly * 12)}. Pay above the cap earns no extra pension points.</p>
        )}
        <IncreaseFields
          legend="Pay rise each year"
          kind={person.salaryIncreaseKind}
          value={increaseValue}
          every="year"
          allowMonthly={false}
          start={net}
          onChange={(next) => {
            setIncreaseValue(next.value);
            const parsed = next.value.trim() === '' ? 0 : Number(next.value);
            onSave({ salaryIncreaseKind: next.kind, salaryIncreaseEvery: 'year', ...(Number.isFinite(parsed) ? { salaryIncreaseValue: parsed } : {}) });
          }}
        />
        {net > 0 && yearsOut > 0 && (
          <p className="text-xs text-muted-foreground">When you stop, about {yearsOut.toFixed(1).replace(/\.0$/, '')} years from now, take-home would be {EURExact(laterNet)} a month if this rise continues. A rise is not invested on its own.</p>
        )}
        <Collapsible>
          <CollapsibleTrigger render={<Button variant="ghost" size="sm" className="-ml-2" />}>Payslip details</CollapsibleTrigger>
          <CollapsibleContent className="grid gap-4 pt-2">
            <p className="text-xs text-muted-foreground">Optional, until the Renteninformation arrives. The pension line sets the pay that earns points. The health lines set how much of the pension is left after health and care insurance.</p>
            <NumberField
              label="Pension contribution (RV-AN) € / month"
              hint={`9.3% of pensionable pay; ${EURExact(cap * 0.093)} is the 2026 maximum.`}
              value={person.payslipRvMonthly}
              onChange={(value) => onSave({ payslipRvMonthly: value, ...(value != null ? { grossSalaryMonthly: grossFromRvEmployee(value, cap) } : {}) })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField label="Health (KV-AN) € / month" value={person.payslipKvMonthly} onChange={(value) => onSave(payslipHealthPatch(value, person.payslipZusatzMonthly))} />
              <NumberField label="Zusatzbeitrag, your half € / month" value={person.payslipZusatzMonthly} onChange={(value) => onSave(payslipHealthPatch(person.payslipKvMonthly, value))} />
            </div>
            <NumberField
              label="Full Zusatzbeitrag rate %"
              hint="Or type the health fund's rate directly, for example 2.5."
              step="0.01"
              value={person.payslipZusatzRatePct}
              resetKey={`${person.id}-zusatz-${person.payslipKvMonthly ?? ''}-${person.payslipZusatzMonthly ?? ''}`}
              onChange={(value) => onSave({ payslipZusatzRatePct: value })}
            />
            {keep != null && socialKeep != null && (
              <p className="text-xs text-muted-foreground">
                Health and care insurance leave about {(socialKeep * 100).toFixed(1)}% of the gross pension; income tax then keeps about {(taxKeep * 100).toFixed(0)}% (a guess).
                Together about {(keep * 100).toFixed(1)}%. Clear the rate to use the shared {(sharedKeep * 100).toFixed(0)}% instead.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

interface SourceRow {
  key: string;
  label: string;
  startAge: number | null;
  monthly: number;
  note: string;
}

function firstWith(path: PathYear[], pick: (point: PathYear) => number | undefined): PathYear | null {
  return path.find((point) => (pick(point) ?? 0) > 0) ?? null;
}

function IncomeSources({
  finance,
  path,
  included,
  scope,
  deflate,
  todays,
}: {
  finance: FinanceData;
  path: PathYear[];
  included: Set<string>;
  scope: 'individual' | 'household';
  deflate: (amount: number, yearOffset: number) => number;
  todays: boolean;
}) {
  const retiredFrom = path.findIndex((point) => Object.keys(point.income.salary).length === 0);
  const afterStop = retiredFrom < 0 ? [] : path.slice(retiredFrom);
  const rows: SourceRow[] = [];
  for (const person of finance.people.filter((row) => included.has(row.id))) {
    const point = firstWith(path, (p) => p.income.statePension[person.id]);
    const keep = person.payslipZusatzRatePct == null
      ? finance.settings.pensionNetFactor
      : pensionKeepAfterSocial(person.payslipZusatzRatePct) * finance.settings.pensionTaxKeep;
    rows.push({
      key: `state-${person.id}`,
      label: `State pension, ${person.name}`,
      startAge: point ? point.ages[person.id] : null,
      monthly: point ? deflate(point.income.statePension[person.id], point.yearOffset) / 12 : 0,
      note: point ? `net, ${Math.round(keep * 100)}% of gross` : 'not reached in this plan',
    });
  }
  for (const account of finance.accounts) {
    if (account.closedOn || account.treatment !== 'income') continue;
    if (scope === 'individual' && account.owner === 'partner') continue;
    const point = firstWith(path, (p) => p.income.accounts[account.id]);
    const share = scope === 'individual' ? selfShare(account) : 1;
    rows.push({
      key: account.id,
      label: account.name,
      startAge: point ? point.ages.self ?? null : null,
      monthly: point ? deflate(point.income.accounts[account.id], point.yearOffset) / 12 : (account.incomeMonthly ?? 0) * share,
      note: share < 1 ? `your ${Math.round(share * 100)}%` : 'as entered',
    });
  }
  for (const income of finance.incomes) {
    if (scope === 'individual' && income.owner === 'partner') continue;
    const point = firstWith(afterStop, (p) => p.income.other[income.id]);
    rows.push({
      key: income.id,
      label: income.name,
      startAge: point ? point.ages.self ?? null : null,
      monthly: point ? deflate(point.income.other[income.id], point.yearOffset) / 12 : 0,
      note: point ? (scope === 'individual' && income.owner === 'joint' ? 'half, as it is joint' : 'other income') : 'stops before you do',
    });
  }
  const drawPoint = firstWith(path, (p) => p.income.portfolioDraw);
  return (
    <Card>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>From age</TableHead>
              <TableHead className="text-right">Per month{todays ? ", today's euros" : ', in that year'}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">{row.label}</TableCell>
                <TableCell>{row.startAge == null ? '—' : Math.round(row.startAge)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.monthly > 0 ? EURExact(row.monthly) : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{row.note}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-medium">Portfolio drawdown</TableCell>
              <TableCell>{drawPoint ? Math.round(drawPoint.ages.self ?? drawPoint.yearOffset) : '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{drawPoint ? EURExact(deflate(drawPoint.income.portfolioDraw, drawPoint.yearOffset) / 12) : '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">the rest of spending, in the first year</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">A bAV or annuity goes on Investments: set &ldquo;In retirement&rdquo; to &ldquo;Pays a monthly income&rdquo;.</p>
      </CardContent>
    </Card>
  );
}

function LifetimeChart({
  path,
  people,
  names,
  deflate,
}: {
  path: PathYear[];
  people: Person[];
  names: Record<string, string>;
  deflate: (amount: number, yearOffset: number) => number;
}) {
  const hidden = useHiddenSeries();
  const accountIds = [...new Set(path.flatMap((point) => Object.keys(point.income.accounts)))];
  const otherIds = [...new Set(path.flatMap((point) => Object.keys(point.income.other)))];
  const series: { key: string; color: AvailableChartColorsKeys; pick: (point: PathYear) => number }[] = [
    ...people.map((person, index) => ({ key: `Pay, ${person.name}`, color: (index ? 'sky' : 'blue') as AvailableChartColorsKeys, pick: (p: PathYear) => p.income.salary[person.id] ?? 0 })),
    ...people.map((person, index) => ({ key: `State pension, ${person.name}`, color: (index ? 'teal' : 'emerald') as AvailableChartColorsKeys, pick: (p: PathYear) => p.income.statePension[person.id] ?? 0 })),
    ...accountIds.map((id) => ({ key: names[id] ?? 'Income account', color: 'violet' as AvailableChartColorsKeys, pick: (p: PathYear) => p.income.accounts[id] ?? 0 })),
    ...otherIds.map((id) => ({ key: names[id] ?? 'Other income', color: 'pink' as AvailableChartColorsKeys, pick: (p: PathYear) => p.income.other[id] ?? 0 })),
    { key: 'From the portfolio', color: 'amber', pick: (p: PathYear) => p.income.portfolioDraw },
  ];
  const data = path.map((point) => ({
    age: String(Math.round(point.ages.self ?? point.yearOffset)),
    ...Object.fromEntries(series.map((item) => [item.key, Math.round(deflate(item.pick(point), point.yearOffset))])),
    Spending: Math.round(deflate(point.spendingAnnual, point.yearOffset)),
  }));
  const present = series.filter((item) => data.some((row) => (row as Record<string, number | string>)[item.key] as number > 0));
  const barItems: LegendItem[] = present.map((item) => ({ name: item.key, color: item.color }));
  const lineItems: LegendItem[] = [{ name: 'Spending', color: 'red', line: true }];
  const shownBars = hidden.visible(barItems);
  const shownLines = hidden.visible(lineItems);
  return (
    <div className="space-y-3">
      <ChartLegend items={[...barItems, ...lineItems]} hidden={hidden.hidden} onToggle={hidden.toggle} onShowAll={hidden.showAll} />
      <ComboChart
        className="h-96"
        data={data}
        index="age"
        xAxisLabel="Age"
        showLegend={false}
        barSeries={{ ...shownBars, type: 'stacked', valueFormatter: (value) => `${EUR(value)} / yr`, yAxisWidth: 80 }}
        lineSeries={{ ...shownLines, valueFormatter: (value) => `${EUR(value)} / yr` }}
      />
    </div>
  );
}
