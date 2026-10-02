import type { ThemePreference, ThinkingLevel } from './contracts';

const thinkingLevels = new Set<ThinkingLevel>([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const themes = new Set<ThemePreference>(['system', 'light', 'dark']);

export function expectRecord(value: unknown, label = 'payload') {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function expectString(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const min = options.min ?? 1;
  const max = options.max ?? 16_384;
  if (value.length < min || value.length > max) {
    throw new Error(`${label} must contain ${min}-${max} characters`);
  }
  return value;
}

export function expectPath(value: unknown, label = 'path') {
  const path = expectString(value, label, { max: 4096 });
  if (path.includes('\0')) throw new Error(`${label} is invalid`);
  return path;
}

export function expectProvider(value: unknown) {
  const provider = expectString(value, 'provider', { max: 80 });
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(provider)) {
    throw new Error('provider is invalid');
  }
  return provider;
}

export function expectThinkingLevel(value: unknown): ThinkingLevel {
  if (
    typeof value !== 'string' ||
    !thinkingLevels.has(value as ThinkingLevel)
  ) {
    throw new Error('thinking level is invalid');
  }
  return value as ThinkingLevel;
}

export function expectTheme(value: unknown): ThemePreference {
  if (typeof value !== 'string' || !themes.has(value as ThemePreference)) {
    throw new Error('theme is invalid');
  }
  return value as ThemePreference;
}

export function expectBoolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

export function expectSidebarWidth(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('sidebar width must be a number');
  }
  return Math.round(Math.min(420, Math.max(220, value)));
}

export function expectExternalUrl(value: unknown) {
  const raw = expectString(value, 'url', { max: 4096 });
  const url = new URL(raw);
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) {
    throw new Error('Only http, https, and mailto links can be opened');
  }
  return url.toString();
}
