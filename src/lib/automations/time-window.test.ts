import { describe, expect, it } from 'vitest'
import { isWithinTimeWindow, parseWeekdays } from './time-window'

// 2026-05-18 is a Monday. 14:30 UTC = 09:30 in Bogotá (UTC-5, no DST).
const MON_1430_UTC = new Date('2026-05-18T14:30:00Z')
// 2026-05-23 is a Saturday.
const SAT_1500_UTC = new Date('2026-05-23T15:00:00Z')

describe('isWithinTimeWindow', () => {
  it('reads the clock in the given timezone, not the server one', () => {
    expect(isWithinTimeWindow(MON_1430_UTC, '09:00-18:00', '', 'America/Bogota')).toBe(true)
    expect(isWithinTimeWindow(MON_1430_UTC, '10:00-18:00', '', 'America/Bogota')).toBe(false)
    expect(isWithinTimeWindow(MON_1430_UTC, '14:00-15:00', '', 'UTC')).toBe(true)
  })

  it('treats the end of the window as exclusive', () => {
    const at18 = new Date('2026-05-18T23:00:00Z') // 18:00 Bogotá
    expect(isWithinTimeWindow(at18, '09:00-18:00', '', 'America/Bogota')).toBe(false)
  })

  it('supports windows that wrap over midnight', () => {
    const late = new Date('2026-05-19T03:00:00Z') // 22:00 Bogotá
    const early = new Date('2026-05-18T12:00:00Z') // 07:00 Bogotá
    const noon = new Date('2026-05-18T17:00:00Z') // 12:00 Bogotá
    expect(isWithinTimeWindow(late, '18:00-09:00', '', 'America/Bogota')).toBe(true)
    expect(isWithinTimeWindow(early, '18:00-09:00', '', 'America/Bogota')).toBe(true)
    expect(isWithinTimeWindow(noon, '18:00-09:00', '', 'America/Bogota')).toBe(false)
  })

  it('restricts to the listed weekdays, judged in the timezone', () => {
    const weekdays = 'mon,tue,wed,thu,fri'
    expect(isWithinTimeWindow(MON_1430_UTC, '09:00-18:00', weekdays, 'America/Bogota')).toBe(true)
    expect(isWithinTimeWindow(SAT_1500_UTC, '09:00-18:00', weekdays, 'America/Bogota')).toBe(false)
    // 02:00 UTC Tuesday is still Monday 21:00 in Bogotá.
    const monNightBogota = new Date('2026-05-19T02:00:00Z')
    expect(isWithinTimeWindow(monNightBogota, '00:00-23:59', 'mon', 'America/Bogota')).toBe(true)
    expect(isWithinTimeWindow(monNightBogota, '00:00-23:59', 'mon', 'UTC')).toBe(false)
  })

  it('falls back to server-local time on a missing or invalid timezone', () => {
    const local = new Date(2026, 4, 18, 10, 0) // Monday 10:00 server-local
    expect(isWithinTimeWindow(local, '09:00-18:00')).toBe(true)
    expect(isWithinTimeWindow(local, '09:00-18:00', 'mon', 'Not/AZone')).toBe(true)
  })

  it('is false for a malformed operand', () => {
    expect(isWithinTimeWindow(MON_1430_UTC, '', '', 'UTC')).toBe(false)
    expect(isWithinTimeWindow(MON_1430_UTC, '09:00', '', 'UTC')).toBe(false)
    expect(isWithinTimeWindow(MON_1430_UTC, undefined, '', 'UTC')).toBe(false)
  })
})

describe('parseWeekdays', () => {
  it('normalises case, whitespace and long names, dropping unknown tokens', () => {
    expect(parseWeekdays(' Mon, TUESDAY ,fri, xyz')).toEqual(['mon', 'tue', 'fri'])
    expect(parseWeekdays('')).toEqual([])
    expect(parseWeekdays(undefined)).toEqual([])
  })
})
