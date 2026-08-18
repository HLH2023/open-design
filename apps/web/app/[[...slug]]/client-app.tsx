'use client';

import dynamic from 'next/dynamic';

import { MatrixLoader } from '../../src/components/MatrixLoader';

// Install browser exception handlers at module-load time, before any other
// client code can throw. The hooks buffer events until AnalyticsProvider
// finishes `bootstrapExceptionTracking()` with the PostHog key, so even
// errors thrown during the dynamic import of `src/App` are captured.

// The product is a fully client-driven SPA — every component reads
// localStorage, window.location, etc. — so we opt out of static-time
// rendering for the entire tree. This keeps `next build --output export`
// from trying to evaluate browser-only code while still emitting a real
// shell HTML the daemon can serve as the SPA fallback.
const App = dynamic(() => import('../../src/App').then((m) => m.App), {
  ssr: false,
  // Keeps the `od-loading-shell` class on the outer node: the white-screen
  // detector filters this whole subtree out by that class when deciding
  // whether the app really mounted (`src/observability/white-screen.ts`).
  loading: () => (
    <div className="od-loading-shell">
      <MatrixLoader />
      <span>Loading Open Design…</span>
    </div>
  ),
});

export function ClientApp() {
  return <App />;
}
