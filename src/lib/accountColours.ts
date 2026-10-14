import type { AvailableChartColorsKeys } from './chartColors';

/**
 * One colour per account, used by every chart, so an account looks the same on every page.
 * No reds, pinks or greens: those belong to the spending and income lines.
 */
export const ACCOUNT_COLOURS: AvailableChartColorsKeys[] = ['blue', 'amber', 'cyan', 'indigo', 'violet', 'sky', 'gray'];

/** The account's colour from its place in the account list (sorted by name). An account not in the list yet gets the next free one. */
export function accountColour(accounts: { id: string }[], id: string): AvailableChartColorsKeys {
  const index = accounts.findIndex((account) => account.id === id);
  return ACCOUNT_COLOURS[(index < 0 ? accounts.length : index) % ACCOUNT_COLOURS.length];
}
