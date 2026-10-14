import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import {
  ACCOUNT_TYPES,
  DEFAULT_SETTINGS,
  LOCKED_TYPES,
  accountTypeInfo,
  type Account,
  type AccountTreatment,
  type AccountType,
  type AccountWrite,
  type Balance,
  type BalanceWrite,
  type ContributionPeriod,
  type FinanceData,
  type FinanceSettings,
  type HouseholdMode,
  type IncomeWrite,
  type OtherIncome,
  type OwnerId,
  type PensionMode,
  type Person,
  type RetirementScope,
  type Risk,
  todayIso,
} from '../lib/types';

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function serializeCsv(headers: string[], rows: Record<string, string | number>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map((header) => escapeCsv(String(row[header] ?? ''))).join(','));
  return `${lines.join('\n')}\n`;
}

export class FinanceError extends Error {
  readonly status = 400;
}

interface PersonRow {
  id: string;
  name: string;
  birth_date: string | null;
  pension_mode: string;
  pension_stated_monthly: number | null;
  pension_points: number | null;
  gross_salary_monthly: number | null;
  net_salary_monthly: number | null;
  contribution_years: number | null;
  salary_increase_kind: string;
  salary_increase_value: number;
  salary_increase_every: string;
  payslip_rv_monthly: number | null;
  payslip_kv_monthly: number | null;
  payslip_zusatz_monthly: number | null;
  payslip_zusatz_rate_pct: number | null;
  personal_allowance_monthly: number | null;
}

interface AccountRow {
  id: string;
  owner: string;
  name: string;
  type: string;
  opened_on: string | null;
  monthly_contribution: number;
  contribution_growth_pct: number;
  contribution_increase_kind: string;
  contribution_increase_value: number;
  contribution_increase_every: string;
  expected_return_pct: number;
  interest_rate_pct: number | null;
  risk: string;
  notes: string;
  closed_on: string | null;
  treatment: string;
  income_monthly: number | null;
  income_start_age: number | null;
  owner_share: number | null;
  portion_date: string | null;
  portion_self: number | null;
  accessible: number;
}

interface IncomeRow {
  id: string;
  owner: string;
  name: string;
  amount_monthly: number;
  starts_on: string | null;
  ends_on: string | null;
  into_pot: number;
  indexed: number;
  notes: string;
}

interface BalanceRow {
  id: number;
  account_id: string;
  date: string;
  balance: number;
  contributed: number | null;
  note: string | null;
}

const SETTING_KEYS = {
  inflationPct: 'inflation_pct',
  horizonAge: 'horizon_age',
  scenarioSpreadPct: 'scenario_spread_pct',
  pensionNetFactor: 'pension_net_factor',
  pensionGrowthPct: 'pension_growth_pct',
  durchschnittsentgeltAnnual: 'durchschnittsentgelt_annual',
  rentenwert: 'rentenwert',
  contributionCapMonthly: 'contribution_cap_monthly',
  pensionTaxKeep: 'pension_tax_keep',
  regularPensionAge: 'regular_pension_age',
  earliestPensionAge: 'earliest_pension_age',
  withdrawal: 'withdrawal',
  lifestyle: 'lifestyle',
  retirementScope: 'retirement_scope',
  onboarded: 'onboarded',
  householdMode: 'household_mode',
  rentMonthly: 'rent_monthly',
  sharedSpendMonthly: 'shared_spend_monthly',
  sharedCostShare: 'shared_cost_share',
  spendingPersonalMonthly: 'spending_personal_monthly',
  spendingHouseholdMonthly: 'spending_household_monthly',
  housingPersonalMonthly: 'housing_personal_monthly',
  housingHouseholdMonthly: 'housing_household_monthly',
} as const;

const SCHEMA = `
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT,
  pension_mode TEXT NOT NULL DEFAULT 'stated',
  pension_stated_monthly REAL,
  pension_points REAL,
  gross_salary_monthly REAL,
  contribution_years REAL
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  opened_on TEXT,
  monthly_contribution REAL NOT NULL DEFAULT 0,
  contribution_growth_pct REAL NOT NULL DEFAULT 0,
  expected_return_pct REAL NOT NULL DEFAULT 0,
  interest_rate_pct REAL,
  risk TEXT NOT NULL DEFAULT 'medium',
  notes TEXT NOT NULL DEFAULT '',
  closed_on TEXT,
  treatment TEXT NOT NULL DEFAULT 'portfolio',
  income_monthly REAL,
  income_start_age REAL
);
CREATE TABLE balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance REAL NOT NULL,
  UNIQUE (account_id, date)
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX balances_account ON balances(account_id);
`;

function fail(message: string): never {
  throw new FinanceError(message);
}

function asOwner(value: unknown): OwnerId {
  if (value === 'self' || value === 'partner' || value === 'joint') return value;
  return fail('Owner must be self, partner, or joint');
}

function asType(value: unknown): AccountType {
  if (typeof value === 'string' && ACCOUNT_TYPES.some((item) => item.id === value)) return value as AccountType;
  return fail('Unknown account type');
}

function asRisk(value: unknown, fallback: Risk): Risk {
  if (value == null || value === '') return fallback;
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return fail('Risk must be low, medium, or high');
}

function asTreatment(value: unknown): AccountTreatment {
  if (value == null || value === '' || value === 'portfolio') return 'portfolio';
  if (value === 'income') return 'income';
  return fail('Treatment must be portfolio or income');
}

function asKind(value: unknown): 'percent' | 'amount' {
  return value === 'amount' ? 'amount' : 'percent';
}

function asEvery(value: unknown): 'year' | 'month' {
  return value === 'month' ? 'month' : 'year';
}

function asMode(value: unknown): PensionMode {
  if (value === 'estimate') return 'estimate';
  if (value == null || value === '' || value === 'stated') return 'stated';
  return fail('Pension mode must be stated or estimate');
}

function finite(value: unknown, label: string, fallback?: number): number {
  if (value == null || value === '') {
    if (fallback != null) return fallback;
    return fail(`${label} is required`);
  }
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fail(`${label} must be a number`);
  return number;
}

function optionalNumber(value: unknown, label: string): number | null {
  if (value == null || value === '') return null;
  return finite(value, label);
}

function inRange(number: number, label: string, min: number, max: number): number {
  if (number < min || number > max) return fail(`${label} must be between ${min} and ${max}`);
  return number;
}

function asDate(value: unknown): string | null {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return fail('Dates must be YYYY-MM-DD');
  return text;
}

