import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { FieldRow, NumberField, PageHeader, Segmented } from '../components/kit';
import { PotSummary } from '../components/PotSummary';
import { useEditableFinance } from '../hooks/useEditableFinance';
import { useFinanceData } from '../hooks/useFinanceData';
import { updatePerson, updateSettings } from '../lib/api';
import { pot } from '../lib/household';
import { personName, type HouseholdMode, type Person } from '../lib/types';

const STEPS = ['Who', 'Birthdays', 'Pay', 'Spending'] as const;
type Step = '0' | '1' | '2' | '3';
const DEFAULT_ALLOWANCE = 1200;

export function SetupPage() {
  const { data, mutate } = useFinanceData();
  const { finance, patchSettings, patchPerson } = useEditableFinance(data, mutate, updateSettings, updatePerson);
  const [step, setStep] = useState<Step>('0');
  const navigate = useNavigate();
  if (!finance) return null;

  const at = Number(step);
  const mode = finance.settings.householdMode;
  const joint = mode === 'joint';
  const self = finance.people.find((person) => person.id === 'self') as Person;
  const partner = finance.people.find((person) => person.id === 'partner') as Person;
  const selfName = personName(finance.people, 'self');
  const partnerName = personName(finance.people, 'partner');
  const summary = pot({
    mode,
    selfNetMonthly: self.netSalaryMonthly ?? 0,
    partnerNetMonthly: partner.netSalaryMonthly ?? 0,
    selfAllowanceMonthly: self.personalAllowanceMonthly ?? (joint ? DEFAULT_ALLOWANCE : 0),
    partnerAllowanceMonthly: partner.personalAllowanceMonthly ?? (joint ? DEFAULT_ALLOWANCE : 0),
    rentMonthly: finance.settings.rentMonthly,
    sharedSpendMonthly: finance.settings.sharedSpendMonthly,
    accounts: finance.accounts,
    incomes: finance.incomes,
  });

  const fillAllowances = () => {
    for (const person of [self, partner]) {
      if (person.personalAllowanceMonthly == null) patchPerson(person.id, { personalAllowanceMonthly: DEFAULT_ALLOWANCE }, true);
    }
  };

  const chooseMode = (next: HouseholdMode) => {
    patchSettings({ householdMode: next, ...(next === 'solo' ? { retirementScope: 'individual' } : {}) }, true);
    if (next === 'joint') fillAllowances();
  };

  const finish = () => {
    if (joint) fillAllowances();
    patchSettings({ onboarded: true }, true);
    navigate('/investments');
  };

  return (
    <>
      <PageHeader
        title={finance.settings.onboarded ? 'Setup' : 'Welcome to Scrooge'}
        description="A few facts about how money moves in your household. Retirement uses them to work out what you will spend once you stop working. Everything saves as you type, and you can come back here at any time."
      />

      <Segmented
        label="Setup step"
        value={step}
        options={STEPS.map((label, index) => ({ value: String(index) as Step, label: `${index + 1}. ${label}` }))}
        onChange={setStep}
      />

      <Card className="max-w-3xl">
        {at === 0 && (
          <>
            <CardHeader>
              <CardTitle>Are you tracking just yourself, or jointly with a partner?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <ModeChoice on={!joint} title="Just me" text="My accounts, my pay, my spending." onClick={() => chooseMode('solo')} />
                <ModeChoice
                  on={joint}
                  title="Jointly"
                  text="Our pay goes into one pot. Each of us takes a personal allowance; the pot pays rent, shared costs and joint investments."
                  onClick={() => chooseMode('joint')}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <NameField label="Your name" person={self} onSave={(name) => patchPerson('self', { name })} />
                {joint && <NameField label="Partner's name" person={partner} onSave={(name) => patchPerson('partner', { name })} />}
              </div>
            </CardContent>
          </>
        )}

        {at === 1 && (
          <>
            <CardHeader>
              <CardTitle>Dates of birth</CardTitle>
              <CardDescription>Retirement turns the plan into an age. Without a date of birth it cannot.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <DateField label={selfName} value={self.birthDate} onSave={(birthDate) => patchPerson('self', { birthDate })} />
              {joint && <DateField label={partnerName} value={partner.birthDate} onSave={(birthDate) => patchPerson('partner', { birthDate })} />}
            </CardContent>
          </>
        )}

        {at === 2 && (
          <>
            <CardHeader>
              <CardTitle>{joint ? 'Take-home pay and allowances' : 'Take-home pay'}</CardTitle>
              <CardDescription>
                {joint
                  ? 'Net pay per month, as it lands in the bank. The allowance is what each of you takes out of the pot for personal spending. Your personal investments are paid out of your allowance.'
                  : 'Net pay per month, as it lands in the bank.'}
                {' '}Kindergeld and other income go on the Income page.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <NumberField label={`${selfName}: take-home € / month`} step="1" min={0} value={self.netSalaryMonthly} onChange={(value) => patchPerson('self', { netSalaryMonthly: value })} />
              {joint && <NumberField label={`${selfName}: allowance € / month`} step="1" min={0} value={self.personalAllowanceMonthly ?? DEFAULT_ALLOWANCE} onChange={(value) => patchPerson('self', { personalAllowanceMonthly: value })} />}
              {joint && <NumberField label={`${partnerName}: take-home € / month`} step="1" min={0} value={partner.netSalaryMonthly} onChange={(value) => patchPerson('partner', { netSalaryMonthly: value })} />}
              {joint && <NumberField label={`${partnerName}: allowance € / month`} step="1" min={0} value={partner.personalAllowanceMonthly ?? DEFAULT_ALLOWANCE} onChange={(value) => patchPerson('partner', { personalAllowanceMonthly: value })} />}
            </CardContent>
          </>
        )}

        {at === 3 && (
          <>
            <CardHeader>
              <CardTitle>{joint ? 'What the pot pays for' : 'What you spend'}</CardTitle>
              <CardDescription>Monthly figures. Leave investments out: they are read from your accounts on the Investments page.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField label="Rent or housing € / month" step="1" min={0} value={finance.settings.rentMonthly} onChange={(value) => patchSettings({ rentMonthly: value ?? 0 })} />
                <NumberField
                  label={joint ? 'Other shared costs € / month' : 'Other spending € / month'}
                  hint={joint ? 'Food, holidays, utilities, childcare, insurance.' : 'Everything except rent and investments.'}
                  step="1"
                  min={0}
                  value={finance.settings.sharedSpendMonthly}
                  onChange={(value) => patchSettings({ sharedSpendMonthly: value ?? 0 })}
                />
              </div>
              <PotSummary pot={summary} mode={mode} selfName={selfName} partnerName={partnerName} />
            </CardContent>
          </>
        )}

        <CardFooter className="justify-end gap-2">
          {at > 0 && <Button variant="outline" onClick={() => setStep(String(at - 1) as Step)}>Back</Button>}
          {at < STEPS.length - 1
            ? <Button onClick={() => setStep(String(at + 1) as Step)}>Next</Button>
            : <Button onClick={finish}>{finance.settings.onboarded ? 'Done' : 'Start with Investments'}</Button>}
        </CardFooter>
      </Card>
    </>
  );
}

function ModeChoice({ on, title, text, onClick }: { on: boolean; title: string; text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'grid gap-1 rounded-lg border p-4 text-left text-sm transition-colors hover:bg-muted/50',
        on && 'border-primary ring-1 ring-primary',
      )}
    >
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground">{text}</span>
    </button>
  );
}

function NameField({ label, person, onSave }: { label: string; person: Person; onSave: (name: string) => void }) {
  const [name, setName] = useState(person.name);
  return (
    <FieldRow label={label}>
      <Input
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (event.target.value.trim()) onSave(event.target.value.trim());
        }}
      />
    </FieldRow>
  );
}

function DateField({ label, value, onSave }: { label: string; value: string | null; onSave: (value: string | null) => void }) {
  const [text, setText] = useState(value ?? '');
  return (
    <FieldRow label={label}>
      <Input
        type="date"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          onSave(event.target.value || null);
        }}
      />
    </FieldRow>
  );
}
