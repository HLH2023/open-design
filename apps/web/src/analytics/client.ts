// PostHog browser client wrapper. Lazy-loads posthog-js only after the
// daemon /api/analytics/config response confirms a key is present, so dev
// builds and forks impose zero runtime cost. All entry points are
// fire-and-forget: capture failures must never propagate to product code.

import type { PostHog } from 'posthog-js';
import {
  EVENT_SCHEMA_VERSION,
  type AnalyticsClientType,
  type AnalyticsConfigResponse,
  type AnalyticsConfigureGlobals,
} from '@open-design/contracts/analytics';
import { scrubBeforeSend } from './scrub';
import {
  clearExceptionTrackingContext,
  setExceptionTrackingContext,
} from './error-tracking';
import { pinFirstSessionForCapture } from './identity';
import { coalescedGet } from '../lib/coalesced-get';

interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  locale: string;
  appVersion: string;
  // Whether this is the install's first analytics session (see
  // identity.ts#isFirstSession). Optional so callers that don't care
  // (error tracking) can omit it.
  isFirstSession?: boolean;
}

let client: PostHog | null = null;
let initPromise: Promise<PostHog | null> | null = null;
let resolvedDeviceId: string | null = null;
// Latest configure-state triplet. Re-registered on the PostHog client as
// soon as it changes so every subsequent event inherits the current values.
let configureGlobals: AnalyticsConfigureGlobals = {
  has_available_configure_cli: false,
  configure_type: 'unknown',
  configure_availability: 'unknown',
  runtime_type: 'none',
  cli_runnable: false,
  byok_runnable: false,
  amr_runnable: false,
};
// Snapshot of the super-property payload sent on the most recent `loaded()`
// init. `reset()` clears posthog-js's persisted super-properties as well as
// the distinct_id, so privacy → metrics off → on, or a Delete-my-data
// rotation (applyIdentity()), would otherwise resume capture without
// `event_schema_version`, `device_id`, `session_id`, `locale`, or the
// configure-state globals. We restash this on init and re-register it
// after every reset()/identify() so every subsequent event keeps the
// current schema contract.
let lastRegisterPayload: Record<string, unknown> | null = null;

// Returns the installationId the daemon stamped on /api/analytics/config
// after the user opted in via Privacy → "Share". The provider
// uses this in preference to its locally-generated UUID so PostHog,
// Langfuse, and any future sink share a single anonymous identity.
//
// Kept under the legacy name for callers that still import it; new code
// should prefer `getResolvedDeviceId`.
export function getResolvedAnonymousId(): string | null {
  return resolvedDeviceId;
}

export function getResolvedDeviceId(): string | null {
  return resolvedDeviceId;
}

// Web-side accessor for the daemon header bridge: when the web client POSTs
// to /api/runs the daemon needs to know what device_id to stamp on its
// own server-side captures.
export function getConfigureGlobals(): AnalyticsConfigureGlobals {
  return configureGlobals;
}

