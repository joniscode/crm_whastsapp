import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/**
 * Scheduled health check for the WhatsApp channel.
 *
 * The failures that hurt most in a WhatsApp CRM are silent: the access
 * token expires, the WABA drops its app subscription, the number's
 * quality rating falls, or the cron that drives automation Wait steps
 * stops firing. Nothing in the UI changes — inbound messages just stop
 * arriving or automations stall. This check looks for each of those
 * across every connected number and reports problems so they can be
 * alerted on (see `sendHealthAlert`).
 *
 * It reuses the same Meta calls as Settings → WhatsApp → "Verify with
 * Meta" (`/api/whatsapp/config/verify-registration`), but runs
 * unattended over all accounts with the service-role client.
 */

export type HealthSeverity = 'critical' | 'warning'

export interface HealthProblem {
  severity: HealthSeverity
  /** Stable machine-readable code, e.g. `token_invalid`. */
  code: string
  message: string
  accountId?: string
  phoneNumberId?: string
}

export interface HealthReport {
  ok: boolean
  checkedAt: string
  numbersChecked: number
  problems: HealthProblem[]
}

/** A pending automation step this far past its run_at means the
 *  automations cron is not running (it is scheduled every 5 min). */
export const CRON_STALL_MS = 15 * 60_000

interface ConfigRow {
  account_id: string
  phone_number_id: string
  waba_id: string | null
  access_token: string
  status: string
}

export async function checkChannelHealth(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<HealthReport> {
  const problems: HealthProblem[] = []

  const { data: configs, error } = await admin
    .from('whatsapp_config')
    .select('account_id, phone_number_id, waba_id, access_token, status')
    .eq('status', 'connected')

  if (error) {
    problems.push({
      severity: 'critical',
      code: 'db_unreachable',
      message: `Could not read whatsapp_config: ${error.message}`,
    })
  }

  const rows = (configs ?? []) as ConfigRow[]
  for (const row of rows) {
    problems.push(...(await checkNumber(row)))
  }

  problems.push(...(await checkCronLiveness(admin, now)))

  return {
    ok: problems.length === 0,
    checkedAt: now.toISOString(),
    numbersChecked: rows.length,
    problems,
  }
}

async function checkNumber(row: ConfigRow): Promise<HealthProblem[]> {
  const where = { accountId: row.account_id, phoneNumberId: row.phone_number_id }
  const problems: HealthProblem[] = []

  let accessToken: string
  try {
    accessToken = decrypt(row.access_token)
  } catch {
    return [
      {
        ...where,
        severity: 'critical',
        code: 'token_undecryptable',
        message:
          'Stored access token cannot be decrypted (ENCRYPTION_KEY changed?). Re-enter the token in Settings → WhatsApp.',
      },
    ]
  }

  try {
    const info = await verifyPhoneNumber({ phoneNumberId: row.phone_number_id, accessToken })
    const quality = info.quality_rating?.toUpperCase()
    if (quality === 'RED') {
      problems.push({
        ...where,
        severity: 'critical',
        code: 'quality_red',
        message: `Number ${info.display_phone_number} has quality rating RED — Meta may restrict or disable sending.`,
      })
    } else if (quality === 'YELLOW') {
      problems.push({
        ...where,
        severity: 'warning',
        code: 'quality_yellow',
        message: `Number ${info.display_phone_number} has quality rating YELLOW.`,
      })
    }
  } catch (err) {
    // The phone lookup is the cheapest call that exercises the token,
    // so a failure here almost always means the token is expired,
    // revoked, or lost its permissions.
    return [
      {
        ...where,
        severity: 'critical',
        code: 'token_invalid',
        message: `Meta rejected the access token or phone number: ${errorText(err)}`,
      },
    ]
  }

  if (!row.waba_id) {
    problems.push({
      ...where,
      severity: 'warning',
      code: 'waba_missing',
      message: 'No WABA ID saved — the webhook subscription cannot be verified.',
    })
  } else {
    try {
      const subs = await getSubscribedApps({ wabaId: row.waba_id, accessToken })
      if (subs.length === 0) {
        problems.push({
          ...where,
          severity: 'critical',
          code: 'waba_unsubscribed',
          message:
            'The WABA has no subscribed app — Meta is not delivering inbound messages. Re-save the WhatsApp settings.',
        })
      }
    } catch (err) {
      problems.push({
        ...where,
        severity: 'warning',
        code: 'waba_check_failed',
        message: `Could not check the WABA subscription: ${errorText(err)}`,
      })
    }
  }

  return problems
}

async function checkCronLiveness(admin: SupabaseClient, now: Date): Promise<HealthProblem[]> {
  const cutoff = new Date(now.getTime() - CRON_STALL_MS).toISOString()
  const { count, error } = await admin
    .from('automation_pending_executions')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .lt('run_at', cutoff)

  if (error) {
    return [
      {
        severity: 'warning',
        code: 'cron_check_failed',
        message: `Could not check pending automation steps: ${error.message}`,
      },
    ]
  }
  if (count && count > 0) {
    return [
      {
        severity: 'critical',
        code: 'cron_stalled',
        message: `${count} automation step(s) are more than ${CRON_STALL_MS / 60_000} min overdue — the automations cron is not running.`,
      },
    ]
  }
  return []
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Post a failing report to `HEALTH_ALERT_WEBHOOK_URL`. The body carries
 * both `text` (Slack, Google Chat, Mattermost) and `content` (Discord)
 * so a plain incoming-webhook URL from any of them works, plus the full
 * `report` for custom receivers (n8n, Zapier, Make…).
 *
 * The URL is operator configuration (an env var), not user input, so
 * it does not go through the SSRF guard used for account webhooks.
 */
export async function sendHealthAlert(report: HealthReport): Promise<boolean> {
  const url = process.env.HEALTH_ALERT_WEBHOOK_URL
  if (!url || report.ok) return false

  const lines = report.problems.map(
    (p) => `${p.severity === 'critical' ? '🔴' : '🟡'} ${p.message}${p.phoneNumberId ? ` (phone_number_id ${p.phoneNumberId})` : ''}`,
  )
  const text = [`WhatsApp CRM health check: ${report.problems.length} problem(s)`, ...lines].join('\n')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, content: text.slice(0, 2000), report }),
    })
    if (!res.ok) {
      console.error('[health] alert webhook returned', res.status)
      return false
    }
    return true
  } catch (err) {
    console.error('[health] alert webhook failed:', err)
    return false
  }
}
