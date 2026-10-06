import { NextResponse } from 'next/server'
import { cronAuthError } from '@/lib/cron-auth'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkChannelHealth, sendHealthAlert } from '@/lib/health/channel-health'

export const maxDuration = 60

/**
 * GET /api/health/whatsapp — scheduled WhatsApp channel health check.
 *
 * Checks every connected number (token valid, quality rating, WABA
 * subscribed to the app) and that the automations cron is draining.
 * Problems are logged with console.error (so Sentry picks them up when
 * configured) and posted to HEALTH_ALERT_WEBHOOK_URL if set.
 *
 * Protected by the cron secret (see `cronAuthError`); scheduled from
 * vercel.json. Responds 200 when healthy, 503 with the report when not,
 * so uptime monitors can watch the status code alone.
 */
export async function GET(request: Request) {
  const denied = cronAuthError(request)
  if (denied) return denied

  const report = await checkChannelHealth(supabaseAdmin())

  if (!report.ok) {
    console.error('[health] WhatsApp channel problems:', JSON.stringify(report.problems))
    await sendHealthAlert(report)
  }

  return NextResponse.json(report, { status: report.ok ? 200 : 503 })
}