// Called from the AnalyticsProvider when the configure-state triplet changes
// (mode switch, BYOK key save, CLI rescan). The values are registered on the
// PostHog client so every subsequent capture inherits them — no per-event
// boilerplate needed.
export function setConfigureGlobals(next: AnalyticsConfigureGlobals): void {
  configureGlobals = { ...next };
  // Keep the cached register payload aligned so a future reset/identify
  // flow that calls `restoreSuperProperties()` uses the LATEST configure
  // state, not the stale snapshot captured during the initial `loaded()`.
  if (lastRegisterPayload) {
    lastRegisterPayload = {
      ...lastRegisterPayload,
      ...(configureGlobals as unknown as Record<string, unknown>),
    };
  }
  if (!client) return;
  try {
    client.register(configureGlobals as unknown as Record<string, unknown>);
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// AMR account id, registered as the `user_id` public param once sign-in
// state is known. This is the only cross-project join key between the main
// app's PostHog project and the AMR project (whose events carry the same
// id as `app_user_id`), so it must survive reset()/identify() flows the
// same way the configure globals do.
let registeredUserId: string | null = null;
let pendingPersonProperties: Record<string, unknown> | null = null;

// Called from the AnalyticsProvider when the AMR login status resolves
// (boot fetch or a login/logout mid-session). Passing null unregisters the
// param so events after a logout stop carrying a stale account id.
export function setAnalyticsUserId(userId: string | null): void {
  if (registeredUserId === userId) return;
  registeredUserId = userId;
  if (lastRegisterPayload) {
    if (userId) {
      lastRegisterPayload = { ...lastRegisterPayload, user_id: userId };
    } else {
      const { user_id: _dropped, ...rest } = lastRegisterPayload;
      lastRegisterPayload = rest;
    }
  }
  if (!client) return;
  try {
    if (userId) {
      client.register({ user_id: userId });
    } else {
      client.unregister('user_id');
    }
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

export function setAnalyticsPersonProperties(
  properties: Record<string, unknown>,
): void {
  const compacted = compactPersonProperties(properties);
  if (!compacted) return;
  pendingPersonProperties = {
    ...(pendingPersonProperties ?? {}),
    ...compacted,
  };
  flushPersonProperties();
}

function flushPersonProperties(): void {
  if (!client || !pendingPersonProperties) return;
  try {
    const properties = pendingPersonProperties;
    const posthog = client as unknown as {
      setPersonProperties?: (props: Record<string, unknown>) => void;
      people?: { set?: (props: Record<string, unknown>) => void };
      capture?: (event: string, props: Record<string, unknown>) => void;
    };
    if (typeof posthog.setPersonProperties === 'function') {
      posthog.setPersonProperties(properties);
      pendingPersonProperties = null;
      return;
    }
    if (typeof posthog.people?.set === 'function') {
      posthog.people.set(properties);
      pendingPersonProperties = null;
      return;
    }
    posthog.capture?.('$set', { $set: properties });
    pendingPersonProperties = null;
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// Fetches `/api/analytics/config` once and wires up the exception-tracking
// module's context — independent of consent state. The error tracker
// installs its `window.error` / `unhandledrejection` listeners at module
// load (see `error-tracking.ts`), but cannot dispatch buffered events
// until it has the PostHog `phc_` key + host + distinct_id. This bootstrap
// step provides those.
//
// Runs in parallel with — and unrelated to — `getAnalyticsClient` above.
// When the user has consented, both paths fetch the same endpoint once
// each; the duplicate fetch is cheap and avoids cross-coupling the
// (consent-gated) analytics init with the (always-on) error tracker.

// Both the always-on exception tracker and the consent-gated analytics init
// read /api/analytics/config at boot; share one request per burst instead of
// issuing two identical GETs (Batch A §4.3). `null` mirrors the endpoint's
// non-ok answer; network failures propagate to each caller's own handler.
function fetchAnalyticsConfigShared(): Promise<AnalyticsConfigResponse | null> {
  // ttl 0: share only genuinely concurrent readers. A later sequential call
  // (e.g. re-init right after the user grants consent) must observe the
  // just-flipped daemon answer, not a sub-second-old disabled snapshot.
  return coalescedGet(
    'analytics-config',
    async () => {
      const res = await fetch('/api/analytics/config');
      if (!res.ok) return null;
      return (await res.json()) as AnalyticsConfigResponse;
    },
    0,
  );
}

let exceptionBootstrapPromise: Promise<void> | null = null;
export function bootstrapExceptionTracking(context: AnalyticsContext): Promise<void> {
  return Promise.resolve();
}

export async function getAnalyticsClient(
  context: AnalyticsContext,
): Promise<PostHog | null> {
  return null;
}

// Called from the AnalyticsProvider when the user toggles Privacy →
// metrics off so events stop flowing immediately, before the next
// reload re-reads /api/analytics/config. The posthog-js client persists
// its opt-out flag in localStorage; subsequent capture() calls become
// no-ops until the user opts back in.
//
// `opt_out_capturing()` is a global gate — it halts not only explicit
// capture() calls but also autocapture, $pageview, $pageleave,
// $exception, web vitals, and dead clicks. One toggle covers every
// PostHog code path.
//
// On opt-out we ALSO call `posthog.reset()` to clear the persisted
// `ph_*_posthog` localStorage entry. Without this, the SDK keeps the
// old distinct_id; if the user later clicks Delete my data (which
// rotates installationId via the daemon) and toggles metrics back on,
// posthog-js would still think the user is the old id and stitch the
// new session to the deleted identity. reset() prevents that.
export function applyConsent(consentGranted: boolean): void {
  return;
}

// Called from the AnalyticsProvider when `config.installationId` rotates
// (Delete my data). posthog-js's `bootstrap.distinctID` only takes
// effect on first init; once the client is alive, identify() is the
// only way to switch identities. We pair it with reset() first so any
// $device_id stored under the OLD installation is wiped — the new
// session is fully decoupled from the deleted one.
export function applyIdentity(installationId: string | null): void {
  if (!client || !installationId) return;
  if (resolvedDeviceId === installationId) return;
  try {
    client.reset();
    client.identify(installationId);
    resolvedDeviceId = installationId;
    // reset() also clears the persisted super-properties from
    // posthog-js's localStorage cache. Re-register them with the new
    // distinct_id so the rest of this session keeps emitting v2-schema
    // events. See PR #2285 review 2026-05-20 04:35.
    restoreSuperProperties({ device_id: installationId });
  } catch {
    // best-effort — never propagate.
  }
}

// Push the cached super-property payload back onto the PostHog client. Used
// after reset()/identify() flows; takes an optional override patch so the
// caller can swap fields (e.g. a rotated device_id) without re-deriving the
// rest of the payload.
function restoreSuperProperties(patch?: Record<string, unknown>): void {
  if (!client || !lastRegisterPayload) return;
  const next = patch ? { ...lastRegisterPayload, ...patch } : lastRegisterPayload;
  lastRegisterPayload = next;
  try {
    client.register(next);
    flushPersonProperties();
  } catch {
    // best-effort.
  }
}

function compactPersonProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!key || value == null) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || trimmed === 'unknown') continue;
      out[key] = trimmed;
      continue;
    }
    if (Array.isArray(value)) {
      const list = value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry && entry !== 'unknown');
      if (list.length > 0) out[key] = list;
      continue;
    }
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function capture(
  client: PostHog | null,
  args: {
    event: string;
    properties: Record<string, unknown>;
    insertId: string;
    requestId?: string | null;
  },
): void {
  if (!client) return;
  try {
    client.capture(args.event, {
      ...args.properties,
      event_id: args.insertId,
      // PostHog's official dedup key. The daemon mirrors result events with
      // the same $insert_id so duplicates from the dual-side capture pattern
      // get coalesced server-side.
      $insert_id: args.insertId,
      ...(args.requestId ? { request_id: args.requestId } : {}),
    });
  } catch {
    // Swallow — analytics failures must not propagate.
  }
}