function mapPerson(row: PersonRow): Person {
  return {
    id: row.id === 'partner' ? 'partner' : 'self',
    name: row.name,
    birthDate: row.birth_date,
    pensionMode: row.pension_mode === 'estimate' ? 'estimate' : 'stated',
    pensionStatedMonthly: row.pension_stated_monthly,
    pensionPoints: row.pension_points,
    grossSalaryMonthly: row.gross_salary_monthly,
    netSalaryMonthly: row.net_salary_monthly,
    contributionYears: row.contribution_years,
    salaryIncreaseKind: row.salary_increase_kind === 'amount' ? 'amount' : 'percent',
    salaryIncreaseValue: row.salary_increase_value ?? 0,
    salaryIncreaseEvery: row.salary_increase_every === 'month' ? 'month' : 'year',
    payslipRvMonthly: row.payslip_rv_monthly,
    payslipKvMonthly: row.payslip_kv_monthly,
    payslipZusatzMonthly: row.payslip_zusatz_monthly,
    payslipZusatzRatePct: row.payslip_zusatz_rate_pct,
    personalAllowanceMonthly: row.personal_allowance_monthly,
  };
}

function mapAccount(row: AccountRow): Account {
  return {
    id: row.id,
    owner: asOwner(row.owner),
    name: row.name,
    type: asType(row.type),
    openedOn: row.opened_on,
    monthlyContribution: row.monthly_contribution,
    contributionGrowthPct: row.contribution_growth_pct,
    contributionIncreaseKind: row.contribution_increase_kind === 'amount' ? 'amount' : 'percent',
    contributionIncreaseValue: row.contribution_increase_value ?? row.contribution_growth_pct ?? 0,
    contributionIncreaseEvery: row.contribution_increase_every === 'month' ? 'month' : 'year',
    expectedReturnPct: row.expected_return_pct,
    interestRatePct: row.interest_rate_pct,
    risk: asRisk(row.risk, 'medium'),
    notes: row.notes ?? '',
    closedOn: row.closed_on,
    treatment: row.treatment === 'income' ? 'income' : 'portfolio',
    incomeMonthly: row.income_monthly,
    incomeStartAge: row.income_start_age,
    ownerShare: storedShare(asOwner(row.owner), row.owner_share),
    portionDate: row.owner === 'joint' ? row.portion_date : null,
    portionSelf: row.owner === 'joint' ? row.portion_self : null,
    accessible: row.accessible !== 0,
    contributionHistory: [],
  };
}

