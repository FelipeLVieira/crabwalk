import type { Node, Edge } from '@xyflow/react'
import type {
  MonitorSession,
  MonitorAction,
  MonitorExecProcess,
} from '~/integrations/clawdbot'

/** Cast domain data to ReactFlow's Node data type */
function nodeData<T>(data: T): Record<string, unknown> {
  return data as Record<string, unknown>
}

export interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL'
  nodeWidth?: number
  nodeHeight?: number
  rankSep?: number
  nodeSep?: number
}

// Node sizing configuration - sized generously for layout calculations
const NODE_DIMENSIONS = {
  session: { width: 280, height: 140 },  // Wider for session cards
  exec: { width: 300, height: 120 },     // Exec processes need room
  action: { width: 220, height: 100 },   // Chat events with padding
  crab: { width: 64, height: 64 },
}

// Layout constants - generous spacing for clarity
const COLUMN_GAP = 400        // Horizontal gap between session columns
const ROW_GAP = 80            // Vertical gap between items in a column
const SPAWN_OFFSET = 60       // Extra Y offset when spawning to right
const CRAB_OFFSET = { x: -120, y: -100 }
const MIN_SESSION_GAP = 120   // Minimum vertical gap between sessions in same column

interface SessionColumn {
  sessionKey: string
  columnIndex: number
  spawnY: number  // Y position where this session was spawned from parent
  items: Array<{
    nodeId: string
    type: 'session' | 'action' | 'exec'
    timestamp: number
    data: unknown
  }>
}

interface NodeBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Check if two node bounding boxes overlap (with padding)
 */
function checkCollision(a: NodeBounds, b: NodeBounds, padding = 0): boolean {
  return !(
    a.x + a.width + padding < b.x ||
    b.x + b.width + padding < a.x ||
    a.y + a.height + padding < b.y ||
    b.y + b.height + padding < a.y
  )
}

/**
 * Check if a position would cause collision with existing nodes
 */
function hasCollision(
  x: number,
  y: number,
  dims: { width: number; height: number },
  existingNodes: Array<{ x: number; y: number; dims: { width: number; height: number } }>,
  padding = 0
): boolean {
  const candidate = { x, y, width: dims.width, height: dims.height }
  return existingNodes.some(node => 
    checkCollision(candidate, { x: node.x, y: node.y, width: node.dims.width, height: node.dims.height }, padding)
  )
}

/**
 * Radial layout algorithm:
 * - Central crab at the origin (0, 0)
 * - Sessions distributed in a circle around the crab
 * - Events within a session flow radially outward from center
 * - Child sessions nest near their parent session
 */
