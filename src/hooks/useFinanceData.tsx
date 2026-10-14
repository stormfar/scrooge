import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FinanceData } from '../lib/types';
import { fetchData } from '../lib/api';

interface FinanceState {
  data: FinanceData | null;
  loading: boolean;
  error: string | null;
  saving: boolean;
  reload: () => Promise<void>;
  mutate: (run: () => Promise<FinanceData>) => Promise<FinanceData>;
}

const FinanceContext = createContext<FinanceState | null>(null);

/** One copy of the database for every page. It reloads when the window regains focus, so edits made with SQL show up. */
export function FinanceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchData();
      if (inFlight.current === 0) setData(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const onFocus = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [reload]);

  const mutate = useCallback(async (run: () => Promise<FinanceData>) => {
    inFlight.current += 1;
    setSaving(true);
    setError(null);
    try {
      const next = await run();
      setData(next);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      inFlight.current -= 1;
      setSaving(inFlight.current > 0);
    }
  }, []);

  const value = useMemo(() => ({ data, loading, error, saving, reload, mutate }), [data, loading, error, saving, reload, mutate]);
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinanceData(): FinanceState {
  const state = useContext(FinanceContext);
  if (!state) throw new Error('useFinanceData needs a FinanceProvider');
  return state;
}
