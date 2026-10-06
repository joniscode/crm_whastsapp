/**
 * Evaluation of the automation `time_of_day` condition.
 *
 *   operand  "HH:mm-HH:mm"   window, end exclusive; "18:00-09:00" wraps
 *                            over midnight.
 *   days     "mon,tue,..."   optional; when set, the condition is also
 *                            false on any day not listed. Empty = every day.
 *
 * The clock is read in `timeZone` (an IANA name such as
 * "America/Bogota"). Serverless hosts run in UTC, so without one a
 * "09:00-18:00" business-hours window would be evaluated in UTC — five
 * hours off for Colombia. The engine passes `AUTOMATION_TIMEZONE`; when
 * that is unset (or invalid) the server's local time is used, which is
 * the historical behaviour.
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Weekday = (typeof WEEKDAYS)[number]

interface LocalClock {
  minutes: number
  weekday: Weekday
}

function readClock(now: Date, timeZone?: string): LocalClock {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      }).formatToParts(now)
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
      const weekday = get('weekday').toLowerCase().slice(0, 3) as Weekday
      if (WEEKDAYS.includes(weekday)) {
        return { minutes: Number(get('hour')) * 60 + Number(get('minute')), weekday }
      }
    } catch {
      // Invalid IANA name — fall through to server-local time.
    }
  }
  return { minutes: now.getHours() * 60 + now.getMinutes(), weekday: WEEKDAYS[now.getDay()] }
}

function parseHm(s: string): number {
  const [h, m] = s.trim().split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Parse "mon, Tue,fri" → ['mon','tue','fri']; unknown tokens ignored. */
export function parseWeekdays(days: string | undefined): Weekday[] {
  return (days ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().slice(0, 3))
    .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d))
}

export function isWithinTimeWindow(
  now: Date,
  operand: string | undefined,
  days?: string,
  timeZone?: string,
): boolean {
  const [from, to] = (operand ?? '').split('-')
  if (!from || !to) return false

  const clock = readClock(now, timeZone)
  const allowedDays = parseWeekdays(days)
  if (allowedDays.length > 0 && !allowedDays.includes(clock.weekday)) return false

  const f = parseHm(from)
  const t = parseHm(to)
  const mins = clock.minutes
  return f <= t ? mins >= f && mins < t : mins >= f || mins < t
}
