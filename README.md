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
