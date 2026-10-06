import { afterEach, describe, expect, it, vi } from 'vitest'
import { cronAuthError } from './cron-auth'

function req(headers: Record<string, string> = {}) {
  return new Request('https://crm.example.com/api/automations/cron', { headers })
}

describe('cronAuthError', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('answers 503 when no secret is configured', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
    expect(cronAuthError(req({ 'x-cron-secret': 'anything' }))?.status).toBe(503)
  })

  it('accepts the x-cron-secret header', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 's3cret')
    vi.stubEnv('CRON_SECRET', '')
    expect(cronAuthError(req({ 'x-cron-secret': 's3cret' }))).toBeNull()
  })

  it('accepts the Bearer token Vercel Cron sends', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')
    vi.stubEnv('CRON_SECRET', 'vercel-secret')
    expect(cronAuthError(req({ authorization: 'Bearer vercel-secret' }))).toBeNull()
  })

  it('accepts either configured secret in either header', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 'one')
    vi.stubEnv('CRON_SECRET', 'two')
    expect(cronAuthError(req({ authorization: 'Bearer one' }))).toBeNull()
    expect(cronAuthError(req({ 'x-cron-secret': 'two' }))).toBeNull()
  })

  it('rejects a missing or wrong secret with 401', () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', 's3cret')
    vi.stubEnv('CRON_SECRET', '')
    expect(cronAuthError(req())?.status).toBe(401)
    expect(cronAuthError(req({ 'x-cron-secret': 's3cre' }))?.status).toBe(401)
    expect(cronAuthError(req({ authorization: 's3cret' }))?.status).toBe(401)
    expect(cronAuthError(req({ authorization: 'Bearer nope' }))?.status).toBe(401)
  })
})
