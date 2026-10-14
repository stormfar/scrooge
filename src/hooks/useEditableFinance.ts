import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceData, FinanceSettings, Person } from '../lib/types';

type Mutate = (run: () => Promise<FinanceData>) => Promise<FinanceData>;

/** Edits apply to the returned copy immediately. The database write waits briefly, then flushes on leave. */
export function useEditableFinance(
  data: FinanceData | null,
  mutate: Mutate,
  saveSettings: (patch: Partial<FinanceSettings>) => Promise<FinanceData>,
  savePerson: (id: string, patch: Partial<Person>) => Promise<FinanceData>,
) {
  const [live, setLive] = useState<FinanceData | null>(null);
  const settingsPending = useRef<Partial<FinanceSettings>>({});
  const personPending = useRef<Record<string, Partial<Person>>>({});
  const settingsTimer = useRef<number | null>(null);
  const personTimers = useRef<Record<string, number>>({});
  const mutateRef = useRef(mutate);
  const saveSettingsRef = useRef(saveSettings);
  const savePersonRef = useRef(savePerson);
  mutateRef.current = mutate;
  saveSettingsRef.current = saveSettings;
  savePersonRef.current = savePerson;

  // Follow fresh data from the server unless an edit is still waiting to be written.
  useEffect(() => {
    if (!data) return;
    const pending = Object.keys(settingsPending.current).length > 0 || Object.keys(personPending.current).length > 0;
    setLive((current) => (current && pending ? current : data));
  }, [data]);

  const flushSettings = useCallback(() => {
    const body = settingsPending.current;
    settingsPending.current = {};
    if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
    settingsTimer.current = null;
    if (Object.keys(body).length === 0) return;
    void mutateRef.current(() => saveSettingsRef.current(body)).catch(() => {});
  }, []);

  const flushPerson = useCallback((id: string) => {
    const body = personPending.current[id];
    delete personPending.current[id];
    if (personTimers.current[id]) window.clearTimeout(personTimers.current[id]);
    delete personTimers.current[id];
    if (!body || Object.keys(body).length === 0) return;
    void mutateRef.current(() => savePersonRef.current(id, body)).catch(() => {});
  }, []);

  useEffect(() => () => {
    flushSettings();
    for (const id of Object.keys(personPending.current)) flushPerson(id);
  }, [flushPerson, flushSettings]);

  const patchSettings = useCallback((patch: Partial<FinanceSettings>, immediate = false) => {
    setLive((current) => {
      const base = current ?? data;
      if (!base) return current;
      return { ...base, settings: { ...base.settings, ...patch } };
    });
    settingsPending.current = { ...settingsPending.current, ...patch };
    if (immediate) {
      flushSettings();
      return;
    }
    if (settingsTimer.current) window.clearTimeout(settingsTimer.current);
    settingsTimer.current = window.setTimeout(flushSettings, 450);
  }, [data, flushSettings]);

  const patchPerson = useCallback((id: string, patch: Partial<Person>, immediate = false) => {
    setLive((current) => {
      const base = current ?? data;
      if (!base) return current;
      return {
        ...base,
        people: base.people.map((person) => (person.id === id ? { ...person, ...patch } : person)),
      };
    });
    personPending.current[id] = { ...personPending.current[id], ...patch };
    if (immediate) {
      flushPerson(id);
      return;
    }
    if (personTimers.current[id]) window.clearTimeout(personTimers.current[id]);
    personTimers.current[id] = window.setTimeout(() => flushPerson(id), 450);
  }, [data, flushPerson]);

  return { finance: live ?? data, patchSettings, patchPerson };
}
