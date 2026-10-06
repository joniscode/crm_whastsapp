"use client"

import Link from 'next/link'
import { Hourglass, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { TeamPerformance } from '@/lib/dashboard/team'
import { cn } from '@/lib/utils'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface TeamPerformanceProps {
  data: TeamPerformance | null
  loading: boolean
  /** Minutes; a waiting time or average above this is highlighted. */
  thresholdMinutes?: number
}

/**
 * Per-agent table (active / waiting conversations, average first
 * response) plus the longest-waiting conversations, each linking into
 * the inbox. Data from loadTeamPerformance; attribution is by assigned
 * agent (see src/lib/dashboard/team.ts).
 */
export function TeamPerformancePanel({
  data,
  loading,
  thresholdMinutes = 5,
}: TeamPerformanceProps) {
  const t = useTranslations('Dashboard.teamPerformance')

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        {data && data.waitingTotal > 0 && (
          <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 tabular-nums dark:text-amber-300">
            {t('waitingBadge', { count: data.waitingTotal })}
          </span>
        )}
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[200px] w-full" />
        ) : data.agents.length === 0 ? (
          <EmptyState icon={Users} title={t('empty')} hint={t('emptyHint')} />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
            <div className="overflow-x-auto lg:col-span-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">{t('agent')}</th>
                    <th className="pb-2 text-right font-medium">{t('active')}</th>
                    <th className="pb-2 text-right font-medium">{t('waiting')}</th>
                    <th className="pb-2 text-right font-medium">{t('avgFirstResponse')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.agents.map((a) => (
                    <tr key={a.agentId ?? 'unassigned'} className="border-t border-border">
                      <td className="py-2 pr-3 text-foreground">
                        {a.agentId ? a.name ?? t('unknownAgent') : (
                          <span className="italic text-muted-foreground">{t('unassigned')}</span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums">{a.activeConversations}</td>
                      <td
                        className={cn(
                          'py-2 text-right tabular-nums',
                          a.waiting > 0 && 'font-medium text-amber-600 dark:text-amber-300',
                        )}
                      >
                        {a.waiting}
                      </td>
                      <td
                        className={cn(
                          'py-2 text-right tabular-nums',
                          a.avgFirstResponseMinutes != null &&
                            a.avgFirstResponseMinutes > thresholdMinutes &&
                            'text-rose-600 dark:text-rose-300',
                        )}
                      >
                        {fmt(a.avgFirstResponseMinutes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-2">
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">
                {t('longestWaiting')}
              </h3>
              {data.waiting.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t('allAnswered')}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {data.waiting.map((w) => (
                    <li key={w.conversationId}>
                      <Link
                        href={`/inbox?c=${w.conversationId}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">
                            {w.contactName ?? t('unknownContact')}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {w.agentName ?? t('unassigned')}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'flex shrink-0 items-center gap-1 text-xs tabular-nums',
                            w.waitingMinutes > thresholdMinutes
                              ? 'font-medium text-rose-600 dark:text-rose-300'
                              : 'text-muted-foreground',
                          )}
                        >
                          <Hourglass className="h-3 w-3" />
                          {fmt(w.waitingMinutes)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  if (mins < 48 * 60) return `${(mins / 60).toFixed(1)}h`
  return `${Math.round(mins / 1440)}d`
}
