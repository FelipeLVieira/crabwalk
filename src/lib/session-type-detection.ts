import type { MonitorSession } from '~/integrations/clawdbot'

/**
 * Session type classification for moltbot identification
 */
export type SessionType = 'orchestrator' | 'subagent' | 'cron' | 'standalone'

export interface SessionTypeInfo {
  type: SessionType
  depth: number
  color: string
  badgeText: string
  badgeEmoji: string
}

/**
 * Color scheme for session types (moltbot identification)
 */
export const SESSION_TYPE_COLORS = {
  orchestrator: '#3B82F6', // Blue
  subagent: '#10B981',     // Green
  cron: '#F59E0B',        // Amber
  standalone: '#6366F1',   // Indigo
} as const

/**
 * Calculate session depth from session key by analyzing spawn relationships
 */
export function getSessionDepth(sessionKey: string, allSessions: MonitorSession[]): number {
  const session = allSessions.find(s => s.key === sessionKey)
  if (!session) return 0
  
  let depth = 0
  let current = session
  const visited = new Set<string>()
  
  while (current.spawnedBy) {
    if (visited.has(current.key)) break // Avoid circular references
    visited.add(current.key)
    
    const parent = allSessions.find(s => s.key === current.spawnedBy)
    if (!parent) break
    
    depth++
    current = parent
  }
  
  return depth
}

/**
 * Check if a session has spawned other sessions (is an orchestrator)
 */
export function hasSpawnedSessions(session: MonitorSession, allSessions: MonitorSession[]): boolean {
  return allSessions.some(s => s.spawnedBy === session.key)
}

/**
 * Detect session type based on session key patterns and relationships
 */
export function detectSessionType(session: MonitorSession, allSessions: MonitorSession[]): SessionType {
  const depth = getSessionDepth(session.key, allSessions)
  
  // Cron jobs (scheduled tasks)
  if (session.kind === 'cron' || session.key.includes(':cron:')) {
    return 'cron'
  }
  
  // Subagents (spawned sessions)
  if (session.spawnedBy || session.key.includes(':subagent:')) {
    return 'subagent'
  }
  
  // Orchestrators (main sessions that have spawned others)
  if (depth === 0 && hasSpawnedSessions(session, allSessions)) {
    return 'orchestrator'
  }
  
  // Standalone sessions (depth 0, no children)
  return 'standalone'
}

/**
 * Get complete session type information including color and badge
 */
export function getSessionTypeInfo(session: MonitorSession, allSessions: MonitorSession[]): SessionTypeInfo {
  const type = detectSessionType(session, allSessions)
  const depth = getSessionDepth(session.key, allSessions)
  
  const info: Record<SessionType, Omit<SessionTypeInfo, 'depth'>> = {
    orchestrator: {
      type: 'orchestrator',
      color: SESSION_TYPE_COLORS.orchestrator,
      badgeText: 'Orchestrator',
      badgeEmoji: '🎯',
    },
    subagent: {
      type: 'subagent',
      color: SESSION_TYPE_COLORS.subagent,
      badgeText: `L${depth} Subagent`,
      badgeEmoji: '🤖',
    },
    cron: {
      type: 'cron',
      color: SESSION_TYPE_COLORS.cron,
      badgeText: 'Scheduled',
      badgeEmoji: '⏰',
    },
    standalone: {
      type: 'standalone',
      color: SESSION_TYPE_COLORS.standalone,
      badgeText: 'Standalone',
      badgeEmoji: '🔷',
    },
  }
  
  return {
    ...info[type],
    depth,
  }
}

/**
 * Get color with adjusted lightness for depth-based visual variation
 * Deeper nesting = lighter color
 */
export function getDepthAdjustedColor(baseColor: string, depth: number): string {
  if (depth === 0) return baseColor
  
  // Convert hex to RGB
  const r = parseInt(baseColor.slice(1, 3), 16)
  const g = parseInt(baseColor.slice(3, 5), 16)
  const b = parseInt(baseColor.slice(5, 7), 16)
  
  // Lighten by 10% per depth level (max 40%)
  const lightenFactor = Math.min(depth * 0.1, 0.4)
  const newR = Math.min(255, Math.floor(r + (255 - r) * lightenFactor))
  const newG = Math.min(255, Math.floor(g + (255 - g) * lightenFactor))
  const newB = Math.min(255, Math.floor(b + (255 - b) * lightenFactor))
  
  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`
}
