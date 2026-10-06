import { describe, expect, it } from 'vitest'
import { computeTeamPerformance, walkConversations, type TeamMessageRow } from './team'

const msg = (conversation_id: string, sender_type: string, created_at: string): TeamMessageRow => ({
  conversation_id,
  sender_type,
  created_at,
})

const NOW = new Date('2026-05-18T12:00:00Z')

describe('walkConversations', () => {
  it('pairs the first unanswered customer message with the next reply', () => {
    const walks = walkConversations([
      msg('c1', 'customer', '2026-05-18T10:00:00Z'),
      msg('c1', 'customer', '2026-05-18T10:05:00Z'), // double message: counts from the first
      msg('c1', 'agent', '2026-05-18T10:10:00Z'),
      msg('c1', 'customer', '2026-05-18T11:00:00Z'),
      msg('c1', 'bot', '2026-05-18T11:01:00Z'),
    ])
    expect(walks.get('c1')).toEqual({ responseMinutes: [10, 1], pendingSince: null })
  })

  it('leaves pendingSince set when the customer spoke last', () => {
    const walks = walkConversations([
      msg('c1', 'agent', '2026-05-18T09:00:00Z'),
      msg('c1', 'customer', '2026-05-18T11:30:00Z'),
    ])
    expect(walks.get('c1')?.pendingSince?.toISOString()).toBe('2026-05-18T11:30:00.000Z')
    expect(walks.get('c1')?.responseMinutes).toEqual([])
  })
})

describe('computeTeamPerformance', () => {
  const messages = [
    msg('c1', 'customer', '2026-05-18T10:00:00Z'),
    msg('c1', 'agent', '2026-05-18T10:04:00Z'),
    msg('c2', 'customer', '2026-05-18T11:00:00Z'), // waiting 60 min
    msg('c3', 'customer', '2026-05-18T11:50:00Z'), // waiting 10 min, unassigned
    msg('c4', 'customer', '2026-05-18T08:00:00Z'), // closed — not waiting
    msg('c4', 'agent', '2026-05-18T08:20:00Z'),
    msg('c4', 'customer', '2026-05-18T09:00:00Z'),
  ]
  const conversations = [
    { id: 'c1', status: 'open', assigned_agent_id: 'ana', contact_name: 'Cliente 1' },
    { id: 'c2', status: 'open', assigned_agent_id: 'ana', contact_name: 'Cliente 2' },
    { id: 'c3', status: 'pending', assigned_agent_id: null, contact_name: null },
    { id: 'c4', status: 'closed', assigned_agent_id: 'luis', contact_name: 'Cliente 4' },
  ]
  const names = new Map([
    ['ana', 'Ana'],
    ['luis', 'Luis'],
  ])

  it('aggregates per assigned agent', () => {
    const result = computeTeamPerformance(messages, conversations, names, NOW)
    const ana = result.agents.find((a) => a.agentId === 'ana')
    const luis = result.agents.find((a) => a.agentId === 'luis')
    const unassigned = result.agents.find((a) => a.agentId === null)

    expect(ana).toEqual({
      agentId: 'ana',
      name: 'Ana',
      activeConversations: 2,
      responses: 1,
      avgFirstResponseMinutes: 4,
      waiting: 1,
    })
    // Closed conversations still count toward response times, but not
    // toward active / waiting.
    expect(luis).toMatchObject({ activeConversations: 0, responses: 1, avgFirstResponseMinutes: 20, waiting: 0 })
    expect(unassigned).toMatchObject({ name: null, activeConversations: 1, waiting: 1, avgFirstResponseMinutes: null })
  })

  it('lists waiting conversations longest first, with totals and a cap', () => {
    const result = computeTeamPerformance(messages, conversations, names, NOW, 1)
    expect(result.waitingTotal).toBe(2)
    expect(result.waiting).toEqual([
      { conversationId: 'c2', contactName: 'Cliente 2', agentName: 'Ana', waitingMinutes: 60 },
    ])
  })

  it('sorts agents with the most waiting conversations first', () => {
    const result = computeTeamPerformance(messages, conversations, names, NOW)
    expect(result.agents.map((a) => a.agentId)).toEqual(['ana', null, 'luis'])
  })

  it('ignores conversations with no messages in the window', () => {
    const result = computeTeamPerformance([], conversations, names, NOW)
    expect(result).toEqual({ agents: [], waitingTotal: 0, waiting: [] })
  })
})
