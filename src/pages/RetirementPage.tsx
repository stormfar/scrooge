import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from 'cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ComboChart } from '@/components/charts/ComboChart';
import { ChartLegend, useHiddenSeries, type LegendItem } from '@/components/charts/ChartLegend';
import { CheckField, FieldRow, NumberField, PageHeader, Segmented, SimpleSelect, SumList, TodaysEurosTip } from '../components/kit';
import { useEditableFinance } from '../hooks/useEditableFinance';
import { useFinanceData } from '../hooks/useFinanceData';
import { useRetirementPlan } from '../hooks/useRetirementPlan';
import { updatePerson, updateSettings } from '../lib/api';
import { daysSinceCheckIn } from '../lib/calibration';
import { balanceSplit } from '../lib/portion';
import type { AvailableChartColorsKeys } from '../lib/chartColors';
import { EUR, EURExact } from '../lib/format';
import type { Pot } from '../lib/household';
import {
  ageYears,
  retirementAtAge,
  solveRetirement,
  type ScenarioResult,
} from '../lib/retirement';
import { latestBalance, personName, selfShare, todayIso, type FinanceData, type HouseholdMode, type Person, type RetirementScope } from '../lib/types';

const PART_COLOURS: AvailableChartColorsKeys[] = ['blue', 'amber', 'violet', 'cyan', 'pink', 'lime', 'fuchsia'];

type CheckStatus = 'recorded' | 'estimate' | 'missing';
type DataCheck = { label: string; status: CheckStatus; detail: string; weight: number };

function retirementConfidence(finance: FinanceData): { score: number; checks: DataCheck[] } {
  const self = finance.people.find((person) => person.id === 'self');
  const partner = finance.people.find((person) => person.id === 'partner');
  const household = finance.settings.householdMode === 'joint' && finance.settings.retirementScope === 'household';
  const open = finance.accounts.filter((account) => !account.closedOn);
  const withBalance = open.filter((account) => latestBalance(finance.balances, account.id));
  const history = open.filter((account) => finance.balances.filter((row) => row.accountId === account.id).length >= 2);
  const pots = open.filter((account) => (account.type === 'private_pension' || account.type === 'bav') && account.treatment !== 'income');
  const since = daysSinceCheckIn(finance.balances, new Set(open.map((account) => account.id)), todayIso());
  const overridden = household
    ? finance.settings.spendingHouseholdMonthly != null
    : finance.settings.spendingPersonalMonthly != null;
  const checks: DataCheck[] = [
    { label: 'Setup', status: finance.settings.onboarded ? 'recorded' : 'missing', detail: finance.settings.onboarded ? 'Pay, allowances, rent and shared costs are entered.' : 'Spending in retirement comes from the setup.', weight: 12 },
    { label: 'Date of birth', status: self?.birthDate ? 'recorded' : 'missing', detail: self?.birthDate ? 'Used to turn the plan into an age.' : 'The age cannot be calculated without it.', weight: 12 },
    { label: 'Renteninformation', status: self?.pensionStatedMonthly ? 'recorded' : 'missing', detail: self?.pensionStatedMonthly ? `€${Math.round(self.pensionStatedMonthly)} a month at 67, from the letter.` : 'Without the letter, the pension is estimated from salary.', weight: 16 },
    { label: 'Gross salary', status: self?.grossSalaryMonthly ? 'recorded' : 'missing', detail: self?.grossSalaryMonthly ? `€${Math.round(self.grossSalaryMonthly * 12)} a year. Points stop at the cap.` : 'Future pension points need a salary (Income page).', weight: 8 },
    { label: 'Take-home pay', status: self?.netSalaryMonthly ? 'recorded' : 'missing', detail: self?.netSalaryMonthly ? 'Sets the pot and your share of shared costs.' : 'Needed for the pot and the share of shared costs.', weight: 8 },
    { label: 'Health fund rate', status: self?.payslipZusatzRatePct != null ? 'recorded' : 'missing', detail: self?.payslipZusatzRatePct != null ? `Zusatzbeitrag ${self.payslipZusatzRatePct}%.` : 'Without it, the pension uses the shared 85% keep factor.', weight: 6 },
    { label: 'Tax on the pension', status: 'estimate', detail: `Keeping ${Math.round(finance.settings.pensionTaxKeep * 100)}% after income tax is a guess, not a tax return.`, weight: 6 },
    { label: 'Spending', status: overridden ? 'recorded' : 'estimate', detail: overridden ? 'You typed a retirement spending figure.' : 'From the setup: allowances and shared costs as planned, not as measured. Real spending is often higher.', weight: 10 },
    { label: 'Investment balances', status: open.length > 0 && withBalance.length === open.length ? 'recorded' : 'missing', detail: open.length === 0 ? 'No accounts yet.' : `${withBalance.length} of ${open.length} accounts have a balance.`, weight: 10 },
    { label: 'Recent check-in', status: since != null && since <= 45 ? 'recorded' : since == null ? 'missing' : 'estimate', detail: since == null ? 'No snapshots yet.' : `The newest snapshot is ${since} days old.`, weight: 6 },
    { label: 'Balance history', status: history.length > 0 ? 'recorded' : 'estimate', detail: history.length > 0 ? 'At least one account has more than one snapshot, so returns can be checked.' : 'One snapshot each, so expected returns are not yet checked against reality.', weight: 4 },
    { label: 'Expected returns', status: 'estimate', detail: 'The return on each account is a judgement, not a guarantee.', weight: 6 },
  ];
  if (pots.length > 0) {
    checks.push({ label: 'Private pension payout', status: 'estimate', detail: `${pots.map((account) => account.name).join(', ')} is drawn down as a pot. The monthly pension it will pay is not entered.`, weight: 10 });
  }
  if (household) {
    checks.push({ label: `${partner?.name ?? 'Partner'}'s date of birth`, status: partner?.birthDate ? 'recorded' : 'missing', detail: partner?.birthDate ? 'Household age can be calculated.' : 'Household mode needs both dates of birth.', weight: 12 });
  }
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.status === 'recorded' ? check.weight : check.status === 'estimate' ? check.weight / 2 : 0), 0);
  return { score: total ? Math.round((100 * earned) / total) : 0, checks };
}

