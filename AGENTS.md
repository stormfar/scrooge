# AGENTS.md — Scrooge (context for AI agents)

`CLAUDE.md` is a symlink to this file. Read it before changing code or data.

## What this is

A local, offline investments and retirement planner for one person or a couple. It was split out of
`../personal-budget` in October 2026 and has **no link to bank CSVs**: everything lives in
`data/scrooge.sqlite`, entered through the UI or with SQL.

- **Investments** (`/investments`, the default page): accounts, balance snapshots, projections.
  Order: cards → accounts table → filter bar (horizon, scenario, what-ifs; not sticky, never scrolls) → charts.
- **Income** (`/income`): the household pot, other income (Kindergeld and the like), pay and payslip
  per person, retirement income sources, and a lifetime income chart.
- **Retirement** (`/retirement`): when can I stop working? German state pension plus portfolio drawdown.
- **Setup** (`/setup`): just me or joint, names, birthdays, pay, allowances, rent, shared costs.

Stack: Vite 6 + React 19 + TypeScript, Tailwind v4, **shadcn/ui** (Base UI flavour, `components.json`,
primitives in `src/components/ui/`, add more with `npx shadcn@latest add <name>`), **Tremor** charts
(copy-paste source in `src/components/charts/`, built on Recharts 2.15), `better-sqlite3` behind a Vite
middleware (`src/api/vitePlugin.ts`). Port **5174**.

UI rules: use shadcn primitives and the wrappers in `src/components/kit.tsx` (NumberField, InfoTip,
Segmented, SimpleSelect, Stat, ConfirmButton, CheckField, SumList). No hand-written CSS beyond Tailwind
classes. Charts are Tremor (`AreaChart`, `BarChart`, `LineChart`, `ComboChart`); colours come from
`src/lib/chartColors.ts`.

