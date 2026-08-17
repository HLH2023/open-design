export const OPEN_DESIGN_TELEMETRY_RELAY_URLS = {
  test: '[telemetry-free: removed]',
  prod: '[telemetry-free: removed]',
} as const;

const LEGACY_TEST_RELAY_ORIGIN = '[telemetry-free: removed]';
const TEST_RELAY_ORIGIN = '[telemetry-free: removed]';

/**
 * Keep legacy test configurations working while moving the test Worker to its
 * environment-owned hostname. Production and custom relay URLs are unchanged.
 */
export function normalizeOpenDesignTelemetryRelayUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized.startsWith(`${LEGACY_TEST_RELAY_ORIGIN}/`) ||
    normalized === LEGACY_TEST_RELAY_ORIGIN
    ? `${TEST_RELAY_ORIGIN}${normalized.slice(LEGACY_TEST_RELAY_ORIGIN.length)}`
    : normalized;
}
