// Team performance: per-agent response times and the conversations
// still waiting on a reply. Pure functions over rows the dashboard
// loader fetches (see loadTeamPerformance in queries.ts), kept apart so
// the pairing rules can be unit-tested without a database.
//
// Attribution is by the conversation's ASSIGNED agent, not by who sent
// the reply — messages.sender_id is not populated by the send paths,
// so "who answered" isn't recorded. In practice the assignee is the
// person accountable for the thread, which is what a team lead asks
// about anyway.

export interface TeamMessageRow {
  conversation_id: string
  sender_type: string
  created_at: string
}

export interface TeamConversationRow {
  id: string
  status: string
  assigned_agent_id: string | null
  contact_name: string | null
}

export interface TeamAgentRow {
  /** null = conversations nobody is assigned to. */
  agentId: string | null
  name: string | null
  /** Conversations with activity in the window that aren't closed. */
  activeConversations: number
  /** Customer message → reply pairs in the window. */
  responses: number
  avgFirstResponseMinutes: number | null
  /** Conversations whose latest message is from the customer. */
  waiting: number
}

export interface WaitingConversation {
  conversationId: string
  contactName: string | null
  agentName: string | null
  /** Since the first customer message that hasn't been answered. */
  waitingMinutes: number
}

export interface TeamPerformance {
  agents: TeamAgentRow[]
  waitingTotal: number
  /** Longest-waiting first, capped at `maxWaitingListed`. */
  waiting: WaitingConversation[]
}

interface ConversationWalk {
  responseMinutes: number[]
  /** Set while the latest customer message(s) have no reply yet. */
  pendingSince: Date | null
}

/**
 * Walk messages (sorted by conversation, then time) and pair each first
 * unanswered customer message with the next agent/bot message. Same
 * rule as the weekly response-time chart: a customer double-messaging
 * counts once, from their first message.
 */
export function walkConversations(rows: TeamMessageRow[]): Map<string, ConversationWalk> {
  const out = new Map<string, ConversationWalk>()
  for (const row of rows) {
    let walk = out.get(row.conversation_id)
    if (!walk) {
      walk = { responseMinutes: [], pendingSince: null }
      out.set(row.conversation_id, walk)
    }
    const ts = new Date(row.created_at)
    if (row.sender_type === 'customer') {
      if (!walk.pendingSince) walk.pendingSince = ts
    } else if (walk.pendingSince) {
      const diff = (ts.getTime() - walk.pendingSince.getTime()) / 60_000
      if (diff >= 0) walk.responseMinutes.push(diff)
      walk.pendingSince = null
    }
  }
  return out
}

export function computeTeamPerformance(
  messages: TeamMessageRow[],
  conversations: TeamConversationRow[],
  agentNames: Map<string, string | null>,
  now: Date = new Date(),
  maxWaitingListed = 5,
): TeamPerformance {
  const walks = walkConversations(messages)
  const byAgent = new Map<string | null, { minutes: number[]; active: number; waiting: number }>()
  const waiting: WaitingConversation[] = []

  const nameOf = (id: string | null) => (id ? agentNames.get(id) ?? null : null)

  for (const conv of conversations) {
    const walk = walks.get(conv.id)
    if (!walk) continue
    const key = conv.assigned_agent_id ?? null
    let bucket = byAgent.get(key)
    if (!bucket) {
      bucket = { minutes: [], active: 0, waiting: 0 }
      byAgent.set(key, bucket)
    }
    bucket.minutes.push(...walk.responseMinutes)

    if (conv.status === 'closed') continue
    bucket.active += 1
    if (walk.pendingSince) {
      bucket.waiting += 1
      waiting.push({
        conversationId: conv.id,
        contactName: conv.contact_name,
        agentName: nameOf(key),
        waitingMinutes: Math.max(0, (now.getTime() - walk.pendingSince.getTime()) / 60_000),
      })
    }
  }

  const agents: TeamAgentRow[] = [...byAgent.entries()].map(([agentId, b]) => ({
    agentId,
    name: nameOf(agentId),
    activeConversations: b.active,
    responses: b.minutes.length,
    avgFirstResponseMinutes:
      b.minutes.length === 0 ? null : b.minutes.reduce((a, m) => a + m, 0) / b.minutes.length,
    waiting: b.waiting,
  }))
  // Most waiting first; then busiest; unassigned sorts with everyone else.
  agents.sort(
    (a, b) =>
      b.waiting - a.waiting ||
      b.activeConversations - a.activeConversations ||
      (a.name ?? '').localeCompare(b.name ?? ''),
  )

  waiting.sort((a, b) => b.waitingMinutes - a.waitingMinutes)

  return {
    agents,
    waitingTotal: waiting.length,
    waiting: waiting.slice(0, maxWaitingListed),
  }
}