Tremor/Recharts gotchas (already handled; keep them):
- Recharts is pinned to 2.15 (Tremor's target) with `"overrides": { "react-is": "^19" }` for React 19.
- On React 19, passing `yAxisId={undefined}` breaks Recharts ("Could not find yAxis by id 0"). The local
  ComboChart passes `0` instead. Keep that if you update the Tremor source.
- Local additions to the Tremor source: `dashedCategories` on LineChart and on ComboChart's `lineSeries`,
  and extra colours (red, slate, sky, teal).
- After changing dependencies, restart the dev server with `--force` so Vite rebuilds its dependency cache.

```
source ~/.nvm/nvm.sh && npm install && npm run dev     # http://localhost:5174
npm test                                               # vitest
npm run build                                          # tsc + vite build
SCROOGE_DB=/path/to/copy.sqlite npm run dev            # try things on a copy
```

## Layout

```
src/api/db.ts            schema, migrations (PRAGMA user_version, now 9), reads and writes
src/api/vitePlugin.ts    /api/* routes; every write returns the whole data set
src/lib/types.ts         shared types and defaults
src/lib/projection.ts    monthly compounding for the Investments charts
src/lib/calibration.ts   plan vs actual from snapshots, realised return
src/lib/flows.ts         monthly payment schedule from the contribution history; return solver
src/lib/portion.ts       who owns how much of a joint balance (unit-style split from a portion date)
src/lib/household.ts     the pot and spending in retirement
src/lib/retirement.ts    the retirement solver (state pension, drawdown, income breakdown)
src/hooks/               FinanceProvider (one copy of the data, refetched on window focus),
                         useEditableFinance (debounced writes), useRetirementPlan (shared plan)
src/pages/               Investments, Income, Retirement, Setup
data/scrooge.sqlite      the live database (gitignored); data/export/*.csv is the readable backup
```

## The money model

- **Joint:** both take-home pays go into one pot. Each person takes a personal allowance (default €1,200).
  The pot pays rent, other shared costs and joint investments. **Personal investments come out of that
  person's allowance**, so what they live on is the allowance minus those contributions.
- **Solo:** rent plus other spending; no pot, no partner.
- **Joint accounts** default to 50/50 (`owner_share` is your fraction). That share always splits new
  contributions. It also splits the balance, unless the account has a **portion date**: a date with a
  balance snapshot on which you know how much was yours (`portion_self`). From there `src/lib/portion.ts`
  solves a steady monthly return for each gap between snapshots, lets both parts earn it, and splits that
  gap's contributions by `owner_share`. Recorded `contributed` values make it exact; blank ones assume the
  monthly contribution. Just me retirement and the Investments cards use that balance share.
- **Retirement spending** (today's euros) has no investment contributions in it, because they stop when work stops.
  Household = rent + shared costs + both living amounts. Just me = your living amount + your share of
  rent and shared costs (`shared_cost_share`, or weighted by take-home pay when that is blank).
  Lifestyle (0.8 / 1 / 1.25) and the four override settings apply on top.
- **Snapshots drive projections.** Every projection starts at an account's newest balance row.
  `contributed` on a row is what was actually paid in since the previous row (negative = taken out);
  null means "as planned". Calibration compares plan with reality and, after 6 months of history,
  *suggests* the realised return. It never changes an account by itself.

## Working with the data in SQL

The database is the source of truth, and SQL is a normal way to use it. Use the `sqlite3` CLI:

```
sqlite3 data/scrooge.sqlite
PRAGMA foreign_keys = ON;   -- off by default in every new sqlite3 session; turn it on before writing
```

The dev server can stay running (WAL mode). The UI reloads when its window regains focus.

### Tables

| Table | Key columns | Notes |
|---|---|---|
| `people` | `id` ∈ `self`, `partner` | Always both rows, even in solo mode. Money columns are € per **month**: `net_salary_monthly`, `gross_salary_monthly`, `personal_allowance_monthly`, `payslip_*`. `birth_date` is `YYYY-MM-DD`. |
| `accounts` | `id` (UUID text) | `owner` ∈ `self`, `partner`, `joint`. `type` ∈ etf, stocks, savings, fixed_term, crypto, bav, riester, private_pension, real_estate, cash, other. `risk` ∈ low, medium, high. `treatment` ∈ portfolio (drawn down), income (pays `income_monthly` from `income_start_age`). `monthly_contribution` ≥ 0. `owner_share` is your fraction: 1 for `self`, 0 for `partner`, 0–1 for `joint` (contributions; also the balance unless a portion is set). `portion_date` + `portion_self` (joint only): on that date, which must have a `balances` row, `portion_self` euros of the balance were yours. `accessible` 1/0: could the money be taken out now without heavy tax or penalties (pension policies start at 0); totalled as "Accessible now" on Investments. `closed_on` set = no more contributions. `contribution_growth_pct` is legacy; the increase lives in `contribution_increase_kind/value/every`. |
| `balances` | `(account_id, date)` unique | One snapshot per account per date. A check-in is several rows with the same date. `contributed` is null or the real money in or out since the previous row. |
| `contribution_periods` | `id` | Past contributions per account: `account_id`, `from_month` / `to_month` (`YYYY-MM`, inclusive; null `to_month` = still going), `amount_monthly`. Once an account has any, months outside them count as paused (€0). Payments land on the day of the month the account was opened. Used for "versus plan", realised return and the joint split; projections still use `accounts.monthly_contribution`. No overlaps (checked by the app, not SQL). |
| `incomes` | `id` (UUID text) | Other income such as Kindergeld. `owner` ∈ self, partner, joint. `amount_monthly` ≥ 0 in today's euros. `starts_on` / `ends_on` are `YYYY-MM-DD` or null (null start = already paid, null end = never stops; end is the first month it is *not* paid). `into_pot` 1/0 (joint mode: paid into the shared pot). `indexed` 1/0 (rises with inflation). Counts against spending only after work stops; in Just me a joint income counts half. |
| `settings` | `key` → `value` (text) | Numbers as text; blank = null. Household keys: `onboarded` ('1' or ''), `household_mode` (solo, joint), `rent_monthly`, `shared_spend_monthly`, `shared_cost_share` (0–1 or ''). Retirement keys: `inflation_pct`, `horizon_age`, `lifestyle`, `retirement_scope` (individual, household), `rentenwert`, … |

CHECK constraints reject unknown owners, types, risks, out-of-range shares, negative contributions,
badly formatted dates, and (with foreign keys on) snapshots for missing accounts.

### Ready-made queries

```sql
-- Latest balance per account
SELECT a.name, a.owner, b.date, b.balance
FROM accounts a JOIN balances b ON b.account_id = a.id
WHERE b.date = (SELECT MAX(date) FROM balances WHERE account_id = a.id)
ORDER BY b.balance DESC;

-- Totals by owner, splitting joint accounts by owner_share
WITH latest AS (
  SELECT a.*, b.balance FROM accounts a JOIN balances b ON b.account_id = a.id
  WHERE b.date = (SELECT MAX(date) FROM balances WHERE account_id = a.id)
)
SELECT SUM(balance * owner_share) AS yours, SUM(balance * (1 - owner_share)) AS partners,
       SUM(CASE WHEN closed_on IS NULL THEN monthly_contribution ELSE 0 END) AS paid_in_per_month
FROM latest;

-- Snapshot history for one account, with the change between snapshots
SELECT date, balance, contributed,
       balance - LAG(balance) OVER (ORDER BY date) AS change
FROM balances WHERE account_id = (SELECT id FROM accounts WHERE name = 'My ETF')
ORDER BY date;

-- The household pot, monthly
SELECT (SELECT SUM(net_salary_monthly) FROM people) AS pay_in,
       (SELECT SUM(personal_allowance_monthly) FROM people) AS allowances,
       (SELECT value FROM settings WHERE key = 'rent_monthly') AS rent,
       (SELECT value FROM settings WHERE key = 'shared_spend_monthly') AS shared,
       (SELECT SUM(monthly_contribution) FROM accounts WHERE owner = 'joint' AND closed_on IS NULL) AS joint_invest;
```

### Writing

```sql
-- A monthly check-in: one row per account, same date. Upsert so re-running a day replaces it.
BEGIN;
INSERT INTO balances (account_id, date, balance, contributed, note)
VALUES ((SELECT id FROM accounts WHERE name = 'My ETF'), '2026-11-13', 38650, NULL, '')
ON CONFLICT (account_id, date) DO UPDATE SET balance = excluded.balance, contributed = excluded.contributed, note = excluded.note;
COMMIT;

-- A new account. Generate the id; give it a first balance row.
INSERT INTO accounts (id, owner, name, type, monthly_contribution, expected_return_pct, risk, owner_share)
VALUES (lower(hex(randomblob(16))), 'self', 'Trade Republic ETF', 'etf', 200, 7, 'medium', 1);

-- Kindergeld for a child born in May 2026, paid until the month they turn 18
INSERT INTO incomes (id, owner, name, amount_monthly, starts_on, ends_on)
VALUES (lower(hex(randomblob(16))), 'joint', 'Kindergeld', 259, NULL, '2044-05-01');

-- A setting
UPDATE settings SET value = '2400' WHERE key = 'rent_monthly';
```

Rules for writes: wrap several changes in a transaction; keep `owner_share` at 1 for `self` and 0 for
`partner`; never delete `people` rows; deleting an account deletes its snapshots (with foreign keys on).
For anything larger, run `GET /api/export` (or the Export CSV button) first, which writes `data/export/*.csv`.

## Invariants

- `data/scrooge.sqlite` is the source of truth. Don't rebuild it from anything else.
- Schema changes go in a new `migrate()` step in `src/api/db.ts` with a test in `tests/financeDb.test.ts`.
  SQLite cannot add a CHECK with ALTER, so v5 shows how to rebuild a table.
- Retirement and Income must use the same plan (`useRetirementPlan` / `planRequest`).
- Calibration only suggests; it never writes.
- After code changes: `npm test` and `npm run build`.
