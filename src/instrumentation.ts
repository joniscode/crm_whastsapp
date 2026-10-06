import * as Sentry from '@sentry/nextjs'

/**
 * Server-side error monitoring (Sentry).
 *
 * Off unless `SENTRY_DSN` is set — `Sentry.init` with no DSN is a
 * no-op, so self-hosters who don't want it pay nothing.
 *
 * `captureConsoleIntegration({ levels: ['error'] })` matters here: most
 * failures in this codebase (webhook processing, Meta API calls, cron
 * drains) are caught and `console.error`-ed rather than thrown, so
 * without it Sentry would only ever see the rare uncaught exception.
 *
 * `dataCollection` keeps user info, cookies, headers, query params and
 * request/response bodies (which can carry customer messages and
 * contact data) out of Sentry events.
 */
export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
      },
      integrations: [Sentry.captureConsoleIntegration({ levels: ['error'] })],
    })
  }
}

export const onRequestError = Sentry.captureRequestError