export function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  _options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  // Build session hierarchy and columns
  const sessions = nodes
    .filter((n) => n.type === 'session')
    .map((n) => n.data as unknown as MonitorSession)

  const actions = nodes
    .filter((n) => n.type === 'action')
    .map((n) => ({ id: n.id.replace('action-', ''), data: n.data as unknown as MonitorAction }))

  const execs = nodes
    .filter((n) => n.type === 'exec')
    .map((n) => ({ id: n.id.replace('exec-', ''), data: n.data as unknown as MonitorExecProcess }))

  const crabNode = nodes.find((n) => n.type === 'crab')

  // Radial layout constants - increased for better spacing
  const BASE_RADIUS = 500 // Distance from crab for main sessions
  const CHILD_OFFSET = 350 // Offset for child sessions from their parent
  const RADIAL_SPACING = 160 // Space between items radiating outward
  const MIN_SIBLING_ANGLE = 0.4 // ~23° minimum angle between siblings (radians)
  const COLLISION_PADDING = 40 // Extra padding for collision detection

  // Build session hierarchy - organize sessions by their depth
  const sessionDepth = new Map<string, number>()
  const getSessionDepth = (sessionKey: string, visited = new Set<string>()): number => {
    if (visited.has(sessionKey)) return 0
    visited.add(sessionKey)

    const session = sessions.find((s) => s.key === sessionKey)
    if (!session) return 0

    if (session.spawnedBy) {
      return getSessionDepth(session.spawnedBy, visited) + 1
    }
    return 0
  }

  // Assign depth to all sessions
  for (const session of sessions) {
    const depth = getSessionDepth(session.key)
    sessionDepth.set(session.key, depth)
  }

  // Group sessions by depth level
  const sessionsByDepth = new Map<number, MonitorSession[]>()
  for (const session of sessions) {
    const depth = sessionDepth.get(session.key) ?? 0
    const group = sessionsByDepth.get(depth) ?? []
    group.push(session)
    sessionsByDepth.set(depth, group)
  }

  // Build session items map (session node + actions + execs)
  const sessionItems = new Map<string, SessionColumn>()
  for (const session of sessions) {
    sessionItems.set(session.key, {
      sessionKey: session.key,
      columnIndex: sessionDepth.get(session.key) ?? 0,
      spawnY: 0,
      items: [],
    })
  }

  // Group actions by session and sort by timestamp
  const actionsBySession = new Map<string, typeof actions>()
  for (const action of actions) {
    const sessionKey = action.data.sessionKey
    if (!sessionKey) continue
    const list = actionsBySession.get(sessionKey) ?? []
    list.push(action)
    actionsBySession.set(sessionKey, list)
  }
  for (const [key, list] of actionsBySession) {
    list.sort((a, b) => a.data.timestamp - b.data.timestamp)
    actionsBySession.set(key, list)
  }

  // Group execs by session
  const execsBySession = new Map<string, typeof execs>()
  for (const exec of execs) {
    const sessionKey = exec.data.sessionKey
    if (!sessionKey) continue
    const list = execsBySession.get(sessionKey) ?? []
    list.push(exec)
    execsBySession.set(sessionKey, list)
  }
  for (const [key, list] of execsBySession) {
    list.sort((a, b) => a.data.startedAt - b.data.startedAt)
    execsBySession.set(key, list)
  }

  // Build items list for each session (session node + actions + execs)
  for (const session of sessions) {
    const items = sessionItems.get(session.key)
    if (!items) continue

    // Add session node itself
    items.items.push({
      nodeId: `session-${session.key}`,
      type: 'session',
      timestamp: session.lastActivityAt ?? 0,
      data: session,
    })

    // Add actions
    const sessionActions = actionsBySession.get(session.key) ?? []
    for (const action of sessionActions) {
      items.items.push({
        nodeId: `action-${action.id}`,
        type: 'action',
        timestamp: action.data.timestamp,
        data: action.data,
      })
    }

    // Add execs
    const sessionExecs = execsBySession.get(session.key) ?? []
    for (const exec of sessionExecs) {
      items.items.push({
        nodeId: `exec-${exec.id}`,
        type: 'exec',
        timestamp: exec.data.startedAt,
        data: exec.data,
      })
    }

    // Sort all items by timestamp (session node first since it's the start)
    items.items.sort((a, b) => {
      if (a.type === 'session') return -1
      if (b.type === 'session') return 1
      return a.timestamp - b.timestamp
    })
  }

  // Position all nodes using radial layout
  const positionedNodes: Node[] = []
  const positionedNodeIds = new Set<string>()

  // Position crab node at the center
  if (crabNode) {
    positionedNodes.push({
      ...crabNode,
      position: { x: 0, y: 0 },
    })
    positionedNodeIds.add(crabNode.id)
  }

  // Track session positions for child placement
  const sessionPositions = new Map<string, { x: number; y: number; angle: number }>()

  // Track positioned nodes for collision detection
  const positionedNodeBounds: Array<{ x: number; y: number; dims: { width: number; height: number } }> = []

  // Position root sessions (depth 0) in a circle around the crab
  const rootSessions = sessionsByDepth.get(0) ?? []
  const angleStep = (2 * Math.PI) / Math.max(rootSessions.length, 1)
  
  for (let i = 0; i < rootSessions.length; i++) {
    const session = rootSessions[i]!
    const angle = i * angleStep - Math.PI / 2 // Start from top, go clockwise
    const baseX = Math.cos(angle) * BASE_RADIUS
    const baseY = Math.sin(angle) * BASE_RADIUS
    
    sessionPositions.set(session.key, { x: baseX, y: baseY, angle })
    
    // Position all items in this session, radiating outward
    const items = sessionItems.get(session.key)
    if (!items) continue
    
    let currentRadius = 0
    for (const item of items.items) {
      const dims = NODE_DIMENSIONS[item.type]
      
      // Position along the radial direction from center
      let itemX = baseX + Math.cos(angle) * currentRadius
      let itemY = baseY + Math.sin(angle) * currentRadius
      
      // Collision avoidance: if this position overlaps, increase radius slightly
      let radiusAdjustment = 0
      while (hasCollision(itemX, itemY, dims, positionedNodeBounds, COLLISION_PADDING) && radiusAdjustment < 500) {
        radiusAdjustment += 30
        const adjustedRadius = currentRadius + radiusAdjustment
        itemX = baseX + Math.cos(angle) * adjustedRadius
        itemY = baseY + Math.sin(angle) * adjustedRadius
      }
      
      positionedNodes.push({
        id: item.nodeId,
        type: item.type,
        position: { x: itemX, y: itemY },
        data: nodeData(item.data),
      })
      positionedNodeIds.add(item.nodeId)
      positionedNodeBounds.push({ x: itemX, y: itemY, dims })
      
      currentRadius += dims.height + RADIAL_SPACING + radiusAdjustment
    }
  }

  // Position child sessions near their parent
  for (let depth = 1; depth <= Math.max(...sessionDepth.values()); depth++) {
    const sessionsAtDepth = sessionsByDepth.get(depth) ?? []
    
    for (const session of sessionsAtDepth) {
      const parent = sessions.find(s => s.key === session.spawnedBy)
      if (!parent) continue
      
      const parentPos = sessionPositions.get(parent.key)
      if (!parentPos) continue
      
      // Find siblings (other children of the same parent)
      const siblings = sessionsAtDepth.filter(s => s.spawnedBy === parent.key)
      const siblingIndex = siblings.indexOf(session)
      const siblingCount = siblings.length
      
      // Spread children around the parent's radial direction
      // Ensure minimum angular separation between siblings
      const minAngularSpread = MIN_SIBLING_ANGLE * siblingCount
      const angularSpread = Math.max(Math.PI / 3, minAngularSpread) // At least 60° or calculated minimum
      const siblingAngleOffset = siblingCount > 1 
        ? (siblingIndex - (siblingCount - 1) / 2) * (angularSpread / siblingCount)
        : 0
      
      let childAngle = parentPos.angle + siblingAngleOffset
      let childX = parentPos.x + Math.cos(childAngle) * CHILD_OFFSET
      let childY = parentPos.y + Math.sin(childAngle) * CHILD_OFFSET
      
      // Collision avoidance for session position
      const sessionDims = NODE_DIMENSIONS.session
      let offsetAdjustment = 0
      while (hasCollision(childX, childY, sessionDims, positionedNodeBounds, COLLISION_PADDING) && offsetAdjustment < 300) {
        offsetAdjustment += 50
        const adjustedOffset = CHILD_OFFSET + offsetAdjustment
        childX = parentPos.x + Math.cos(childAngle) * adjustedOffset
        childY = parentPos.y + Math.sin(childAngle) * adjustedOffset
      }
      
      sessionPositions.set(session.key, { x: childX, y: childY, angle: childAngle })
      
      // Position all items in this child session
      const items = sessionItems.get(session.key)
      if (!items) continue
      
      let currentRadius = 0
      for (const item of items.items) {
        const dims = NODE_DIMENSIONS[item.type]
        
        let itemX = childX + Math.cos(childAngle) * currentRadius
        let itemY = childY + Math.sin(childAngle) * currentRadius
        
        // Collision avoidance: if this position overlaps, increase radius
        let radiusAdjustment = 0
        while (hasCollision(itemX, itemY, dims, positionedNodeBounds, COLLISION_PADDING) && radiusAdjustment < 500) {
          radiusAdjustment += 30
          const adjustedRadius = currentRadius + radiusAdjustment
          itemX = childX + Math.cos(childAngle) * adjustedRadius
          itemY = childY + Math.sin(childAngle) * adjustedRadius
        }
        
        positionedNodes.push({
          id: item.nodeId,
          type: item.type,
          position: { x: itemX, y: itemY },
          data: nodeData(item.data),
        })
        positionedNodeIds.add(item.nodeId)
        positionedNodeBounds.push({ x: itemX, y: itemY, dims })
        
        currentRadius += dims.height + RADIAL_SPACING + radiusAdjustment
      }
    }
  }

  // Handle orphan nodes (actions/execs without a session)
  let orphanAngle = 0
  const orphanRadius = BASE_RADIUS + 300
  for (const node of nodes) {
    if (!positionedNodeIds.has(node.id)) {
      const dims = NODE_DIMENSIONS[node.type as keyof typeof NODE_DIMENSIONS] ?? { width: 180, height: 80 }
      const x = Math.cos(orphanAngle) * orphanRadius
      const y = Math.sin(orphanAngle) * orphanRadius
      positionedNodes.push({
        ...node,
        position: { x, y },
      })
      orphanAngle += Math.PI / 6 // 30 degrees apart
    }
  }

  return { nodes: positionedNodes, edges }
}

// Group nodes by session for better visual organization
export function groupNodesBySession(nodes: Node[]): Map<string, Node[]> {
  const groups = new Map<string, Node[]>()

  for (const node of nodes) {
    const sessionKey = node.data?.sessionKey as string | undefined
    if (sessionKey) {
      const group = groups.get(sessionKey) ?? []
      group.push(node)
      groups.set(sessionKey, group)
    }
  }

  return groups
}
