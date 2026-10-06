import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => {
    if (v === 'broken') throw new Error('bad key')
    return `plain-${v}`
  }),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  verifyPhoneNumber: vi.fn(),
  getSubscribedApps: vi.fn(),
}))

import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { checkChannelHealth, sendHealthAlert, type HealthReport } from './channel-health'

const verify = vi.mocked(verifyPhoneNumber)
const subscribed = vi.mocked(getSubscribedApps)

const CONFIG = {
  account_id: 'acct-1',
  phone_number_id: 'pn-1',
  waba_id: 'waba-1',
  access_token: 'tok',
  status: 'connected',
}

/** Minimal fake of the two query shapes the check uses. */
function fakeAdmin({
  configs = [CONFIG] as unknown[],
  overdue = 0,
}: { configs?: unknown[]; overdue?: number } = {}) {
  return {
    from(table: string) {
      if (table === 'whatsapp_config') {
        return { select: () => ({ eq: async () => ({ data: configs, error: null }) }) }
      }
      return {
        select: () => ({
          eq: () => ({ lt: async () => ({ count: overdue, error: null }) }),
        }),
      }
    },
  } as unknown as SupabaseClient
}

describe('checkChannelHealth', () => {
  beforeEach(() => {
    verify.mockResolvedValue({ id: 'pn-1', display_phone_number: '+57 300', quality_rating: 'GREEN' })
    subscribed.mockResolvedValue([{ whatsapp_business_api_data: { id: 'app' } }] as never)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('reports ok when token, quality, subscription and cron are fine', async () => {
    const report = await checkChannelHealth(fakeAdmin())
    expect(report).toMatchObject({ ok: true, numbersChecked: 1, problems: [] })
    expect(verify).toHaveBeenCalledWith({ phoneNumberId: 'pn-1', accessToken: 'plain-tok' })
  })

  it('flags an invalid token as critical and skips further Meta calls', async () => {
    verify.mockRejectedValue(new Error('Error validating access token'))
    const report = await checkChannelHealth(fakeAdmin())
    expect(report.ok).toBe(false)
    expect(report.problems).toEqual([
      expect.objectContaining({ code: 'token_invalid', severity: 'critical', phoneNumberId: 'pn-1' }),
    ])
    expect(subscribed).not.toHaveBeenCalled()
  })

  it('flags an undecryptable token', async () => {
    const report = await checkChannelHealth(fakeAdmin({ configs: [{ ...CONFIG, access_token: 'broken' }] }))
    expect(report.problems.map((p) => p.code)).toEqual(['token_undecryptable'])
  })

  it('maps quality ratings to severities', async () => {
    verify.mockResolvedValue({ id: 'pn-1', display_phone_number: '+57 300', quality_rating: 'RED' })
    expect((await checkChannelHealth(fakeAdmin())).problems[0]).toMatchObject({
      code: 'quality_red',
      severity: 'critical',
    })
    verify.mockResolvedValue({ id: 'pn-1', display_phone_number: '+57 300', quality_rating: 'YELLOW' })
    expect((await checkChannelHealth(fakeAdmin())).problems[0]).toMatchObject({
      code: 'quality_yellow',
      severity: 'warning',
    })
  })

  it('flags a WABA with no subscribed app', async () => {
    subscribed.mockResolvedValue([])
    const report = await checkChannelHealth(fakeAdmin())
    expect(report.problems.map((p) => p.code)).toEqual(['waba_unsubscribed'])
  })

  it('flags a stalled automations cron', async () => {
    const report = await checkChannelHealth(fakeAdmin({ overdue: 3 }))
    expect(report.problems).toEqual([
      expect.objectContaining({ code: 'cron_stalled', severity: 'critical' }),
    ])
  })
})

describe('sendHealthAlert', () => {
  const failing: HealthReport = {
    ok: false,
    checkedAt: '2026-10-06T00:00:00.000Z',
    numbersChecked: 1,
    problems: [{ severity: 'critical', code: 'token_invalid', message: 'Token expired', phoneNumberId: 'pn-1' }],
  }

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('does nothing without HEALTH_ALERT_WEBHOOK_URL', async () => {
    vi.stubEnv('HEALTH_ALERT_WEBHOOK_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendHealthAlert(failing)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a Slack/Discord-compatible body', async () => {
    vi.stubEnv('HEALTH_ALERT_WEBHOOK_URL', 'https://hooks.example.com/x')
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendHealthAlert(failing)).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.text).toContain('Token expired')
    expect(body.text).toContain('pn-1')
    expect(body.content).toBe(body.text)
    expect(body.report.problems).toHaveLength(1)
  })
})
