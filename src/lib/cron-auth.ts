import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

/**
 * Shared auth gate for the scheduled endpoints (`/api/automations/cron`,
 * `/api/flows/cron`).
 *
 * Two ways to present the secret, so the same deploy works with any
 * scheduler:
 *   - `x-cron-secret: <secret>` — external pingers, GitHub Actions,
 *     the Docker sidecar.
 *   - `Authorization: Bearer <secret>` — what Vercel Cron sends,
 *     carrying the project's `CRON_SECRET` env var.
 *
 * Accepted secrets are `AUTOMATION_CRON_SECRET` and `CRON_SECRET`
 * (either or both). With neither configured the endpoint answers 503
 * so a forgotten env var fails loudly instead of running open.
 *
 * Returns `null` when the caller is authorised, otherwise the response
 * to send back.
 */
export function cronAuthError(request: Request): NextResponse | null {
  const expected = [process.env.AUTOMATION_CRON_SECRET, process.env.CRON_SECRET]
    .map((s) => s?.trim())
    .filter((s): s is string => !!s)
  if (expected.length === 0) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }

  const auth = request.headers.get('authorization') ?? ''
  const supplied = [
    request.headers.get('x-cron-secret') ?? '',
    auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '',
  ].filter(Boolean)

  const ok = supplied.some((s) => expected.some((e) => safeEqual(s, e)))
  return ok ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}

// Constant-time compare so an attacker who can hit the endpoint can't
// recover the secret byte-by-byte from response-time deltas. The length
// pre-check is required by timingSafeEqual (throws otherwise) and leaks
// only the length itself, which isn't sensitive.
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf)
}