function storedShare(owner: OwnerId, value: number | null | undefined): number {
  if (owner === 'self') return 1;
  if (owner === 'partner') return 0;
  if (value == null || !Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function mapIncome(row: IncomeRow): OtherIncome {
  return {
    id: row.id,
    owner: asOwner(row.owner),
    name: row.name,
    amountMonthly: row.amount_monthly,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    intoPot: row.into_pot === 1,
    indexed: row.indexed === 1,
    notes: row.notes ?? '',
  };
}

function normalizeIncome(input: Partial<IncomeWrite>, existing?: OtherIncome): IncomeWrite {
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name) fail('Name is required');
  if (name.length > 80) fail('Name is too long');
  const startsOn = input.startsOn === undefined ? existing?.startsOn ?? null : asDate(input.startsOn);
  const endsOn = input.endsOn === undefined ? existing?.endsOn ?? null : asDate(input.endsOn);
  if (startsOn && endsOn && startsOn >= endsOn) fail('The end date must be after the start date');
  return {
    owner: input.owner == null && existing ? existing.owner : asOwner(input.owner),
    name,
    amountMonthly: inRange(finite(input.amountMonthly, 'Amount', existing?.amountMonthly ?? 0), 'Amount', 0, 1_000_000),
    startsOn,
    endsOn,
    intoPot: input.intoPot == null ? existing?.intoPot ?? true : Boolean(input.intoPot),
    indexed: input.indexed == null ? existing?.indexed ?? true : Boolean(input.indexed),
    notes: String(input.notes ?? existing?.notes ?? '').slice(0, 2000),
  };
}

function writeIncome(db: Database.Database, id: string, income: IncomeWrite, insert: boolean) {
  const values = [
    income.owner, income.name, income.amountMonthly, income.startsOn, income.endsOn,
    income.intoPot ? 1 : 0, income.indexed ? 1 : 0, income.notes, id,
  ];
  if (insert) {
    db.prepare(`INSERT INTO incomes (owner, name, amount_monthly, starts_on, ends_on, into_pot, indexed, notes, id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...values);
  } else {
    db.prepare(`UPDATE incomes SET owner = ?, name = ?, amount_monthly = ?, starts_on = ?, ends_on = ?,
      into_pot = ?, indexed = ?, notes = ? WHERE id = ?`).run(...values);
  }
}

export function createIncome(db: Database.Database, input: Partial<IncomeWrite>): OtherIncome {
  const income = normalizeIncome(input);
  const id = crypto.randomUUID();
  writeIncome(db, id, income, true);
  return { id, ...income };
}

export function updateIncome(db: Database.Database, id: string, input: Partial<IncomeWrite>): OtherIncome {
  const row = db.prepare('SELECT * FROM incomes WHERE id = ?').get(id) as IncomeRow | undefined;
  if (!row) fail('Income not found');
  const income = normalizeIncome(input, mapIncome(row));
  writeIncome(db, id, income, false);
  return { id, ...income };
}

export function deleteIncome(db: Database.Database, id: string) {
  const result = db.prepare('DELETE FROM incomes WHERE id = ?').run(id);
  if (result.changes === 0) fail('Income not found');
}

function mapBalance(row: BalanceRow): Balance {
  return {
    id: row.id,
    accountId: row.account_id,
    date: row.date,
    balance: row.balance,
    contributed: row.contributed,
    note: row.note ?? '',
  };
}

function settingNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw === '') return fallback;
  const number = Number(raw);
  return Number.isFinite(number) ? number : fallback;
}

function settingOptional(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function readSettings(db: Database.Database): FinanceSettings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const get = (key: string) => map.get(key);
  const scope = get(SETTING_KEYS.retirementScope);
  const withdrawal = get(SETTING_KEYS.withdrawal);
  return {
    inflationPct: settingNumber(get(SETTING_KEYS.inflationPct), DEFAULT_SETTINGS.inflationPct),
    horizonAge: settingNumber(get(SETTING_KEYS.horizonAge), DEFAULT_SETTINGS.horizonAge),
    scenarioSpreadPct: settingNumber(get(SETTING_KEYS.scenarioSpreadPct), DEFAULT_SETTINGS.scenarioSpreadPct),
    pensionNetFactor: settingNumber(get(SETTING_KEYS.pensionNetFactor), DEFAULT_SETTINGS.pensionNetFactor),
    pensionGrowthPct: settingNumber(get(SETTING_KEYS.pensionGrowthPct), DEFAULT_SETTINGS.pensionGrowthPct),
    durchschnittsentgeltAnnual: settingNumber(get(SETTING_KEYS.durchschnittsentgeltAnnual), DEFAULT_SETTINGS.durchschnittsentgeltAnnual),
    rentenwert: settingNumber(get(SETTING_KEYS.rentenwert), DEFAULT_SETTINGS.rentenwert),
    contributionCapMonthly: settingNumber(get(SETTING_KEYS.contributionCapMonthly), DEFAULT_SETTINGS.contributionCapMonthly),
    pensionTaxKeep: settingNumber(get(SETTING_KEYS.pensionTaxKeep), DEFAULT_SETTINGS.pensionTaxKeep),
    regularPensionAge: settingNumber(get(SETTING_KEYS.regularPensionAge), DEFAULT_SETTINGS.regularPensionAge),
    earliestPensionAge: settingNumber(get(SETTING_KEYS.earliestPensionAge), DEFAULT_SETTINGS.earliestPensionAge),
    withdrawal: withdrawal === 'gap' || withdrawal == null ? 'gap' : 'gap',
    lifestyle: settingNumber(get(SETTING_KEYS.lifestyle), DEFAULT_SETTINGS.lifestyle),
    retirementScope: scope === 'household' ? 'household' : 'individual',
    onboarded: get(SETTING_KEYS.onboarded) === '1',
    householdMode: get(SETTING_KEYS.householdMode) === 'solo' ? 'solo' : 'joint',
    rentMonthly: settingNumber(get(SETTING_KEYS.rentMonthly), DEFAULT_SETTINGS.rentMonthly),
    sharedSpendMonthly: settingNumber(get(SETTING_KEYS.sharedSpendMonthly), DEFAULT_SETTINGS.sharedSpendMonthly),
    sharedCostShare: settingOptional(get(SETTING_KEYS.sharedCostShare)),
    spendingPersonalMonthly: settingOptional(get(SETTING_KEYS.spendingPersonalMonthly)),
    spendingHouseholdMonthly: settingOptional(get(SETTING_KEYS.spendingHouseholdMonthly)),
    housingPersonalMonthly: settingOptional(get(SETTING_KEYS.housingPersonalMonthly)),
    housingHouseholdMonthly: settingOptional(get(SETTING_KEYS.housingHouseholdMonthly)),
  };
}

function seed(db: Database.Database) {
  db.prepare('INSERT INTO people (id, name, pension_mode) VALUES (?, ?, ?)').run('person_1', 'You', 'stated');
  db.prepare('INSERT INTO people (id, name, pension_mode) VALUES (?, ?, ?)').run('person_2', 'Partner', 'stated');
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const defaults: Record<string, string> = {
    [SETTING_KEYS.inflationPct]: String(DEFAULT_SETTINGS.inflationPct),
    [SETTING_KEYS.horizonAge]: String(DEFAULT_SETTINGS.horizonAge),
    [SETTING_KEYS.scenarioSpreadPct]: String(DEFAULT_SETTINGS.scenarioSpreadPct),
    [SETTING_KEYS.pensionNetFactor]: String(DEFAULT_SETTINGS.pensionNetFactor),
    [SETTING_KEYS.pensionGrowthPct]: String(DEFAULT_SETTINGS.pensionGrowthPct),
    [SETTING_KEYS.durchschnittsentgeltAnnual]: String(DEFAULT_SETTINGS.durchschnittsentgeltAnnual),
    [SETTING_KEYS.rentenwert]: String(DEFAULT_SETTINGS.rentenwert),
    [SETTING_KEYS.contributionCapMonthly]: String(DEFAULT_SETTINGS.contributionCapMonthly),
    [SETTING_KEYS.pensionTaxKeep]: String(DEFAULT_SETTINGS.pensionTaxKeep),
    [SETTING_KEYS.regularPensionAge]: String(DEFAULT_SETTINGS.regularPensionAge),
    [SETTING_KEYS.earliestPensionAge]: String(DEFAULT_SETTINGS.earliestPensionAge),
    [SETTING_KEYS.withdrawal]: DEFAULT_SETTINGS.withdrawal,
    [SETTING_KEYS.lifestyle]: String(DEFAULT_SETTINGS.lifestyle),
    [SETTING_KEYS.retirementScope]: DEFAULT_SETTINGS.retirementScope,
    [SETTING_KEYS.spendingPersonalMonthly]: '',
    [SETTING_KEYS.spendingHouseholdMonthly]: '',
    [SETTING_KEYS.housingPersonalMonthly]: '',
    [SETTING_KEYS.housingHouseholdMonthly]: '',
  };
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
}

function migrate(db: Database.Database) {
  let version = Number(db.pragma('user_version', { simple: true }));
  if (version < 1) {
    const run = db.transaction(() => {
      db.exec(SCHEMA);
      seed(db);
      db.pragma('user_version = 1');
    });
    run();
    version = 1;
  }
  if (version < 2) {
    const run = db.transaction(() => {
      db.exec(`
        ALTER TABLE people ADD COLUMN net_salary_monthly REAL;
        ALTER TABLE people ADD COLUMN salary_increase_kind TEXT NOT NULL DEFAULT 'percent';
        ALTER TABLE people ADD COLUMN salary_increase_value REAL NOT NULL DEFAULT 0;
        ALTER TABLE people ADD COLUMN salary_increase_every TEXT NOT NULL DEFAULT 'year';
        ALTER TABLE accounts ADD COLUMN contribution_increase_kind TEXT NOT NULL DEFAULT 'percent';
        ALTER TABLE accounts ADD COLUMN contribution_increase_value REAL NOT NULL DEFAULT 0;
        ALTER TABLE accounts ADD COLUMN contribution_increase_every TEXT NOT NULL DEFAULT 'year';
        UPDATE accounts SET contribution_increase_value = contribution_growth_pct;
      `);
      db.pragma('user_version = 2');
    });
    run();
  }
  if (version < 3) {
    const run = db.transaction(() => {
      db.exec(`
        ALTER TABLE people ADD COLUMN payslip_rv_monthly REAL;
        ALTER TABLE people ADD COLUMN payslip_kv_monthly REAL;
        ALTER TABLE people ADD COLUMN payslip_zusatz_monthly REAL;
        ALTER TABLE people ADD COLUMN payslip_zusatz_rate_pct REAL;
      `);
      db.pragma('user_version = 3');
    });
    run();
  }
  if (version < 4) {
    const run = db.transaction(() => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN owner_share REAL NOT NULL DEFAULT 1;
        UPDATE accounts SET owner_share = 0 WHERE owner NOT IN ('joint', (SELECT id FROM people ORDER BY rowid LIMIT 1));
        UPDATE accounts SET owner_share = 0.5 WHERE owner = 'joint';
      `);
      db.pragma('user_version = 4');
    });
    run();
  }
  if (version < 5) {
    // Rebuild the tables so the database itself rejects bad rows, including writes made outside the app.
    db.pragma('foreign_keys = OFF');
    const run = db.transaction(() => {
      db.exec(`
        -- Accounts first: their owner mapping reads the old person ids.
        CREATE TABLE accounts_v5 (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL CHECK (owner IN ('self', 'partner', 'joint')),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          type TEXT NOT NULL CHECK (type IN ('etf','stocks','savings','fixed_term','crypto','bav','riester','private_pension','real_estate','cash','other')),
          opened_on TEXT,
          monthly_contribution REAL NOT NULL DEFAULT 0 CHECK (monthly_contribution >= 0),
          contribution_growth_pct REAL NOT NULL DEFAULT 0,
          contribution_increase_kind TEXT NOT NULL DEFAULT 'percent' CHECK (contribution_increase_kind IN ('percent', 'amount')),
          contribution_increase_value REAL NOT NULL DEFAULT 0,
          contribution_increase_every TEXT NOT NULL DEFAULT 'year' CHECK (contribution_increase_every IN ('year', 'month')),
          expected_return_pct REAL NOT NULL DEFAULT 0,
          interest_rate_pct REAL,
          risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),
          notes TEXT NOT NULL DEFAULT '',
          closed_on TEXT,
          treatment TEXT NOT NULL DEFAULT 'portfolio' CHECK (treatment IN ('portfolio', 'income')),
          income_monthly REAL CHECK (income_monthly IS NULL OR income_monthly >= 0),
          income_start_age REAL,
          owner_share REAL NOT NULL DEFAULT 0.5 CHECK (owner_share BETWEEN 0 AND 1)
        );
        INSERT INTO accounts_v5 (
          id, owner, name, type, opened_on, monthly_contribution, contribution_growth_pct,
          contribution_increase_kind, contribution_increase_value, contribution_increase_every,
          expected_return_pct, interest_rate_pct, risk, notes, closed_on, treatment, income_monthly,
          income_start_age, owner_share
        )
        SELECT id, CASE WHEN owner = 'joint' THEN 'joint' WHEN owner = (SELECT id FROM people ORDER BY rowid LIMIT 1) THEN 'self' ELSE 'partner' END,
          name, type, opened_on, monthly_contribution, contribution_growth_pct,
          contribution_increase_kind, contribution_increase_value, contribution_increase_every,
          expected_return_pct, interest_rate_pct, risk, notes, closed_on, treatment, income_monthly,
          income_start_age, owner_share
        FROM accounts;
        DROP TABLE accounts;
        ALTER TABLE accounts_v5 RENAME TO accounts;

        CREATE TABLE people_v5 (
          id TEXT PRIMARY KEY CHECK (id IN ('self', 'partner')),
          name TEXT NOT NULL,
          birth_date TEXT CHECK (birth_date IS NULL OR birth_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          pension_mode TEXT NOT NULL DEFAULT 'stated' CHECK (pension_mode IN ('stated', 'estimate')),
          pension_stated_monthly REAL CHECK (pension_stated_monthly IS NULL OR pension_stated_monthly >= 0),
          pension_points REAL CHECK (pension_points IS NULL OR pension_points >= 0),
          gross_salary_monthly REAL CHECK (gross_salary_monthly IS NULL OR gross_salary_monthly >= 0),
          contribution_years REAL CHECK (contribution_years IS NULL OR contribution_years >= 0),
          net_salary_monthly REAL CHECK (net_salary_monthly IS NULL OR net_salary_monthly >= 0),
          salary_increase_kind TEXT NOT NULL DEFAULT 'percent' CHECK (salary_increase_kind IN ('percent', 'amount')),
          salary_increase_value REAL NOT NULL DEFAULT 0,
          salary_increase_every TEXT NOT NULL DEFAULT 'year' CHECK (salary_increase_every IN ('year', 'month')),
          payslip_rv_monthly REAL,
          payslip_kv_monthly REAL,
          payslip_zusatz_monthly REAL,
          payslip_zusatz_rate_pct REAL,
          personal_allowance_monthly REAL CHECK (personal_allowance_monthly IS NULL OR personal_allowance_monthly >= 0)
        );
        INSERT INTO people_v5 (
          id, name, birth_date, pension_mode, pension_stated_monthly, pension_points, gross_salary_monthly,
          contribution_years, net_salary_monthly, salary_increase_kind, salary_increase_value, salary_increase_every,
          payslip_rv_monthly, payslip_kv_monthly, payslip_zusatz_monthly, payslip_zusatz_rate_pct
        )
        SELECT CASE WHEN id = (SELECT id FROM people ORDER BY rowid LIMIT 1) THEN 'self' ELSE 'partner' END,
          name, birth_date, pension_mode, pension_stated_monthly, pension_points, gross_salary_monthly,
          contribution_years, net_salary_monthly, salary_increase_kind, salary_increase_value, salary_increase_every,
          payslip_rv_monthly, payslip_kv_monthly, payslip_zusatz_monthly, payslip_zusatz_rate_pct
        FROM people;
        DROP TABLE people;
        ALTER TABLE people_v5 RENAME TO people;

        CREATE TABLE balances_v5 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          balance REAL NOT NULL,
          contributed REAL,
          note TEXT NOT NULL DEFAULT '',
          UNIQUE (account_id, date)
        );
        INSERT INTO balances_v5 (id, account_id, date, balance) SELECT id, account_id, date, balance FROM balances;
        DROP TABLE balances;
        ALTER TABLE balances_v5 RENAME TO balances;
        CREATE INDEX balances_account ON balances(account_id);

        INSERT OR IGNORE INTO settings (key, value) VALUES
          ('onboarded', ''),
          ('household_mode', 'joint'),
          ('rent_monthly', '0'),
          ('shared_spend_monthly', '0'),
          ('shared_cost_share', '');
      `);
      const broken = db.pragma('foreign_key_check') as unknown[];
      if (broken.length) throw new Error('Migration to v5 left orphaned balance rows');
      db.pragma('user_version = 5');
    });
    run();
    db.pragma('foreign_keys = ON');
  }
  if (version < 6) {
    const run = db.transaction(() => {
      db.exec(`
        CREATE TABLE incomes (
          id TEXT PRIMARY KEY,
          owner TEXT NOT NULL CHECK (owner IN ('self', 'partner', 'joint')),
          name TEXT NOT NULL CHECK (length(trim(name)) > 0),
          amount_monthly REAL NOT NULL CHECK (amount_monthly >= 0),
          starts_on TEXT CHECK (starts_on IS NULL OR starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          ends_on TEXT CHECK (ends_on IS NULL OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
          into_pot INTEGER NOT NULL DEFAULT 1 CHECK (into_pot IN (0, 1)),
          indexed INTEGER NOT NULL DEFAULT 1 CHECK (indexed IN (0, 1)),
          notes TEXT NOT NULL DEFAULT '',
          CHECK (starts_on IS NULL OR ends_on IS NULL OR starts_on < ends_on)
        );
      `);
      db.pragma('user_version = 6');
    });
    run();
  }
  if (version < 7) {
    const run = db.transaction(() => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN portion_date TEXT
          CHECK (portion_date IS NULL OR portion_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
        ALTER TABLE accounts ADD COLUMN portion_self REAL CHECK (portion_self IS NULL OR portion_self >= 0);
      `);
      db.pragma('user_version = 7');
    });
    run();
  }
  if (version < 8) {
    const run = db.transaction(() => {
      db.exec(`
        ALTER TABLE accounts ADD COLUMN accessible INTEGER NOT NULL DEFAULT 1 CHECK (accessible IN (0, 1));
        UPDATE accounts SET accessible = 0 WHERE type IN ('bav', 'riester', 'private_pension');
      `);
      db.pragma('user_version = 8');
    });
    run();
  }
  if (version < 9) {
    const run = db.transaction(() => {
      db.exec(`
        CREATE TABLE contribution_periods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          from_month TEXT NOT NULL CHECK (from_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          to_month TEXT CHECK (to_month IS NULL OR to_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
          amount_monthly REAL NOT NULL CHECK (amount_monthly >= 0),
          note TEXT NOT NULL DEFAULT '',
          CHECK (to_month IS NULL OR to_month >= from_month)
        );
        CREATE INDEX contribution_periods_account ON contribution_periods(account_id);
      `);
      db.pragma('user_version = 9');
    });
    run();
  }
}

interface PeriodRow {
  account_id: string;
  from_month: string;
  to_month: string | null;
  amount_monthly: number;
  note: string;
}

function asMonth(value: unknown, label: string): string {
  const text = String(value ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return fail(`${label} must be a month, YYYY-MM`);
  return text;
}

/** Checks a whole history: valid months and amounts, no overlaps, only the last period open-ended. */
function normalizeHistory(input: unknown): ContributionPeriod[] {
  if (!Array.isArray(input)) return fail('Contribution history must be a list');
  const periods = input.map((raw: Partial<ContributionPeriod>) => {
    const fromMonth = asMonth(raw.fromMonth, 'From');
    const toMonth = raw.toMonth == null || raw.toMonth === '' ? null : asMonth(raw.toMonth, 'To');
    if (toMonth && toMonth < fromMonth) fail(`A period ends before it starts (${fromMonth} to ${toMonth})`);
    return {
      fromMonth,
      toMonth,
      amountMonthly: inRange(finite(raw.amountMonthly, 'Monthly amount'), 'Monthly amount', 0, 1_000_000),
      note: String(raw.note ?? '').slice(0, 200),
    };
  }).sort((a, b) => a.fromMonth.localeCompare(b.fromMonth));
  for (let index = 1; index < periods.length; index++) {
    const before = periods[index - 1];
    if (before.toMonth == null || before.toMonth >= periods[index].fromMonth) {
      fail(`Periods overlap: ${before.fromMonth}${before.toMonth ? ` to ${before.toMonth}` : ' onwards'} and ${periods[index].fromMonth}`);
    }
  }
  return periods;
}

function readHistory(db: Database.Database, accountId: string): ContributionPeriod[] {
  return (db.prepare('SELECT * FROM contribution_periods WHERE account_id = ? ORDER BY from_month').all(accountId) as PeriodRow[])
    .map((row) => ({ fromMonth: row.from_month, toMonth: row.to_month, amountMonthly: row.amount_monthly, note: row.note }));
}

function writeHistory(db: Database.Database, accountId: string, periods: ContributionPeriod[]) {
  db.prepare('DELETE FROM contribution_periods WHERE account_id = ?').run(accountId);
  const insert = db.prepare('INSERT INTO contribution_periods (account_id, from_month, to_month, amount_monthly, note) VALUES (?, ?, ?, ?, ?)');
  for (const period of periods) insert.run(accountId, period.fromMonth, period.toMonth, period.amountMonthly, period.note);
}

export function openDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function loadFinance(db: Database.Database): FinanceData {
  const people = (db.prepare("SELECT * FROM people ORDER BY CASE id WHEN 'self' THEN 0 ELSE 1 END").all() as PersonRow[]).map(mapPerson);
  const histories = new Map<string, ContributionPeriod[]>();
  for (const row of db.prepare('SELECT * FROM contribution_periods ORDER BY from_month').all() as PeriodRow[]) {
    const list = histories.get(row.account_id) ?? [];
    list.push({ fromMonth: row.from_month, toMonth: row.to_month, amountMonthly: row.amount_monthly, note: row.note });
    histories.set(row.account_id, list);
  }
  const accounts = (db.prepare('SELECT * FROM accounts ORDER BY name COLLATE NOCASE').all() as AccountRow[])
    .map((row) => ({ ...mapAccount(row), contributionHistory: histories.get(row.id) ?? [] }));
  const balances = (db.prepare('SELECT * FROM balances ORDER BY date, id').all() as BalanceRow[]).map(mapBalance);
  const incomes = (db.prepare('SELECT * FROM incomes ORDER BY name COLLATE NOCASE').all() as IncomeRow[]).map(mapIncome);
  return { people, accounts, balances, incomes, settings: readSettings(db) };
}

function normalizeAccount(input: AccountWrite, existing?: Account): Omit<Account, 'id'> {
  const type = asType(input.type ?? existing?.type);
  const info = accountTypeInfo(type);
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name) fail('Name is required');
  if (name.length > 80) fail('Name is too long');
  const monthly = inRange(
    finite(input.monthlyContribution, 'Monthly contribution', existing?.monthlyContribution ?? 0),
    'Monthly contribution',
    0,
    1_000_000,
  );
  const increaseKind = asKind(input.contributionIncreaseKind ?? existing?.contributionIncreaseKind ?? (input.contributionGrowthPct != null ? 'percent' : undefined));
  const increaseEvery = asEvery(input.contributionIncreaseEvery ?? existing?.contributionIncreaseEvery);
  const increaseFallback = existing?.contributionIncreaseValue ?? existing?.contributionGrowthPct ?? 0;
  const increaseValue = finite(
    input.contributionIncreaseValue ?? input.contributionGrowthPct,
    'Contribution increase',
    increaseFallback,
  );
  if (increaseKind === 'percent') inRange(increaseValue, 'Contribution increase', -10, 50);
  else inRange(increaseValue, 'Contribution increase', 0, 1_000_000);
  const growth = increaseKind === 'percent' && increaseEvery === 'year' ? increaseValue : 0;
  const expected = inRange(
    finite(input.expectedReturnPct, 'Expected return', existing?.expectedReturnPct ?? info.defaultReturn),
    'Expected return',
    -20,
    40,
  );
  const interest = optionalNumber(input.interestRatePct === undefined ? existing?.interestRatePct : input.interestRatePct, 'Interest rate');
  if (interest != null) inRange(interest, 'Interest rate', 0, 30);
  const treatment = input.treatment == null && existing ? existing.treatment : asTreatment(input.treatment);
  const income = optionalNumber(input.incomeMonthly === undefined ? existing?.incomeMonthly : input.incomeMonthly, 'Monthly income');
  if (income != null) inRange(income, 'Monthly income', 0, 1_000_000);
  const incomeAge = optionalNumber(input.incomeStartAge === undefined ? existing?.incomeStartAge : input.incomeStartAge, 'Income start age');
  if (incomeAge != null) inRange(incomeAge, 'Income start age', 0, 100);
  const notes = String(input.notes ?? existing?.notes ?? '').slice(0, 2000);
  const owner = input.owner == null && existing ? existing.owner : asOwner(input.owner);
  const ownerShare = owner === 'joint'
    ? inRange(
      finite(input.ownerShare === undefined ? existing?.ownerShare ?? 0.5 : input.ownerShare, 'My share'),
      'My share',
      0,
      1,
    )
    : owner === 'partner' ? 0 : 1;
  const portionDate = owner !== 'joint' ? null : input.portionDate === undefined ? existing?.portionDate ?? null : asDate(input.portionDate);
  const portionSelfRaw = owner !== 'joint' || !portionDate
    ? null
    : optionalNumber(input.portionSelf === undefined ? existing?.portionSelf : input.portionSelf, 'Your part');
  if (portionDate && portionSelfRaw == null) fail('Your part of the balance is needed with a portion date');
  const portionSelf = portionSelfRaw == null ? null : inRange(portionSelfRaw, 'Your part', 0, 1_000_000_000);
  return {
    owner,
    name,
    type,
    openedOn: input.openedOn === undefined ? existing?.openedOn ?? null : asDate(input.openedOn),
    monthlyContribution: monthly,
    contributionGrowthPct: growth,
    contributionIncreaseKind: increaseKind,
    contributionIncreaseValue: increaseValue,
    contributionIncreaseEvery: increaseEvery,
    expectedReturnPct: expected,
    interestRatePct: interest,
    risk: asRisk(input.risk === undefined ? existing?.risk : input.risk, info.defaultRisk),
    notes,
    closedOn: input.closedOn === undefined ? existing?.closedOn ?? null : asDate(input.closedOn),
    treatment,
    incomeMonthly: income,
    incomeStartAge: incomeAge,
    ownerShare,
    portionDate,
    portionSelf,
    accessible: input.accessible == null
      ? existing?.accessible ?? !LOCKED_TYPES.includes(type)
      : Boolean(input.accessible),
    contributionHistory: input.contributionHistory === undefined
      ? existing?.contributionHistory ?? []
      : normalizeHistory(input.contributionHistory),
  };
}

function insertAccount(db: Database.Database, id: string, account: Omit<Account, 'id'>) {
  db.prepare(`INSERT INTO accounts (
    id, owner, name, type, opened_on, monthly_contribution, contribution_growth_pct,
    contribution_increase_kind, contribution_increase_value, contribution_increase_every,
    expected_return_pct, interest_rate_pct, risk, notes, closed_on, treatment, income_monthly, income_start_age,
    owner_share, portion_date, portion_self, accessible
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    account.owner,
    account.name,
    account.type,
    account.openedOn,
    account.monthlyContribution,
    account.contributionGrowthPct,
    account.contributionIncreaseKind,
    account.contributionIncreaseValue,
    account.contributionIncreaseEvery,
    account.expectedReturnPct,
    account.interestRatePct,
    account.risk,
    account.notes,
    account.closedOn,
    account.treatment,
    account.incomeMonthly,
    account.incomeStartAge,
    account.ownerShare,
    account.portionDate,
    account.portionSelf,
    account.accessible ? 1 : 0,
  );
}

function writeBalance(
  db: Database.Database,
  accountId: string,
  date: string,
  balance: number,
  contributed: number | null = null,
  note = '',
) {
  db.prepare(`INSERT INTO balances (account_id, date, balance, contributed, note) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (account_id, date) DO UPDATE SET
      balance = excluded.balance, contributed = excluded.contributed, note = excluded.note`).run(accountId, date, balance, contributed, note);
}

export function createAccount(db: Database.Database, input: AccountWrite): Account {
  const account = normalizeAccount(input);
  const balance = input.balance == null ? 0 : inRange(finite(input.balance, 'Balance'), 'Balance', -1_000_000_000, 1_000_000_000);
  const date = asDate(input.balanceDate) ?? todayIso();
  const id = crypto.randomUUID();
  const run = db.transaction(() => {
    insertAccount(db, id, account);
    writeBalance(db, id, date, balance);
    writeHistory(db, id, account.contributionHistory);
  });
  run();
  return { id, ...account };
}

export function updateAccount(db: Database.Database, id: string, input: Partial<AccountWrite>): Account {
  const existing = (db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined);
  if (!existing) fail('Account not found');
  const current = { ...mapAccount(existing), contributionHistory: readHistory(db, id) };
  const account = normalizeAccount({ ...current, ...input, type: input.type ?? current.type }, current);
  db.prepare(`UPDATE accounts SET
    owner = ?, name = ?, type = ?, opened_on = ?, monthly_contribution = ?, contribution_growth_pct = ?,
    contribution_increase_kind = ?, contribution_increase_value = ?, contribution_increase_every = ?,
    expected_return_pct = ?, interest_rate_pct = ?, risk = ?, notes = ?, closed_on = ?, treatment = ?,
    income_monthly = ?, income_start_age = ?, owner_share = ?, portion_date = ?, portion_self = ?, accessible = ?
    WHERE id = ?`).run(
    account.owner,
    account.name,
    account.type,
    account.openedOn,
    account.monthlyContribution,
    account.contributionGrowthPct,
    account.contributionIncreaseKind,
    account.contributionIncreaseValue,
    account.contributionIncreaseEvery,
    account.expectedReturnPct,
    account.interestRatePct,
    account.risk,
    account.notes,
    account.closedOn,
    account.treatment,
    account.incomeMonthly,
    account.incomeStartAge,
    account.ownerShare,
    account.portionDate,
    account.portionSelf,
    account.accessible ? 1 : 0,
    id,
  );
  if (input.contributionHistory !== undefined) writeHistory(db, id, account.contributionHistory);
  return { id, ...account };
}

export function deleteAccount(db: Database.Database, id: string) {
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (result.changes === 0) fail('Account not found');
}

function saveBalance(db: Database.Database, input: BalanceWrite): Balance {
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(input.accountId);
  if (!account) fail('Account not found');
  const date = asDate(input.date);
  if (!date) fail('Date is required');
  const balance = inRange(finite(input.balance, 'Balance'), 'Balance', -1_000_000_000, 1_000_000_000);
  const contributed = optionalNumber(input.contributed, 'Paid in');
  if (contributed != null) inRange(contributed, 'Paid in', -1_000_000_000, 1_000_000_000);
  writeBalance(db, input.accountId, date, balance, contributed, String(input.note ?? '').slice(0, 500));
  const row = db.prepare('SELECT * FROM balances WHERE account_id = ? AND date = ?').get(input.accountId, date) as BalanceRow;
  return mapBalance(row);
}

export function addBalance(db: Database.Database, input: BalanceWrite): Balance {
  return saveBalance(db, input);
}

/** A check-in: several accounts at once. All rows are written or none are. */
export function addBalances(db: Database.Database, inputs: BalanceWrite[]): Balance[] {
  if (!Array.isArray(inputs) || inputs.length === 0) fail('Nothing to save');
  const run = db.transaction(() => inputs.map((input) => saveBalance(db, input)));
  return run();
}

export function deleteBalance(db: Database.Database, id: number) {
  const result = db.prepare('DELETE FROM balances WHERE id = ?').run(id);
  if (result.changes === 0) fail('Snapshot not found');
}

export function updatePerson(db: Database.Database, id: string, patch: Partial<Person>): Person {
  if (id !== 'self' && id !== 'partner') fail('Unknown person');
  const existing = db.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow | undefined;
  if (!existing) fail('Unknown person');
  const current = mapPerson(existing);
  const next: Person = {
    ...current,
    name: patch.name == null ? current.name : String(patch.name).trim() || current.name,
    birthDate: patch.birthDate === undefined ? current.birthDate : asDate(patch.birthDate),
    pensionMode: patch.pensionMode == null ? current.pensionMode : asMode(patch.pensionMode),
    pensionStatedMonthly: patch.pensionStatedMonthly === undefined
      ? current.pensionStatedMonthly
      : optionalNumber(patch.pensionStatedMonthly, 'Stated pension'),
    pensionPoints: patch.pensionPoints === undefined ? current.pensionPoints : optionalNumber(patch.pensionPoints, 'Entgeltpunkte'),
    grossSalaryMonthly: patch.grossSalaryMonthly === undefined
      ? current.grossSalaryMonthly
      : optionalNumber(patch.grossSalaryMonthly, 'Gross salary'),
    contributionYears: patch.contributionYears === undefined
      ? current.contributionYears
      : optionalNumber(patch.contributionYears, 'Contribution years'),
    netSalaryMonthly: patch.netSalaryMonthly === undefined
      ? current.netSalaryMonthly
      : optionalNumber(patch.netSalaryMonthly, 'Net salary'),
    salaryIncreaseKind: patch.salaryIncreaseKind == null ? current.salaryIncreaseKind : asKind(patch.salaryIncreaseKind),
    salaryIncreaseValue: patch.salaryIncreaseValue === undefined ? current.salaryIncreaseValue : finite(patch.salaryIncreaseValue, 'Salary increase', 0),
    salaryIncreaseEvery: patch.salaryIncreaseEvery == null ? current.salaryIncreaseEvery : asEvery(patch.salaryIncreaseEvery),
    payslipRvMonthly: patch.payslipRvMonthly === undefined ? current.payslipRvMonthly : optionalNumber(patch.payslipRvMonthly, 'Pension contribution'),
    payslipKvMonthly: patch.payslipKvMonthly === undefined ? current.payslipKvMonthly : optionalNumber(patch.payslipKvMonthly, 'Health contribution'),
    payslipZusatzMonthly: patch.payslipZusatzMonthly === undefined
      ? current.payslipZusatzMonthly
      : optionalNumber(patch.payslipZusatzMonthly, 'Zusatzbeitrag'),
    payslipZusatzRatePct: patch.payslipZusatzRatePct === undefined
      ? current.payslipZusatzRatePct
      : optionalNumber(patch.payslipZusatzRatePct, 'Zusatzbeitrag rate'),
    personalAllowanceMonthly: patch.personalAllowanceMonthly === undefined
      ? current.personalAllowanceMonthly
      : optionalNumber(patch.personalAllowanceMonthly, 'Personal allowance'),
  };
  if (next.pensionStatedMonthly != null) inRange(next.pensionStatedMonthly, 'Stated pension', 0, 100_000);
  if (next.pensionPoints != null) inRange(next.pensionPoints, 'Entgeltpunkte', 0, 120);
  if (next.grossSalaryMonthly != null) inRange(next.grossSalaryMonthly, 'Gross salary', 0, 1_000_000);
  if (next.netSalaryMonthly != null) inRange(next.netSalaryMonthly, 'Net salary', 0, 1_000_000);
  if (next.salaryIncreaseKind === 'percent') inRange(next.salaryIncreaseValue, 'Salary increase', -10, 50);
  else inRange(next.salaryIncreaseValue, 'Salary increase', 0, 1_000_000);
  if (next.contributionYears != null) inRange(next.contributionYears, 'Contribution years', 0, 60);
  if (next.payslipRvMonthly != null) inRange(next.payslipRvMonthly, 'Pension contribution', 0, 100_000);
  if (next.payslipKvMonthly != null) inRange(next.payslipKvMonthly, 'Health contribution', 0, 100_000);
  if (next.payslipZusatzMonthly != null) inRange(next.payslipZusatzMonthly, 'Zusatzbeitrag', 0, 100_000);
  if (next.payslipZusatzRatePct != null) inRange(next.payslipZusatzRatePct, 'Zusatzbeitrag rate', 0, 10);
  if (next.personalAllowanceMonthly != null) inRange(next.personalAllowanceMonthly, 'Personal allowance', 0, 1_000_000);
  db.prepare(`UPDATE people SET name = ?, birth_date = ?, pension_mode = ?, pension_stated_monthly = ?,
    pension_points = ?, gross_salary_monthly = ?, net_salary_monthly = ?, contribution_years = ?,
    salary_increase_kind = ?, salary_increase_value = ?, salary_increase_every = ?,
    payslip_rv_monthly = ?, payslip_kv_monthly = ?, payslip_zusatz_monthly = ?, payslip_zusatz_rate_pct = ?,
    personal_allowance_monthly = ?
    WHERE id = ?`).run(
    next.name,
    next.birthDate,
    next.pensionMode,
    next.pensionStatedMonthly,
    next.pensionPoints,
    next.grossSalaryMonthly,
    next.netSalaryMonthly,
    next.contributionYears,
    next.salaryIncreaseKind,
    next.salaryIncreaseValue,
    next.salaryIncreaseEvery,
    next.payslipRvMonthly,
    next.payslipKvMonthly,
    next.payslipZusatzMonthly,
    next.payslipZusatzRatePct,
    next.personalAllowanceMonthly,
    id,
  );
  return next;
}

const NULLABLE_SETTINGS = new Set<keyof FinanceSettings>([
  'spendingPersonalMonthly',
  'spendingHouseholdMonthly',
  'housingPersonalMonthly',
  'housingHouseholdMonthly',
  'sharedCostShare',
]);

export function updateSettings(db: Database.Database, patch: Partial<FinanceSettings>): FinanceSettings {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const run = db.transaction(() => {
    for (const [camel, column] of Object.entries(SETTING_KEYS) as [keyof FinanceSettings, string][]) {
      if (patch[camel] === undefined) continue;
      const value = patch[camel];
      if (camel === 'retirementScope') {
        const scope = value === 'household' ? 'household' : value === 'individual' ? 'individual' : fail('Scope must be individual or household');
        upsert.run(column, scope satisfies RetirementScope);
        continue;
      }
      if (camel === 'withdrawal') {
        upsert.run(column, 'gap');
        continue;
      }
      if (camel === 'onboarded') {
        upsert.run(column, value ? '1' : '');
        continue;
      }
      if (camel === 'householdMode') {
        const mode = value === 'solo' ? 'solo' : value === 'joint' ? 'joint' : fail('Household mode must be solo or joint');
        upsert.run(column, mode satisfies HouseholdMode);
        continue;
      }
      if (NULLABLE_SETTINGS.has(camel) && value == null) {
        upsert.run(column, '');
        continue;
      }
      const number = finite(value, camel);
      if (camel === 'pensionNetFactor') inRange(number, 'Pension net factor', 0, 1);
      if (camel === 'lifestyle') inRange(number, 'Lifestyle', 0.2, 3);
      if (camel === 'horizonAge') inRange(number, 'Horizon age', 50, 120);
      if (camel === 'inflationPct') inRange(number, 'Inflation', -5, 20);
      if (camel === 'scenarioSpreadPct') inRange(number, 'Scenario spread', 0, 15);
      if (camel === 'rentenwert') inRange(number, 'Rentenwert', 0, 500);
      if (camel === 'durchschnittsentgeltAnnual') inRange(number, 'Durchschnittsentgelt', 0, 500_000);
      if (camel === 'contributionCapMonthly') inRange(number, 'Contribution cap', 0, 100_000);
      if (camel === 'pensionTaxKeep') inRange(number, 'Pension tax keep', 0, 1);
      if (camel === 'sharedCostShare') inRange(number, 'Share of shared costs', 0, 1);
      if (camel === 'rentMonthly') inRange(number, 'Rent', 0, 1_000_000);
      if (camel === 'sharedSpendMonthly') inRange(number, 'Shared spending', 0, 1_000_000);
      upsert.run(column, String(number));
    }
  });
  run();
  return readSettings(db);
}

export function exportFinanceCsv(db: Database.Database, dir: string): string[] {
  mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, headers: string[], rows: Record<string, string | number>[]) => {
    writeFileSync(join(dir, name), serializeCsv(headers, rows));
    files.push(name);
  };
  const data = loadFinance(db);
  write('people.csv', ['id', 'name', 'birth_date', 'pension_mode', 'pension_stated_monthly', 'pension_points', 'gross_salary_monthly', 'net_salary_monthly', 'contribution_years', 'salary_increase_kind', 'salary_increase_value', 'salary_increase_every', 'payslip_rv_monthly', 'payslip_kv_monthly', 'payslip_zusatz_monthly', 'payslip_zusatz_rate_pct', 'personal_allowance_monthly'], data.people.map((person) => ({
    id: person.id,
    name: person.name,
    birth_date: person.birthDate ?? '',
    pension_mode: person.pensionMode,
    pension_stated_monthly: person.pensionStatedMonthly ?? '',
    pension_points: person.pensionPoints ?? '',
    gross_salary_monthly: person.grossSalaryMonthly ?? '',
    net_salary_monthly: person.netSalaryMonthly ?? '',
    contribution_years: person.contributionYears ?? '',
    salary_increase_kind: person.salaryIncreaseKind,
    salary_increase_value: person.salaryIncreaseValue,
    salary_increase_every: person.salaryIncreaseEvery,
    payslip_rv_monthly: person.payslipRvMonthly ?? '',
    payslip_kv_monthly: person.payslipKvMonthly ?? '',
    payslip_zusatz_monthly: person.payslipZusatzMonthly ?? '',
    payslip_zusatz_rate_pct: person.payslipZusatzRatePct ?? '',
    personal_allowance_monthly: person.personalAllowanceMonthly ?? '',
  })));
  write('accounts.csv', ['id', 'owner', 'name', 'type', 'opened_on', 'monthly_contribution', 'contribution_growth_pct', 'contribution_increase_kind', 'contribution_increase_value', 'contribution_increase_every', 'expected_return_pct', 'interest_rate_pct', 'risk', 'notes', 'closed_on', 'treatment', 'income_monthly', 'income_start_age', 'owner_share', 'portion_date', 'portion_self', 'accessible'], data.accounts.map((account) => ({
    id: account.id,
    owner: account.owner,
    name: account.name,
    type: account.type,
    opened_on: account.openedOn ?? '',
    monthly_contribution: account.monthlyContribution,
    contribution_growth_pct: account.contributionGrowthPct,
    contribution_increase_kind: account.contributionIncreaseKind,
    contribution_increase_value: account.contributionIncreaseValue,
    contribution_increase_every: account.contributionIncreaseEvery,
    expected_return_pct: account.expectedReturnPct,
    interest_rate_pct: account.interestRatePct ?? '',
    risk: account.risk,
    notes: account.notes,
    closed_on: account.closedOn ?? '',
    treatment: account.treatment,
    income_monthly: account.incomeMonthly ?? '',
    income_start_age: account.incomeStartAge ?? '',
    owner_share: account.ownerShare,
    portion_date: account.portionDate ?? '',
    portion_self: account.portionSelf ?? '',
    accessible: account.accessible ? 1 : 0,
  })));
  write('balances.csv', ['id', 'account_id', 'date', 'balance', 'contributed', 'note'], data.balances.map((balance) => ({
    id: balance.id,
    account_id: balance.accountId,
    date: balance.date,
    balance: balance.balance,
    contributed: balance.contributed ?? '',
    note: balance.note,
  })));
  write('contribution_periods.csv', ['account_id', 'from_month', 'to_month', 'amount_monthly', 'note'], data.accounts.flatMap((account) => account.contributionHistory.map((period) => ({
    account_id: account.id,
    from_month: period.fromMonth,
    to_month: period.toMonth ?? '',
    amount_monthly: period.amountMonthly,
    note: period.note,
  }))));
  write('incomes.csv', ['id', 'owner', 'name', 'amount_monthly', 'starts_on', 'ends_on', 'into_pot', 'indexed', 'notes'], data.incomes.map((income) => ({
    id: income.id,
    owner: income.owner,
    name: income.name,
    amount_monthly: income.amountMonthly,
    starts_on: income.startsOn ?? '',
    ends_on: income.endsOn ?? '',
    into_pot: income.intoPot ? 1 : 0,
    indexed: income.indexed ? 1 : 0,
    notes: income.notes,
  })));
  write('settings.csv', ['key', 'value'], Object.entries(data.settings).map(([key, value]) => ({
    key,
    value: value == null ? '' : String(value),
  })));
  return files;
}
