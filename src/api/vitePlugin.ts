import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addBalance,
  addBalances,
  createAccount,
  createIncome,
  deleteAccount,
  deleteBalance,
  deleteIncome,
  exportFinanceCsv,
  FinanceError,
  loadFinance,
  openDb,
  updateAccount,
  updateIncome,
  updatePerson,
  updateSettings,
} from './db';
import type { AccountWrite, BalanceWrite, FinanceSettings, IncomeWrite, Person } from '../lib/types';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const DATA_DIR = join(ROOT, 'data');

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

let database: ReturnType<typeof openDb> | null = null;

function db(): ReturnType<typeof openDb> {
  // SCROOGE_DB points the app at another file, for trying things without touching the real one.
  if (!database) database = openDb(process.env.SCROOGE_DB || join(DATA_DIR, 'scrooge.sqlite'));
  return database;
}

export function createApiMiddleware(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url?.startsWith('/api/')) return next();
    const { pathname } = new URL(req.url, 'http://localhost');
    const accountMatch = pathname.match(/^\/api\/accounts\/([^/]+)$/);
    const balanceMatch = pathname.match(/^\/api\/balances\/(\d+)$/);
    const personMatch = pathname.match(/^\/api\/people\/([^/]+)$/);
    const incomeMatch = pathname.match(/^\/api\/incomes\/([^/]+)$/);
    const ok = () => json(res, 200, loadFinance(db()));

    try {
      if (pathname === '/api/data' && req.method === 'GET') return ok();

      if (pathname === '/api/export' && req.method === 'GET') {
        const files = exportFinanceCsv(db(), join(DATA_DIR, 'export'));
        return json(res, 200, { directory: 'data/export', files });
      }

      if (pathname === '/api/accounts' && req.method === 'POST') {
        createAccount(db(), await readJson<AccountWrite>(req));
        return ok();
      }
      if (accountMatch && req.method === 'PUT') {
        updateAccount(db(), decodeURIComponent(accountMatch[1]), await readJson<Partial<AccountWrite>>(req));
        return ok();
      }
      if (accountMatch && req.method === 'DELETE') {
        deleteAccount(db(), decodeURIComponent(accountMatch[1]));
        return ok();
      }

      if (pathname === '/api/balances' && req.method === 'POST') {
        addBalance(db(), await readJson<BalanceWrite>(req));
        return ok();
      }
      if (pathname === '/api/balances/batch' && req.method === 'POST') {
        const body = await readJson<{ balances: BalanceWrite[] }>(req);
        addBalances(db(), body.balances);
        return ok();
      }
      if (balanceMatch && req.method === 'DELETE') {
        deleteBalance(db(), Number(balanceMatch[1]));
        return ok();
      }

      if (pathname === '/api/incomes' && req.method === 'POST') {
        createIncome(db(), await readJson<Partial<IncomeWrite>>(req));
        return ok();
      }
      if (incomeMatch && req.method === 'PUT') {
        updateIncome(db(), decodeURIComponent(incomeMatch[1]), await readJson<Partial<IncomeWrite>>(req));
        return ok();
      }
      if (incomeMatch && req.method === 'DELETE') {
        deleteIncome(db(), decodeURIComponent(incomeMatch[1]));
        return ok();
      }

      if (personMatch && req.method === 'PUT') {
        updatePerson(db(), decodeURIComponent(personMatch[1]), await readJson<Partial<Person>>(req));
        return ok();
      }

      if (pathname === '/api/settings' && req.method === 'PUT') {
        updateSettings(db(), await readJson<Partial<FinanceSettings>>(req));
        return ok();
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof FinanceError) return json(res, err.status, { error: err.message });
      const message = err instanceof Error ? err.message : String(err);
      const constraint = /CHECK constraint failed|FOREIGN KEY constraint failed/.test(message);
      return json(res, constraint ? 400 : 500, { error: message });
    }
  };
}

export function apiPlugin() {
  const middleware = createApiMiddleware();
  return {
    name: 'scrooge-api',
    configureServer(server: { middlewares: { use: (fn: Connect.NextHandleFunction) => void } }) {
      server.middlewares.use(middleware);
    },
  };
}