const LIFESTYLES = [
  { id: 'lean', label: 'Lean', value: 0.8 },
  { id: 'current', label: 'Current', value: 1 },
  { id: 'comfortable', label: 'Comfortable', value: 1.25 },
] as const;

function confidenceTone(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-destructive';
}

function wholeAge(years: number): string {
  if (!Number.isFinite(years)) return '—';
  return String(Math.round(years));
}

function inflateMonthly(monthly: number, inflationPct: number, yearsOut: number): number {
  if (inflationPct === 0) return monthly;
  return monthly * (1 + inflationPct / 100) ** yearsOut;
}

function whenLabel(delta: number | null): string {
  if (delta == null) return '—';
  if (Math.abs(delta) < 0.05) return 'No change';
  const amount = Math.abs(delta).toFixed(1).replace(/\.0$/, '');
  const unit = amount === '1' ? 'year' : 'years';
  return delta < 0 ? `${amount} ${unit} earlier` : `${amount} ${unit} later`;
}

export function RetirementPage() {
  const { data, saving, error, mutate } = useFinanceData();
  const { finance, patchSettings, patchPerson } = useEditableFinance(data, mutate, updateSettings, updatePerson);
  const [salaryFromYear, setSalaryFromYear] = useState('');
  const [salaryAnnual, setSalaryAnnual] = useState('');
  const [salarySave, setSalarySave] = useState('');
  const [money, setMoney] = useState<'nominal' | 'today'>('nominal');
  const [showParts, setShowParts] = useState(false);
  const [showCombined, setShowCombined] = useState(false);
  const [leftOut, setLeftOut] = useState<string[]>([]);
  const [confidenceOpen, setConfidenceOpen] = useState(false);
  const [retireAt, setRetireAt] = useState('');
  const chartInflation = money === 'nominal';
  const model = useRetirementPlan(finance, leftOut);
  const series = useHiddenSeries();

  const salaryScenario = useMemo(() => {
    if (!model) return null;
    const annual = Number(salaryAnnual);
    if (salaryAnnual.trim() === '' || !Number.isFinite(annual) || annual <= 0) return null;
    const fromYear = Number(salaryFromYear);
    const startMonth = salaryFromYear.trim() === '' || !Number.isFinite(fromYear)
      ? 0
      : Math.max(0, (fromYear - model.now.getFullYear()) * 12 - model.now.getMonth());
    const save = salarySave.trim() === '' || !Number.isFinite(Number(salarySave)) ? 0 : Math.max(0, Number(salarySave));
    const people = model.request.people.map((person) => (
      person.id === 'self'
        ? { ...person, pension: { ...person.pension, salaryStep: { startMonth, monthly: annual / 12 } } }
        : person
    ));
    const request = { ...model.request, people, extraMonthly: save };
    const solved = solveRetirement(
      request,
      { leanSpendingMonthly: model.spending.leanMonthly, comfortableSpendingMonthly: model.spending.comfortableMonthly },
    );
    return {
      solved,
      request,
      alt: solved.base,
      annual,
      save,
      fromYear: Number.isFinite(fromYear) ? fromYear : null,
    };
  }, [model, salaryAnnual, salaryFromYear, salarySave]);

  if (!finance || !model) return null;

  const { spending } = model;
  const mode = finance.settings.householdMode;
  const scope: RetirementScope = mode === 'solo' ? 'individual' : finance.settings.retirementScope;
  const me = finance.people.find((person) => person.id === 'self');
  const partner = finance.people.find((person) => person.id === 'partner');
  const selfName = personName(finance.people, 'self');
  const partnerName = personName(finance.people, 'partner');
  const solved = salaryScenario?.solved ?? model.solved;
  const retireAge = Number(retireAt);
  const chosenAge = retireAt.trim() !== '' && Number.isFinite(retireAge) && retireAge >= 1 ? retireAge : null;
  const played = chosenAge == null ? null : retirementAtAge(salaryScenario?.request ?? model.request, chosenAge);
  const base = played ?? solved.base;
  const confidence = retirementConfidence(finance);
  const scenarioAges = [solved.pessimistic, solved.base, solved.optimistic]
    .map((scenario) => scenario.agesAtRetirement.self)
    .filter((age): age is number => age != null && Number.isFinite(age));

  const saveSettings = patchSettings;
  const savePerson = patchPerson;

  const yearsOut = base.stopOffset ?? (me?.birthDate ? Math.max(0, 70 - ageYears(me.birthDate, model.now)) : 0);
  const inTodaysEuros = (amount: number, yearOffset: number) => (
    finance.settings.inflationPct === 0 ? amount : amount / (1 + finance.settings.inflationPct / 100) ** yearOffset
  );
  const spendingOverride = scope === 'individual' ? finance.settings.spendingPersonalMonthly : finance.settings.spendingHouseholdMonthly;
  const housingOverride = scope === 'individual' ? finance.settings.housingPersonalMonthly : finance.settings.housingHouseholdMonthly;
  const spendingKey = scope === 'individual' ? 'spendingPersonalMonthly' : 'spendingHouseholdMonthly';
  const housingKey = scope === 'individual' ? 'housingPersonalMonthly' : 'housingHouseholdMonthly';
  const planAccounts = finance.accounts.filter((account) => {
    if (account.closedOn) return false;
    if (scope === 'individual' && account.owner === 'partner') return false;
    const share = scope === 'individual' ? selfShare(account) : 1;
    const balance = (latestBalance(finance.balances, account.id)?.balance ?? 0) * (scope === 'individual' ? balanceSplit(account, finance.balances).share : 1);
    const contribution = account.monthlyContribution * share;
    const income = (account.incomeMonthly ?? 0) * share;
    return balance > 0 || contribution > 0 || income > 0;
  });
  const partIds = planAccounts.map((account) => account.id).filter((id) => !leftOut.includes(id) && base.path.some((point) => point.byAccount[id] != null));
  const partNames = Object.fromEntries(partIds.map((id) => [id, finance.accounts.find((account) => account.id === id)?.name ?? 'Account']));
  const parts = showParts && partIds.length > 0;
  const barKeys = parts ? partIds.map((id) => partNames[id]) : ['Portfolio'];
  const spendingKey_ = chartInflation ? 'Spending / year' : "Spending / year, today's euros";
  const incomeKey = chartInflation ? 'Pension and other income / year' : "Pension and other income / year, today's euros";
  const chartData = base.path.map((point) => ({
    age: wholeAge(point.ages.self ?? point.yearOffset),
    ...(parts
      ? Object.fromEntries(partIds.map((id) => [partNames[id], Math.round(inTodaysEuros(point.byAccount[id] ?? 0, point.yearOffset))]))
      : { Portfolio: Math.round(inTodaysEuros(point.portfolio, point.yearOffset)) }),
    ...(showCombined ? { 'Plus a year of pension': Math.round(inTodaysEuros(point.pensionAnnual, point.yearOffset)) } : {}),
    [spendingKey_]: Math.round(chartInflation ? point.spendingAnnual : inTodaysEuros(point.spendingAnnual, point.yearOffset)),
    [incomeKey]: Math.round(chartInflation ? point.pensionAnnual : inTodaysEuros(point.pensionAnnual, point.yearOffset)),
  }));
  const bars = showCombined ? [...barKeys, 'Plus a year of pension'] : barKeys;
  const barColours: AvailableChartColorsKeys[] = [
    ...(parts ? partIds.map((_, index) => PART_COLOURS[index % PART_COLOURS.length]) : ['blue' as AvailableChartColorsKeys]),
    ...(showCombined ? ['gray' as AvailableChartColorsKeys] : []),
  ];
  const barItems: LegendItem[] = bars.map((name, index) => ({ name, color: barColours[index] }));
  const lineItems: LegendItem[] = [
    { name: spendingKey_, color: 'red', line: true },
    { name: incomeKey, color: 'emerald', line: true },
  ];
  const shownBars = series.visible(barItems);
  const shownLines = series.visible(lineItems);

  return (
    <>
      <PageHeader
        title="When can I retire?"
        description={(
          <>
            A planner, not a promise. It compounds the accounts you entered, inflates spending, and applies the German state pension at a high level:
            the full pension at {finance.settings.regularPensionAge}, a 0.3% cut per month if you claim from {finance.settings.earliestPensionAge} (14.4% at most),
            and pension points only while you are still working.{mode === 'joint' ? ` Household mode adds ${partnerName} and assumes you both stop in the same year.` : ''}
          </>
        )}
        actions={(
          <>
            {mode === 'joint' && (
              <Segmented
                label="Whose plan"
                value={scope}
                options={[{ value: 'individual', label: 'Just me' }, { value: 'household', label: 'Household' }]}
                onChange={(next) => saveSettings({ retirementScope: next }, true)}
              />
            )}
            <Segmented label="Money" value={money} options={[{ value: 'today', label: "Today's euros" }, { value: 'nominal', label: 'With inflation' }]} onChange={setMoney} />
            <TodaysEurosTip inflationPct={finance.settings.inflationPct} />
            <Button variant="outline" size="sm" onClick={() => setConfidenceOpen(true)}>
              <span className={cn('font-semibold', confidenceTone(confidence.score))}>{confidence.score}%</span> filled in
            </Button>
          </>
        )}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="grid gap-6 lg:grid-cols-[1fr_auto]">
          <div className="space-y-3">
            <Headline
              base={base}
              chosen={played != null}
              scope={scope}
              horizon={finance.settings.horizonAge}
              spreadLow={scenarioAges.length ? Math.min(...scenarioAges) : null}
              spreadHigh={scenarioAges.length ? Math.max(...scenarioAges) : null}
              pessimisticOk={solved.pessimistic.ok}
              spendingMonthly={chartInflation ? inflateMonthly(spending.totalMonthly, finance.settings.inflationPct, yearsOut) : spending.totalMonthly}
              spendingLabel={chartInflation ? 'spending / month at that age' : "spending / month, today's euros"}
            />
            {played && me?.birthDate && (
              <p className="text-sm text-muted-foreground">Age {wholeAge(chosenAge ?? 0)} is {calendarWhen(me.birthDate, chosenAge ?? 0)}. Clear the retire box to go back to the earliest age.</p>
            )}
            {salaryScenario && (
              <p className="text-sm text-muted-foreground">
                The chart and the age include {EUR(salaryScenario.annual)} gross{salaryScenario.fromYear != null ? ` from ${salaryScenario.fromYear}` : ''}
                {salaryScenario.save > 0 ? ` and ${EUR(salaryScenario.save)} extra saved each month` : ''}. Clear the gross box to go back to the saved salary.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:w-96">
            <FieldRow label="Retire at age" hint={`Blank uses the earliest age that lasts to ${finance.settings.horizonAge}.`}>
              <Input
                type="number"
                min="1"
                step="1"
                placeholder={solved.base.agesAtRetirement.self == null ? '' : wholeAge(solved.base.agesAtRetirement.self)}
                value={retireAt}
                onChange={(event) => setRetireAt(event.target.value)}
              />
            </FieldRow>
            <NumberField
              label="Money must last to age"
              hint="95 is the default."
              step="1"
              value={finance.settings.horizonAge}
              onChange={(value) => value != null && saveSettings({ horizonAge: value })}
            />
          </div>
        </CardContent>
      </Card>

      {base.path.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{played ? `Portfolio if you stop at ${wholeAge(chosenAge ?? 0)}` : base.ok ? 'Portfolio if you stop at that age' : 'Portfolio if you work until 70'}</CardTitle>
            <CardDescription>
              Bars are the portfolio in today&apos;s euros (left axis), so inflation does not make the savings look larger. Lines are per year (right axis)
              {chartInflation ? ', in the euros of that year, so spending rises.' : ", in today's euros, so spending stays flat."}
              {showCombined ? ' The grey top of each bar adds one year of pension: a balance plus a year of income, not a second pot.' : ''}
            </CardDescription>
            <CardAction className="flex gap-2">
              <Button variant={showParts ? 'secondary' : 'outline'} size="sm" aria-pressed={showParts} onClick={() => setShowParts((on) => !on)}>Show the parts</Button>
              <Button variant={showCombined ? 'secondary' : 'outline'} size="sm" aria-pressed={showCombined} onClick={() => setShowCombined((on) => !on)}>Add a year of pension</Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <ChartLegend items={[...barItems, ...lineItems]} hidden={series.hidden} onToggle={series.toggle} onShowAll={series.showAll} />
            <ComboChart
              className="h-96"
              data={chartData}
              index="age"
              xAxisLabel={`${selfName}'s age`}
              enableBiaxial
              showLegend={false}
              barSeries={{ ...shownBars, type: 'stacked', valueFormatter: EUR, yAxisWidth: 80 }}
              lineSeries={{ ...shownLines, valueFormatter: (value) => `${EUR(value)} / yr`, yAxisWidth: 100 }}
            />
            {planAccounts.length > 0 && (
              <fieldset className="grid gap-3 rounded-lg border p-3">
                <legend className="px-1 text-sm font-medium">In this retirement portfolio</legend>
                <p className="text-xs text-muted-foreground">Untick an account to leave its balance and future contributions out, as if you used that money for something else. Investments keeps it. Not saved.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {planAccounts.map((account) => {
                    const share = scope === 'individual' ? balanceSplit(account, finance.balances).share : 1;
                    const balance = (latestBalance(finance.balances, account.id)?.balance ?? 0) * share;
                    const included = !leftOut.includes(account.id);
                    return (
                      <CheckField
                        key={account.id}
                        checked={included}
                        onChange={() => setLeftOut((current) => (included ? [...current, account.id] : current.filter((id) => id !== account.id)))}
                        label={`${account.name}${account.owner === 'joint' && scope === 'individual' ? ', your share' : ''}`}
                        hint={EURExact(balance)}
                      />
                    );
                  })}
                </div>
              </fieldset>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spending</CardTitle>
            <CardAction>
              <Segmented
                label="Lifestyle"
                value={LIFESTYLES.find((item) => item.value === finance.settings.lifestyle)?.id ?? 'current'}
                options={LIFESTYLES.map((item) => ({ value: item.id, label: item.label }))}
                onChange={(id) => saveSettings({ lifestyle: LIFESTYLES.find((item) => item.id === id)?.value ?? 1 }, true)}
              />
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            <SpendingSource
              scope={scope}
              mode={mode}
              pot={spending.pot}
              share={spending.share}
              otherBase={spending.otherBase}
              housingBase={spending.housingBase}
              selfName={selfName}
              partnerName={partnerName}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="Other monthly spending"
                hint={`Blank uses ${EURExact(spending.otherBase)} from the setup. Lifestyle scales it.`}
                value={spendingOverride}
                resetKey={scope}
                onChange={(value) => saveSettings({ [spendingKey]: value })}
              />
              <NumberField
                label="Housing in retirement"
                hint={`Blank uses ${EURExact(spending.housingBase)}. Lifestyle scales it too.`}
                value={housingOverride}
                resetKey={`${scope}-housing`}
                onChange={(value) => saveSettings({ [housingKey]: value })}
              />
            </div>
            <SpendingOutlook
              lifestyle={finance.settings.lifestyle}
              housing={spending.housingMonthly}
              other={spending.otherMonthly}
              inflationPct={finance.settings.inflationPct}
              yearsOut={yearsOut}
              when={me?.birthDate ? (base.ok ? `At age ${wholeAge(ageYears(me.birthDate, model.now) + (base.stopOffset ?? 0))}` : 'By age 70') : 'Add a date of birth'}
            />
            <p className="text-xs text-muted-foreground">
              {saving ? 'Saving…' : <>Pay, allowances, rent and shared costs live in <Link to="/setup" className="underline">Setup</Link> and on <Link to="/income" className="underline">Income</Link>.</>}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>What moves the age</CardTitle></CardHeader>
          <CardContent className="space-y-6">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Change</TableHead><TableHead>Age</TableHead><TableHead>Compared with this plan</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {solved.sensitivity.map((row) => {
                  const birth = me?.birthDate;
                  const age = row.stopOffset == null || !birth ? null : ageYears(birth, model.now) + row.stopOffset;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>{row.label}</TableCell>
                      <TableCell>{!birth ? '—' : age == null ? 'Not by 70' : wholeAge(age)}</TableCell>
                      <TableCell className={cn(row.deltaYears != null && row.deltaYears < -0.05 && 'text-emerald-600', row.deltaYears != null && row.deltaYears > 0.05 && 'text-destructive')}>
                        {whenLabel(row.deltaYears)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">Return scenarios use ±{finance.settings.scenarioSpreadPct} points on every account. Lean and Comfortable scale both spending and housing.</p>
            <SalaryWhatIf
              currentAnnual={(me?.grossSalaryMonthly ?? 0) * 12}
              capAnnual={finance.settings.contributionCapMonthly * 12}
              fromYear={salaryFromYear}
              annual={salaryAnnual}
              save={salarySave}
              onFromYear={setSalaryFromYear}
              onAnnual={setSalaryAnnual}
              onSaveAmount={setSalarySave}
              base={model.solved.base}
              scenario={salaryScenario}
              birthDate={me?.birthDate ?? null}
              now={model.now}
              currentMonthlyGross={me?.grossSalaryMonthly ?? 0}
              currentMonthlyNet={me?.netSalaryMonthly ?? 0}
            />
          </CardContent>
        </Card>
      </div>

      <Collapsible>
        <Card>
          <CardHeader>
            <CardTitle>Pension and assumptions</CardTitle>
            <CardDescription>
              The Renteninformation and the statutory rates. Salary and payslip figures are on <Link to="/income" className="underline">Income</Link>; dates of birth are in <Link to="/setup" className="underline">Setup</Link>.
            </CardDescription>
            <CardAction><CollapsibleTrigger render={<Button variant="outline" size="sm" />}>Show</CollapsibleTrigger></CardAction>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="grid gap-6 lg:grid-cols-2">
              {me && <PensionCard person={me} onSave={(patch) => savePerson(me.id, patch)} />}
              {scope === 'household' && partner && <PensionCard person={partner} onSave={(patch) => savePerson(partner.id, patch)} />}
              <div className="grid content-start gap-4">
                <h3 className="font-medium">Assumptions you can edit</h3>
                <p className="text-xs text-muted-foreground">
                  Rentenwert {EURExact(finance.settings.rentenwert)} and Durchschnittsentgelt {EUR(finance.settings.durchschnittsentgeltAnnual)} are the July 2026 statutory figures.
                  Update them when the Deutsche Rentenversicherung publishes the next ones. The projected pension on your Renteninformation is the better input when you have it.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <NumberField label="Inflation % / year" step="0.1" value={finance.settings.inflationPct} onChange={(value) => value != null && saveSettings({ inflationPct: value })} />
                  <NumberField label="Pension growth % / year" step="0.1" value={finance.settings.pensionGrowthPct} onChange={(value) => value != null && saveSettings({ pensionGrowthPct: value })} />
                  <NumberField label="Return band ± points" step="0.5" value={finance.settings.scenarioSpreadPct} onChange={(value) => value != null && saveSettings({ scenarioSpreadPct: value })} />
                  <NumberField label="Pension kept after tax and health" hint="0.85 means you keep 85%." step="0.01" value={finance.settings.pensionNetFactor} onChange={(value) => value != null && saveSettings({ pensionNetFactor: value })} />
                  <NumberField label="Rentenwert € / point" step="0.01" value={finance.settings.rentenwert} onChange={(value) => value != null && saveSettings({ rentenwert: value })} />
                  <NumberField label="Durchschnittsentgelt € / year" step="1" value={finance.settings.durchschnittsentgeltAnnual} onChange={(value) => value != null && saveSettings({ durchschnittsentgeltAnnual: value })} />
                  <NumberField label="Contribution cap € / month" hint="2026: €8,450. Does not rise with pay." value={finance.settings.contributionCapMonthly} onChange={(value) => value != null && saveSettings({ contributionCapMonthly: value })} />
                  <NumberField label="Share kept after income tax" hint="Only with a payslip Zusatzbeitrag. 0.90 is a guess." step="0.01" value={finance.settings.pensionTaxKeep} onChange={(value) => value != null && saveSettings({ pensionTaxKeep: value })} />
                </div>
                <p className="text-xs text-muted-foreground">
                  A workplace pension entered as monthly income is not also drawn down. This does not model the small cut a bAV can make to the state pension, or tax on private payouts. Enter those as what you expect to receive.
                </p>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={confidenceOpen} onOpenChange={setConfidenceOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{confidence.score}% of the plan is filled in</DialogTitle>
            <DialogDescription>Recorded facts count in full. Estimates count half. Missing facts count as zero. This is how complete the inputs are, not a forecast of returns.</DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Status</TableHead><TableHead>Input</TableHead><TableHead>Why it is scored that way</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {confidence.checks.map((check) => (
                <TableRow key={check.label}>
                  <TableCell>
                    <Badge variant={check.status === 'recorded' ? 'default' : check.status === 'estimate' ? 'secondary' : 'destructive'}>
                      {check.status === 'recorded' ? 'Recorded' : check.status === 'estimate' ? 'Estimate' : 'Missing'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{check.label}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{check.detail}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SpendingSource({
  scope,
  mode,
  pot,
  share,
  otherBase,
  housingBase,
  selfName,
  partnerName,
}: {
  scope: RetirementScope;
  mode: HouseholdMode;
  pot: Pot;
  share: number;
  otherBase: number;
  housingBase: number;
  selfName: string;
  partnerName: string;
}) {
  if (mode === 'solo') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">From the setup: rent and your other spending. Investment contributions stop when you stop working, so they are not part of it.</p>
        <SumList rows={[{ label: 'Housing', value: EURExact(housingBase) }, { label: 'Other living costs', value: EURExact(otherBase) }]} />
      </div>
    );
  }
  const pct = Math.round(share * 100);
  if (scope === 'individual') {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Just me is what you live on from your allowance, plus your {pct}% of the shared costs and rent. Investment contributions stop at retirement, so they are left out. Leave the boxes blank to use this sum.
        </p>
        <SumList
          rows={[
            { label: `Your allowance, after ${EURExact(pot.selfInvestMonthly)} of personal investments`, value: EURExact(pot.selfLivingMonthly) },
            { label: `${pct}% of shared costs`, value: EURExact(pot.sharedSpendMonthly * share) },
            { label: 'Living costs', value: EURExact(otherBase), tone: 'strong' },
            { label: `Housing, ${pct}% of the rent`, value: EURExact(housingBase), tone: 'strong' },
          ]}
        />
        <p className="text-xs text-muted-foreground">The share is weighted by take-home pay unless set on Income. The rest is {partnerName}&apos;s.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Household is what you both live on: the shared costs and rent from the pot, plus what each of you spends from your allowance. Investment contributions stop at retirement and are left out.
      </p>
      <SumList
        rows={[
          { label: 'Shared costs', value: EURExact(pot.sharedSpendMonthly) },
          { label: `${selfName}'s allowance, after personal investments`, value: EURExact(pot.selfLivingMonthly) },
          { label: `${partnerName}'s allowance, after personal investments`, value: EURExact(pot.partnerLivingMonthly) },
          { label: 'Living costs', value: EURExact(otherBase), tone: 'strong' },
          { label: 'Housing', value: EURExact(housingBase), tone: 'strong' },
        ]}
      />
    </div>
  );
}

function SpendingOutlook({
  lifestyle,
  housing,
  other,
  inflationPct,
  yearsOut,
  when,
}: {
  lifestyle: number;
  housing: number;
  other: number;
  inflationPct: number;
  yearsOut: number;
  when: string;
}) {
  const name = LIFESTYLES.find((item) => item.value === lifestyle)?.label ?? 'Custom';
  const rise = (monthly: number) => (inflationPct === 0 ? monthly : monthly * (1 + inflationPct / 100) ** yearsOut);
  const together = housing + other;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {name}. {when}, the bill is {EURExact(rise(together))} a month. In today&apos;s prices that is {EURExact(together)}.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead className="text-right">Today&apos;s euros</TableHead>
            <TableHead className="text-right">{when}, {inflationPct}% inflation</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow><TableCell>Housing / month</TableCell><TableCell className="text-right tabular-nums">{EURExact(housing)}</TableCell><TableCell className="text-right tabular-nums">{EURExact(rise(housing))}</TableCell></TableRow>
          <TableRow><TableCell>Other living / month</TableCell><TableCell className="text-right tabular-nums">{EURExact(other)}</TableCell><TableCell className="text-right tabular-nums">{EURExact(rise(other))}</TableCell></TableRow>
          <TableRow className="font-medium"><TableCell>Together / month</TableCell><TableCell className="text-right tabular-nums">{EURExact(together)}</TableCell><TableCell className="text-right tabular-nums">{EURExact(rise(together))}</TableCell></TableRow>
          <TableRow><TableCell>Together / year</TableCell><TableCell className="text-right tabular-nums">{EUR(together * 12)}</TableCell><TableCell className="text-right tabular-nums">{EUR(rise(together) * 12)}</TableCell></TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function SalaryWhatIf({
  currentAnnual,
  capAnnual,
  fromYear,
  annual,
  save,
  onFromYear,
  onAnnual,
  onSaveAmount,
  base,
  scenario,
  birthDate,
  now,
  currentMonthlyGross,
  currentMonthlyNet,
}: {
  currentAnnual: number;
  capAnnual: number;
  fromYear: string;
  annual: string;
  save: string;
  onFromYear: (value: string) => void;
  onAnnual: (value: string) => void;
  onSaveAmount: (value: string) => void;
  base: ScenarioResult;
  scenario: { alt: ScenarioResult; annual: number; save: number; fromYear: number | null } | null;
  birthDate: string | null;
  now: Date;
  currentMonthlyGross: number;
  currentMonthlyNet: number;
}) {
  const bothAboveCap = currentAnnual >= capAnnual - 1 && scenario != null && scenario.annual >= capAnnual - 1;
  const underCap = scenario != null && scenario.annual < capAnnual - 1;
  const capNote = bothAboveCap ? ` The state pension does not rise, because both amounts are above the ${EUR(capAnnual)} cap.` : '';
  const baseAge = birthDate && base.stopOffset != null ? ageYears(birthDate, now) + base.stopOffset : null;
  const altAge = birthDate && scenario && scenario.alt.stopOffset != null ? ageYears(birthDate, now) + scenario.alt.stopOffset : null;
  const delta = scenario && base.stopOffset != null && scenario.alt.stopOffset != null ? scenario.alt.stopOffset - base.stopOffset : null;
  const keepShare = currentMonthlyGross > 0 && currentMonthlyNet > 0 ? currentMonthlyNet / currentMonthlyGross : null;
  const triedNet = scenario && keepShare != null ? (scenario.annual / 12) * keepShare : null;
  const extraTakeHome = triedNet == null ? null : triedNet - currentMonthlyNet;
  return (
    <div className="space-y-3">
      <h3 className="font-medium">Salary from a year</h3>
      <p className="text-xs text-muted-foreground">
        Saved gross is {EUR(currentAnnual)} a year. Try another gross from a chosen year without replacing it. Pension points stop at {EUR(capAnnual)} a year.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <FieldRow label="From year"><Input type="number" step="1" min="2000" placeholder="2030" value={fromYear} onChange={(event) => onFromYear(event.target.value)} /></FieldRow>
        <FieldRow label="Gross € / year"><Input type="number" step="1000" min="0" placeholder="150000" value={annual} onChange={(event) => onAnnual(event.target.value)} /></FieldRow>
        <FieldRow label="Save extra € / month"><Input type="number" step="50" min="0" placeholder="0" value={save} onChange={(event) => onSaveAmount(event.target.value)} /></FieldRow>
      </div>
      {scenario && (
        <p className="text-sm">
          {bothAboveCap && scenario.save === 0
            ? `${EUR(scenario.annual)} and ${EUR(currentAnnual)} are both above the pension cap, so the state pension and the portfolio stay the same until some of the extra pay is saved each month.`
            : altAge == null
              ? `That still does not fund spending by age 70.${capNote}`
              : baseAge == null
                ? `Retirement age becomes ${wholeAge(altAge)}. Without this, working until 70 does not fund spending to the horizon.${capNote}`
                : `Retirement age becomes ${wholeAge(altAge)}, ${whenLabel(delta ?? 0).toLowerCase()}. The chart uses this try.${capNote}`}
        </p>
      )}
      {underCap && (
        <p className="text-xs text-muted-foreground">
          {EUR(scenario?.annual ?? 0)} is under the {EUR(capAnnual)} pension cap, so future pension points change. Check the zeros: 15000 is fifteen thousand a year.
        </p>
      )}
      {triedNet != null && extraTakeHome != null && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            At today&apos;s take-home share of {Math.round((keepShare ?? 0) * 100)}%, that gross is about {EURExact(triedNet)} a month, {extraTakeHome >= 0 ? `${EURExact(extraTakeHome)} more` : `${EURExact(Math.abs(extraTakeHome))} less`} than now. A guide, not a tax calculation.
          </p>
          {extraTakeHome > 1 && (
            <Button variant="outline" size="sm" onClick={() => onSaveAmount(String(Math.round(extraTakeHome)))}>Use {EUR(extraTakeHome)} as extra savings</Button>
          )}
        </div>
      )}
    </div>
  );
}

function calendarWhen(birthDate: string, age: number): string {
  const [year, month, day] = birthDate.split('-').map(Number);
  const when = new Date((year ?? 0) + Math.round(age), (month ?? 1) - 1, day ?? 1);
  return when.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function Headline({
  base,
  chosen,
  scope,
  horizon,
  spreadLow,
  spreadHigh,
  pessimisticOk,
  spendingMonthly,
  spendingLabel,
}: {
  base: ScenarioResult;
  chosen: boolean;
  scope: RetirementScope;
  horizon: number;
  spreadLow: number | null;
  spreadHigh: number | null;
  pessimisticOk: boolean;
  spendingMonthly: number;
  spendingLabel: string;
}) {
  if (base.reason === 'missing-birth') {
    const who = base.missingPersonId === 'partner' ? "your partner's" : 'your';
    return <p className="text-2xl font-semibold">Add {who} date of birth in <Link to="/setup" className="underline">Setup</Link> to calculate an age.</p>;
  }
  const runsOut = base.runsOutAge == null ? null : wholeAge(base.runsOutAge);
  const stopAge = base.agesAtRetirement.self == null ? null : wholeAge(base.agesAtRetirement.self);
  const title = chosen
    ? (!base.ok ? `Stopping at ${stopAge}, the money runs out around age ${runsOut ?? horizon}.` : `Stopping at ${stopAge}, the money lasts to ${horizon}.`)
    : (!base.ok ? `Working until 70, the money runs out around age ${runsOut ?? horizon}.` : `${scope === 'household' ? 'You can both stop at ' : 'You can stop working at '}${stopAge}.`);
  const spread = spreadLow != null && spreadHigh != null && spreadHigh - spreadLow >= 0.05 ? `Returns put that between ${wholeAge(spreadLow)} and ${wholeAge(spreadHigh)}.` : '';
  const band = !pessimisticOk ? ` The lower return runs out before ${horizon}.` : '';
  const facts = [
    { value: EUR(spendingMonthly), label: spendingLabel },
    { value: EUR(base.statePensionNetMonthly), label: "state pension / month, today's euros" },
    { value: base.ok ? stopAge : `Until ${runsOut ?? '—'}`, label: base.ok ? 'age you can stop' : `has to last to ${horizon}` },
  ];
  return (
    <div className="space-y-3">
      <p className={cn('text-2xl font-semibold tracking-tight', !base.ok && 'text-destructive')}>{title}</p>
      <div className="flex flex-wrap gap-8">
        {facts.map((fact) => (
          <div key={fact.label}>
            <div className="text-lg font-semibold tabular-nums">{fact.value}</div>
            <div className="text-xs text-muted-foreground">{fact.label}</div>
          </div>
        ))}
      </div>
      {!chosen && (spread || band) && <p className="text-sm text-muted-foreground">{spread}{band}</p>}
    </div>
  );
}

function PensionCard({ person, onSave }: { person: Person; onSave: (patch: Partial<Person>) => void }) {
  return (
    <div className="grid content-start gap-4">
      <h3 className="font-medium">{person.name}</h3>
      <FieldRow label="Pension input">
        <SimpleSelect
          value={person.pensionMode}
          options={[{ value: 'stated', label: 'Amount from the Renteninformation' }, { value: 'estimate', label: 'Estimate from points and salary' }]}
          onChange={(pensionMode) => onSave({ pensionMode })}
        />
      </FieldRow>
      {person.pensionMode === 'stated' && (
        <NumberField
          label="Projected monthly pension at 67, gross"
          hint="With a gross salary on Income, years you will not work are removed. Without one, early retirement only applies the percentage cut, which is optimistic."
          value={person.pensionStatedMonthly}
          onChange={(value) => onSave({ pensionStatedMonthly: value })}
        />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Entgeltpunkte so far"
          hint={person.pensionMode === 'stated' ? 'Optional. Used instead of backing them out of the letter.' : 'Blank estimates them from years and salary.'}
          value={person.pensionPoints}
          step="0.01"
          onChange={(value) => onSave({ pensionPoints: value })}
        />
        <NumberField label="Years already contributed" step="0.5" value={person.contributionYears} onChange={(value) => onSave({ contributionYears: value })} />
      </div>
    </div>
  );
}
