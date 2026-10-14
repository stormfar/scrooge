import type { AccountWrite, BalanceWrite, FinanceData, FinanceSettings, IncomeWrite, Person } from './types';

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* response was not JSON */
  }
  return text || res.statusText;
}

async function send(url: string, method: string, body?: unknown): Promise<FinanceData> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}

export const fetchData = () => send('/api/data', 'GET');
export const createAccount = (account: AccountWrite) => send('/api/accounts', 'POST', account);
export const updateAccount = (id: string, patch: Partial<AccountWrite>) => send(`/api/accounts/${encodeURIComponent(id)}`, 'PUT', patch);
export const deleteAccount = (id: string) => send(`/api/accounts/${encodeURIComponent(id)}`, 'DELETE');
export const addBalance = (balance: BalanceWrite) => send('/api/balances', 'POST', balance);
export const addBalances = (balances: BalanceWrite[]) => send('/api/balances/batch', 'POST', { balances });
export const deleteBalance = (id: number) => send(`/api/balances/${id}`, 'DELETE');
export const updatePerson = (id: string, patch: Partial<Person>) => send(`/api/people/${encodeURIComponent(id)}`, 'PUT', patch);
export const createIncome = (income: Partial<IncomeWrite>) => send('/api/incomes', 'POST', income);
export const updateIncome = (id: string, patch: Partial<IncomeWrite>) => send(`/api/incomes/${encodeURIComponent(id)}`, 'PUT', patch);
export const deleteIncome = (id: string) => send(`/api/incomes/${encodeURIComponent(id)}`, 'DELETE');
export const updateSettings = (patch: Partial<FinanceSettings>) => send('/api/settings', 'PUT', patch);

export async function exportCsv(): Promise<{ directory: string; files: string[] }> {
  const res = await fetch('/api/export');
  if (!res.ok) throw new Error(await readError(res));
  return res.json();
}
