import * as Sentry from '@sentry/nextjs'

// Browser-side error monitoring. Off unless NEXT_PUBLIC_SENTRY_DSN is
// set at build time (it is inlined into the client bundle). See
// src/instrumentation.ts for the server side.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0),
    // Customer messages and contact data must not leave for Sentry.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    },
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
