import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addBalance,
  addBalances,
  createAccount,
  createIncome,
  deleteIncome,
  deleteAccount,
  exportFinanceCsv,
  FinanceError,
  loadFinance,
  openDb,
  updateAccount,
  updateIncome,
  updatePerson,
  updateSettings,
} from '../src/api/db';

const dirs: string[] = [];

function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'finance-'));
  dirs.push(dir);
  return openDb(join(dir, 'finance.sqlite'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('finance database', () => {
  it('seeds two people and the July 2026 pension figures', () => {
    const db = fresh();
    const data = loadFinance(db);
    expect(data.people.map((person) => person.id).sort()).toEqual(['partner', 'self']);
    expect(data.accounts).toEqual([]);
    expect(data.settings.rentenwert).toBe(42.52);
    expect(data.settings.durchschnittsentgeltAnnual).toBe(51944);
    expect(data.settings.retirementScope).toBe('individual');
    db.close();
  });

  it('stores an account, a later balance, and a settings change', () => {
    const db = fresh();
    const created = createAccount(db, {
      owner: 'self',
      name: 'Index ETF',
      type: 'etf',
      monthlyContribution: 500,
      balance: 10000,
      balanceDate: '2026-01-01',
    });
    expect(created.expectedReturnPct).toBe(7);
    expect(created.risk).toBe('medium');
    addBalance(db, { accountId: created.id, date: '2026-06-01', balance: 12500 });
    updateAccount(db, created.id, { monthlyContribution: 550 });
    updatePerson(db, 'self', { birthDate: '1986-01-01', pensionMode: 'stated', pensionStatedMonthly: 1600 });
    updateSettings(db, { inflationPct: 2.5, retirementScope: 'household', spendingPersonalMonthly: null });
    const data = loadFinance(db);
    expect(data.accounts[0].monthlyContribution).toBe(550);
    expect(data.balances.map((row) => row.balance)).toEqual([10000, 12500]);
    expect(data.people.find((person) => person.id === 'self')?.pensionStatedMonthly).toBe(1600);
    expect(data.settings.inflationPct).toBe(2.5);
    expect(data.settings.retirementScope).toBe('household');
    expect(data.settings.spendingPersonalMonthly).toBeNull();
    db.close();
  });

  it('stores a fixed contribution increase and a net salary', () => {
    const db = fresh();
    const created = createAccount(db, {
      owner: 'self',
      name: 'ETF',
      type: 'etf',
      monthlyContribution: 500,
      contributionIncreaseKind: 'amount',
      contributionIncreaseValue: 50,
      contributionIncreaseEvery: 'year',
    });
    expect(created.contributionIncreaseKind).toBe('amount');
    expect(created.contributionIncreaseValue).toBe(50);
    expect(created.contributionIncreaseEvery).toBe('year');
    expect(created.contributionGrowthPct).toBe(0);
    const person = updatePerson(db, 'self', {
      netSalaryMonthly: 3200,
      salaryIncreaseKind: 'percent',
      salaryIncreaseValue: 3,
      salaryIncreaseEvery: 'year',
    });
    expect(person.netSalaryMonthly).toBe(3200);
    expect(person.salaryIncreaseKind).toBe('percent');
    expect(person.salaryIncreaseValue).toBe(3);
    expect(loadFinance(db).people.find((row) => row.id === 'self')?.netSalaryMonthly).toBe(3200);
    const payslip = updatePerson(db, 'self', {
      payslipRvMonthly: 465,
      payslipKvMonthly: 365,
      payslipZusatzMonthly: 62.5,
      payslipZusatzRatePct: 2.5,
    });
    expect(payslip.payslipRvMonthly).toBe(465);
    expect(payslip.payslipZusatzRatePct).toBe(2.5);
    expect(loadFinance(db).settings.contributionCapMonthly).toBe(8450);
    expect(loadFinance(db).settings.pensionTaxKeep).toBe(0.9);
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(9);
    db.close();
  });

  it('copies a version 1 contribution growth into the increase fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'finance-v1-'));
    dirs.push(dir);
    const path = join(dir, 'finance.sqlite');
    const legacy = new Database(path);
    legacy.exec(`
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
        id INTEGER PRIMARY KEY,
        account_id TEXT NOT NULL,
        date TEXT NOT NULL,
        balance REAL NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    legacy.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run('alex', 'Alex');
    legacy.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run('sam', 'Sam');
    legacy.prepare(`INSERT INTO accounts (id, owner, name, type, monthly_contribution, contribution_growth_pct, expected_return_pct)
      VALUES ('a', 'alex', 'Old ETF', 'etf', 100, 4, 7)`).run();
    legacy.prepare(`INSERT INTO accounts (id, owner, name, type) VALUES ('b', 'sam', 'Her ETF', 'etf')`).run();
    legacy.prepare(`INSERT INTO balances (id, account_id, date, balance) VALUES (1, 'a', '2026-01-01', 1000)`).run();
    legacy.pragma('user_version = 1');
    legacy.close();

    const db = openDb(path);
    const data = loadFinance(db);
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(9);
    expect(data.people.map((person) => [person.id, person.name])).toEqual([['self', 'Alex'], ['partner', 'Sam']]);
    expect(data.accounts.map((account) => [account.name, account.owner, account.ownerShare])).toEqual([
      ['Her ETF', 'partner', 0],
      ['Old ETF', 'self', 1],
    ]);
    expect(data.balances).toEqual([{ id: 1, accountId: 'a', date: '2026-01-01', balance: 1000, contributed: null, note: '' }]);
    data.accounts.sort((a, b) => a.id.localeCompare(b.id));
    expect(data.accounts[0].contributionIncreaseKind).toBe('percent');
    expect(data.accounts[0].contributionIncreaseEvery).toBe('year');
    expect(data.accounts[0].contributionIncreaseValue).toBe(4);
    expect(data.accounts[0].ownerShare).toBe(1);
    expect(data.people.find((person) => person.id === 'self')?.netSalaryMonthly).toBeNull();
    db.close();
  });

  it('rejects a blank name and removes balances with the account', () => {
    const db = fresh();
    expect(() => createAccount(db, { owner: 'self', name: '  ', type: 'cash' })).toThrow(FinanceError);
    const created = createAccount(db, { owner: 'joint', name: 'Cash', type: 'cash', balance: 20 });
    expect(created.ownerShare).toBe(0.5);
    const shared = updateAccount(db, created.id, { ownerShare: 0.69 });
    expect(shared.ownerShare).toBe(0.69);
    expect(loadFinance(db).accounts.find((row) => row.id === created.id)?.ownerShare).toBe(0.69);
    const mine = createAccount(db, { owner: 'self', name: 'Pension', type: 'private_pension', ownerShare: 0.2 });
    expect(mine.ownerShare).toBe(1);
    deleteAccount(db, created.id);
    deleteAccount(db, mine.id);
    expect(loadFinance(db).balances).toEqual([]);
    db.close();
  });

  it('rejects bad rows written with plain SQL', () => {
    const db = fresh();
    const insert = (owner: string, share: number, type = 'etf') => db.prepare(
      `INSERT INTO accounts (id, owner, name, type, owner_share) VALUES (?, ?, 'x', ?, ?)`,
    ).run(crypto.randomUUID(), owner, type, share);
    expect(() => insert('alex', 1)).toThrow(/CHECK/);
    expect(() => insert('joint', 1.5)).toThrow(/CHECK/);
    expect(() => insert('joint', 0.5, 'bitcoin')).toThrow(/CHECK/);
    expect(() => db.prepare(`INSERT INTO balances (account_id, date, balance) VALUES ('missing', '2026-01-01', 1)`).run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare(`UPDATE people SET birth_date = '13/10/1986' WHERE id = 'self'`).run()).toThrow(/CHECK/);
    insert('joint', 0.5);
    expect(loadFinance(db).accounts).toHaveLength(1);
    db.close();
  });

  it('saves a check-in for several accounts in one go, with money paid in', () => {
    const db = fresh();
    const a = createAccount(db, { owner: 'self', name: 'A', type: 'etf', balance: 100, balanceDate: '2026-01-01' });
    const b = createAccount(db, { owner: 'joint', name: 'B', type: 'savings', balance: 200, balanceDate: '2026-01-01' });
    addBalances(db, [
      { accountId: a.id, date: '2026-02-01', balance: 160, contributed: 50, note: 'bonus' },
      { accountId: b.id, date: '2026-02-01', balance: 210 },
    ]);
    const rows = loadFinance(db).balances.filter((row) => row.date === '2026-02-01');
    expect(rows.map((row) => [row.balance, row.contributed, row.note])).toEqual([[160, 50, 'bonus'], [210, null, '']]);
    expect(() => addBalances(db, [
      { accountId: a.id, date: '2026-03-01', balance: 1 },
      { accountId: 'missing', date: '2026-03-01', balance: 1 },
    ])).toThrow(FinanceError);
    expect(loadFinance(db).balances.some((row) => row.date === '2026-03-01')).toBe(false);
    db.close();
  });

  it('stores the household setup', () => {
    const db = fresh();
    expect(loadFinance(db).settings.onboarded).toBe(false);
    updateSettings(db, { onboarded: true, householdMode: 'joint', rentMonthly: 2343, sharedSpendMonthly: 1800, sharedCostShare: null });
    updatePerson(db, 'self', { name: 'Alex', netSalaryMonthly: 6300, personalAllowanceMonthly: 1200 });
    const data = loadFinance(db);
    expect(data.settings).toMatchObject({ onboarded: true, householdMode: 'joint', rentMonthly: 2343, sharedSpendMonthly: 1800, sharedCostShare: null });
    expect(data.people[0]).toMatchObject({ id: 'self', name: 'Alex', personalAllowanceMonthly: 1200 });
    expect(() => updateSettings(db, { sharedCostShare: 2 })).toThrow(FinanceError);
    db.close();
  });

  it('marks pension policies as not accessible by default, and lets you change it', () => {
    const db = fresh();
    const pension = createAccount(db, { owner: 'self', name: 'Pension', type: 'private_pension' });
    const etf = createAccount(db, { owner: 'self', name: 'ETF', type: 'etf' });
    expect([pension.accessible, etf.accessible]).toEqual([false, true]);
    expect(updateAccount(db, pension.id, { accessible: true }).accessible).toBe(true);
    expect(updateAccount(db, pension.id, { notes: 'x' }).accessible).toBe(true);
    expect(() => db.prepare(`UPDATE accounts SET accessible = 2 WHERE id = ?`).run(etf.id)).toThrow(/CHECK/);
    db.close();
  });

  it('stores a contribution history and rejects overlapping periods', () => {
    const db = fresh();
    const etf = createAccount(db, { owner: 'self', name: 'ETF', type: 'etf', contributionHistory: [
      { fromMonth: '2021-10', toMonth: null, amountMonthly: 500, note: '' },
      { fromMonth: '2019-08', toMonth: '2021-09', amountMonthly: 250, note: 'start' },
    ] });
    expect(loadFinance(db).accounts[0].contributionHistory.map((p) => [p.fromMonth, p.toMonth, p.amountMonthly])).toEqual([
      ['2019-08', '2021-09', 250],
      ['2021-10', null, 500],
    ]);
    updateAccount(db, etf.id, { notes: 'kept' });
    expect(loadFinance(db).accounts[0].contributionHistory).toHaveLength(2);
    expect(() => updateAccount(db, etf.id, { contributionHistory: [
      { fromMonth: '2019-08', toMonth: null, amountMonthly: 250, note: '' },
      { fromMonth: '2021-10', toMonth: null, amountMonthly: 500, note: '' },
    ] })).toThrow(FinanceError);
    expect(() => updateAccount(db, etf.id, { contributionHistory: [{ fromMonth: '2021-13', toMonth: null, amountMonthly: 1, note: '' }] })).toThrow(FinanceError);
    updateAccount(db, etf.id, { contributionHistory: [] });
    expect(loadFinance(db).accounts[0].contributionHistory).toEqual([]);
    deleteAccount(db, etf.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM contribution_periods').get()).toEqual({ n: 0 });
    db.close();
  });

  it('stores your portion of a joint account, and only for joint accounts', () => {
    const db = fresh();
    const etf = createAccount(db, { owner: 'joint', name: 'ETF', type: 'etf', portionDate: '2022-03-01', portionSelf: 12000 });
    expect(etf).toMatchObject({ portionDate: '2022-03-01', portionSelf: 12000, ownerShare: 0.5 });
    expect(() => updateAccount(db, etf.id, { portionSelf: null })).toThrow(FinanceError);
    const mine = updateAccount(db, etf.id, { owner: 'self' });
    expect(mine).toMatchObject({ portionDate: null, portionSelf: null });
    db.close();
  });

  it('stores other incomes such as Kindergeld, and rejects bad ones', () => {
    const db = fresh();
    const kid = createIncome(db, { owner: 'joint', name: 'Kindergeld', amountMonthly: 255, endsOn: '2041-05-01' });
    expect(kid).toMatchObject({ intoPot: true, indexed: true, startsOn: null });
    updateIncome(db, kid.id, { amountMonthly: 259 });
    expect(loadFinance(db).incomes).toEqual([{ ...kid, amountMonthly: 259 }]);
    expect(() => createIncome(db, { owner: 'joint', name: 'x', amountMonthly: 1, startsOn: '2030-01-01', endsOn: '2029-01-01' })).toThrow(FinanceError);
    expect(() => db.prepare(`INSERT INTO incomes (id, owner, name, amount_monthly) VALUES ('z', 'joint', 'x', -5)`).run()).toThrow(/CHECK/);
    deleteIncome(db, kid.id);
    expect(loadFinance(db).incomes).toEqual([]);
    db.close();
  });

  it('writes a CSV backup of every table', () => {
    const db = fresh();
    const dir = join(tmpdir(), `finance-export-${Date.now()}`);
    dirs.push(dir);
    createAccount(db, { owner: 'self', name: 'Savings', type: 'savings', balance: 5, balanceDate: '2026-02-01' });
    const files = exportFinanceCsv(db, dir);
    expect(files).toEqual(['people.csv', 'accounts.csv', 'balances.csv', 'contribution_periods.csv', 'incomes.csv', 'settings.csv']);
    expect(readFileSync(join(dir, 'accounts.csv'), 'utf8')).toContain('Savings');
    db.close();
  });
});
