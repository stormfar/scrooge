import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUPS_KEPT, SCHEMA_VERSION, backupDb, createAccount, listBackups, loadFinance, openDb, updateAccount } from '../src/api/db';
import { isSameOrigin } from '../src/api/vitePlugin';

const dirs: string[] = [];
function dir() {
  const d = mkdtempSync(join(tmpdir(), 'scrooge-safety-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe('backups', () => {
  it('copies the database before upgrading it, and keeps the data', () => {
    const d = dir();
    const path = join(d, 'scrooge.sqlite');
    const db = openDb(path, { now: at('2026-11-01') });
    createAccount(db, { owner: 'self', name: 'Old ETF', type: 'etf', balance: 1000 });
    // Pretend this database was made before version 10.
    db.exec('ALTER TABLE accounts DROP COLUMN unlock_age; ALTER TABLE accounts DROP COLUMN cost_basis; ALTER TABLE accounts DROP COLUMN withdrawal_tax_pct;');
    db.pragma('user_version = 9');
    db.close();

    const upgraded = openDb(path, { now: at('2026-11-02') });
    expect(Number(upgraded.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
    expect(loadFinance(upgraded).accounts[0]).toMatchObject({ name: 'Old ETF', unlockAge: null, costBasis: null, withdrawalTaxPct: null });
    expect(listBackups(join(d, 'backups')).some((f) => f.includes(`before-v${SCHEMA_VERSION}`))).toBe(true);
    upgraded.close();
  });

  it('backs up once a day and keeps the newest copies', () => {
    const d = dir();
    const path = join(d, 'scrooge.sqlite');
    openDb(path, { now: at('2026-11-01') }).close();
    expect(listBackups(join(d, 'backups'))).toHaveLength(0);
    openDb(path, { now: at('2026-11-02') }).close();
    openDb(path, { now: at('2026-11-02') }).close();
    expect(listBackups(join(d, 'backups'))).toHaveLength(1);
    const db = openDb(path, { now: at('2026-11-03') });
    for (let i = 0; i < BACKUPS_KEPT + 3; i++) backupDb(db, join(d, 'backups'), 'manual', new Date(Date.UTC(2026, 11, 1, 0, 0, i)));
    expect(readdirSync(join(d, 'backups'))).toHaveLength(BACKUPS_KEPT);
    db.close();
  });

  it('refuses a database from a newer version', () => {
    const path = join(dir(), 'scrooge.sqlite');
    const db = openDb(path);
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    expect(() => openDb(path)).toThrow(/newer version/);
  });
});

describe('retirement fields on accounts', () => {
  it('stores an unlock age, what was paid in and a tax override, and checks them', () => {
    const db = openDb(join(dir(), 'scrooge.sqlite'));
    const bav = createAccount(db, { owner: 'self', name: 'bAV', type: 'bav', balance: 20000, unlockAge: 63, costBasis: 15000, withdrawalTaxPct: 30 });
    expect(bav).toMatchObject({ accessible: false, unlockAge: 63, costBasis: 15000, withdrawalTaxPct: 30 });
    expect(() => updateAccount(db, bav.id, { unlockAge: 12 })).toThrow(/Available from age/);
    expect(() => updateAccount(db, bav.id, { withdrawalTaxPct: 120 })).toThrow(/Tax on withdrawals/);
    expect(updateAccount(db, bav.id, { unlockAge: null })).toMatchObject({ unlockAge: null, costBasis: 15000 });
    db.close();
  });
});

describe('isSameOrigin', () => {
  const req = (origin?: string) => ({ headers: { host: 'localhost:5174', ...(origin ? { origin } : {}) } }) as IncomingMessage;
  it('allows the app itself and refuses other sites', () => {
    expect(isSameOrigin(req())).toBe(true);
    expect(isSameOrigin(req('http://localhost:5174'))).toBe(true);
    expect(isSameOrigin(req('https://evil.example'))).toBe(false);
  });
});
