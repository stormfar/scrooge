# Scrooge

Investments and retirement planning, offline, in one SQLite file.

```bash
npm install
npm run dev     # http://localhost:5174
```

- **Investments**: accounts, monthly check-ins, projections by horizon and scenario, plan vs actual.
- **Income**: the household pot, pay and payslips, where retirement income comes from.
- **Retirement**: the earliest age the money lasts, with the German state pension.
- **Setup**: just me or joint, pay, allowances, rent and shared costs.

Data lives in `data/scrooge.sqlite`. *Export CSV* writes a readable copy to `data/export/`.
See `AGENTS.md` for the schema and SQL recipes.

## Your data

Everything you enter lives in `data/scrooge.sqlite`, which git ignores, so cloning this repo gives you an empty
app that starts with Setup. To back up, keep a copy of the whole `data/` folder somewhere safe. Copy it while the
app is stopped, or make a consistent copy while it runs:

```bash
sqlite3 data/scrooge.sqlite ".backup /path/to/backup/scrooge.sqlite"
```

To restore, put the file back at `data/scrooge.sqlite`. Schema upgrades run on their own when the app starts.

The app also backs up on its own: once a day and before every schema upgrade it copies the database to
`data/backups/` (the newest 30 are kept). To keep those copies somewhere safer, such as a synced folder, start it with
`SCROOGE_BACKUP_DIR=/path/to/folder npm run dev`.

## How the retirement age is worked out

The planner compounds your accounts, inflates spending, applies the German state pension, and then draws the
rest from your accounts. Pension policies can't be touched before they open (62 by default; set "Available from
age" per account), and money taken out is taxed: gains on funds and savings, the whole payout on bAV and Riester,
with the yearly saver's allowance. It also replays the plan over 500 simulated markets and tells you the chance the
money lasts, and the age that gives a 90% chance. Defaults are rough German figures: check them against your own
situation.

## License

MIT
