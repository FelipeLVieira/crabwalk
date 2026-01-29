# Moltbot Identification Research

## Executive Summary
**Recommendation**: Implement a multi-layered identification system using:
1. Visual color coding (primary indicator)
2. Badge/label system (secondary)
3. Grouping in the graph layout (structural)
4. Filtering controls (user interaction)

## What is a "Moltbot"?

Based on the codebase and context:
- **Moltbot** = Multi-agent orchestrated bot system
- **Pattern**: A main agent that spawns subagents for specific tasks
- **Characteristics**:
  - Session has `spawnedBy` relationship
  - Multiple levels of spawning (depth > 0)
  - Coordinated resource usage (Grok queue, Ollama queue, Claude API)
  - Persistent memory across sessions
  - 24/7 proactive operation

## Current Crabwalk Identification Capabilities

### Already Implemented:
1. **Agent Registry** (`src/lib/agent-registry.ts`)
   - Maps agent session keys to friendly names
   - Supports team labels
   - Identifies cron jobs
   - Model/kind information

2. **Session Hierarchy** (graph-layout.ts)
   - Tracks `spawnedBy` relationships
   - Calculates session depth
   - Groups sessions by depth level
   - Visual nesting via radial offsets

3. **Node Types** (protocol.ts)
   - Session nodes
   - Action nodes (chat events)
   - Exec nodes (shell commands)

### What's Missing:
- **No visual distinction** between main agent and subagent
- **No moltbot-specific indicators**
- **No way to see which sessions are part of the same orchestration**
- **No filtering by orchestration type**

## Proposed Moltbot Identification System

### 1. Visual Color Coding (Primary Indicator)

**Recommendation**: Use color hues to indicate session role in orchestration

```typescript
// Color scheme
const SESSION_COLORS = {
  mainAgent: '#3b82f6',      // Blue - orchestrator
  subagent: '#10b981',       // Green - worker
  cron: '#f59e0b',          // Amber - scheduled
  standalone: '#6366f1',     // Indigo - single agent
  orphan: '#9ca3af',        // Gray - no parent
}

// Depth-based intensity
function getSessionColor(session: MonitorSession): string {
  const depth = getSessionDepth(session.key)
  
  if (session.kind === 'cron') return SESSION_COLORS.cron
  if (depth === 0) return SESSION_COLORS.mainAgent
  if (depth > 0 && session.spawnedBy) {
    // Lighter shades for deeper nesting
    return adjustColorLightness(SESSION_COLORS.subagent, depth * 10)
  }
  return SESSION_COLORS.standalone
}
```

**Visual Example**:
```
[Main Agent (Dark Blue)]
  ├─ [Subagent 1 (Green)]
  ├─ [Subagent 2 (Green)]
  └─ [Subagent 3 (Light Green)]
       └─ [Sub-subagent (Lighter Green)]

[Cron Job (Amber)]

[Standalone Bot (Indigo)]
```

### 2. Badge/Label System (Secondary Indicator)

**Recommendation**: Add visual badges to session nodes

```typescript
// Badge types
interface SessionBadge {
  text: string
  color: string
  icon?: string
}

function getSessionBadges(session: MonitorSession): SessionBadge[] {
  const badges: SessionBadge[] = []
  
  // Orchestrator badge
  if (hasSpawnedSessions(session)) {
    badges.push({
      text: '🎯 Orchestrator',
      color: '#3b82f6',
    })
  }
  
  // Subagent badge
  if (session.spawnedBy) {
    const depth = getSessionDepth(session.key)
    badges.push({
      text: `🤖 L${depth} Subagent`,
      color: '#10b981',
    })
  }
  
  // Cron badge
  if (session.kind === 'cron') {
    badges.push({
      text: '⏰ Scheduled',
      color: '#f59e0b',
    })
  }
  
  // Resource usage badges
  if (usesGrok(session)) {
    badges.push({ text: '🔍 Grok', color: '#8b5cf6' })
  }
  if (usesOllama(session)) {
    badges.push({ text: '🧠 Local LLM', color: '#ec4899' })
  }
  
  return badges
}
```

### 3. Grouping in Graph Layout (Structural Indicator)

**Already implemented** in the radial layout:
- Sessions are positioned by depth
- Children nest near their parent
- Visual clustering of related sessions

**Enhancement**: Add visual "orchestration zones"
```typescript
// Draw background circles for orchestration groups
function getOrchestrationGroups(sessions: MonitorSession[]): Group[] {
  const groups: Group[] = []
  
  // Find all main agents that have spawned sessions
  const mainAgents = sessions.filter(s => hasSpawnedSessions(s))
  
  for (const main of mainAgents) {
    const descendants = getAllDescendants(main, sessions)
    groups.push({
      id: main.key,
      label: getAgentName(main),
      sessionKeys: [main.key, ...descendants.map(d => d.key)],
      color: SESSION_COLORS.mainAgent + '20', // 20% opacity
    })
  }
  
  return groups
}
```

### 4. Filtering Controls (User Interaction)

**Recommendation**: Add UI filters to dashboard

```typescript
// Filter options
interface FilterOptions {
  showMainAgents: boolean
  showSubagents: boolean
  showCronJobs: boolean
  showStandalone: boolean
  orchestrationGroup?: string  // Filter by specific main agent
  minDepth?: number
  maxDepth?: number
}

// Filter sessions
function filterSessions(
  sessions: MonitorSession[],
  filters: FilterOptions
): MonitorSession[] {
  return sessions.filter(session => {
    const depth = getSessionDepth(session.key)
    const isCron = session.kind === 'cron'
    const isMain = depth === 0 && hasSpawnedSessions(session)
    const isSub = depth > 0 && session.spawnedBy
    const isStandalone = depth === 0 && !hasSpawnedSessions(session)
    
    if (isCron && !filters.showCronJobs) return false
    if (isMain && !filters.showMainAgents) return false
    if (isSub && !filters.showSubagents) return false
    if (isStandalone && !filters.showStandalone) return false
    
    if (filters.orchestrationGroup) {
      const ancestors = getAncestors(session)
      if (!ancestors.includes(filters.orchestrationGroup)) return false
    }
    
    if (filters.minDepth !== undefined && depth < filters.minDepth) return false
    if (filters.maxDepth !== undefined && depth > filters.maxDepth) return false
    
    return true
  })
}
```

### 5. Session Metrics (Orchestration Health)

**Additional feature**: Show orchestration-level metrics

```typescript
interface OrchestrationMetrics {
  mainAgent: string
  totalSubagents: number
  activeSubagents: number
  maxDepth: number
  totalActions: number
  totalExecs: number
  resourceUsage: {
    grokCalls: number
    ollamaCalls: number
    claudeCalls: number
  }
  uptime: number
  lastActivity: number
}

function getOrchestrationMetrics(
  mainSession: MonitorSession,
  allSessions: MonitorSession[]
): OrchestrationMetrics {
  const descendants = getAllDescendants(mainSession, allSessions)
  const allActions = getActionsForSessions([mainSession, ...descendants])
  const allExecs = getExecsForSessions([mainSession, ...descendants])
  
  return {
    mainAgent: getAgentName(mainSession),
    totalSubagents: descendants.length,
    activeSubagents: descendants.filter(s => isActive(s)).length,
    maxDepth: Math.max(...descendants.map(s => getSessionDepth(s.key))),
    totalActions: allActions.length,
    totalExecs: allExecs.length,
    resourceUsage: {
      grokCalls: countGrokUsage(allActions),
      ollamaCalls: countOllamaUsage(allActions),
      claudeCalls: countClaudeUsage(allActions),
    },
    uptime: Date.now() - mainSession.createdAt,
    lastActivity: mainSession.lastActivityAt ?? mainSession.createdAt,
  }
}
```

## Implementation Priority

### Phase 1 (Immediate - Low Effort, High Impact)
1. ✅ **Color coding** - Add to SessionNode.tsx (1-2 hours)
2. ✅ **Basic badges** - "Orchestrator", "Subagent L1", "Cron" (1 hour)
3. ✅ **Legend** - Add color/badge legend to UI (30 min)

### Phase 2 (Short-term - Medium Effort)
4. **Filter controls** - Checkboxes for session types (2 hours)
5. **Orchestration grouping** - Visual zones around related sessions (2-3 hours)
6. **Session detail panel** - Click session to see orchestration info (1-2 hours)

### Phase 3 (Long-term - Higher Effort)
7. **Metrics dashboard** - Orchestration-level analytics (4-6 hours)
8. **Timeline view** - Show spawning sequence over time (4-6 hours)
9. **Resource usage graphs** - Grok/Ollama/Claude usage per orchestration (3-4 hours)

## Alternative Dashboard Solutions

### Comparison with Other Tools

**1. Grafana** (Time-series visualization)
- ✅ Excellent for metrics over time
- ✅ Pre-built panels and queries
- ❌ Not designed for graph/network visualization
- ❌ Overkill for session hierarchy display
- **Verdict**: Good for metrics phase, not for graph layout

**2. Neo4j Browser** (Graph database UI)
- ✅ Built for graph relationships
- ✅ Powerful query language (Cypher)
- ❌ Requires Neo4j database (architectural change)
- ❌ Not real-time streaming friendly
- **Verdict**: Interesting for complex analysis, too heavy for live dashboard

**3. D3.js Force-Directed Graph**
- ✅ Beautiful, physics-based layouts
- ✅ Highly customizable
- ✅ Built for web (like React Flow)
- ❌ Complex to implement
- ❌ Performance issues with many nodes
- **Verdict**: Could replace radial layout, but current approach is good

**4. Current React Flow Setup**
- ✅ Already integrated
- ✅ Good performance
- ✅ Easy to customize
- ✅ Supports our custom radial layout
- **Verdict**: ✅ **RECOMMENDED - Keep and enhance**

### Upstream Crabwalk Community

**Checked**: Original Crabwalk repository
- **Status**: Community is small, mostly internal use
- **Features**: Basic session monitoring, no orchestration-specific features
- **Best practices**: Not documented for multi-agent systems

**Conclusion**: We're pioneering the "moltbot dashboard" use case. Felipe's fork is ahead in this domain.

## Code Locations for Implementation

### Files to Modify:

1. **src/components/monitor/SessionNode.tsx**
   - Add color coding logic
   - Add badge rendering
   - Component is already rendering session cards

2. **src/lib/graph-layout.ts**
   - Helper functions for depth calculation (already exists)
   - Add orchestration grouping logic
   - Background zone rendering (optional)

3. **src/components/monitor/ActionGraph.tsx**
   - Add filter controls UI
   - Add legend component
   - Wire filtering to graph rendering

4. **src/integrations/clawdbot/protocol.ts**
   - Add orchestration-related types
   - SessionBadge, OrchestrationMetrics interfaces

5. **src/lib/agent-registry.ts** (already exists)
   - Enhance with orchestration detection
   - Add helper functions for descendants, ancestors

## Sample Implementation Snippets

### Color Coding (SessionNode.tsx)

```typescript
// In SessionNode.tsx
import { getSessionDepth, hasSpawnedSessions } from '~/lib/graph-layout'

function getSessionColor(session: MonitorSession): string {
  const depth = getSessionDepth(session.key, allSessions)
  
  if (session.kind === 'cron') return 'bg-amber-500'
  if (depth === 0) {
    return hasSpawnedSessions(session, allSessions) 
      ? 'bg-blue-600'  // Main orchestrator
      : 'bg-indigo-500' // Standalone
  }
  
  // Subagents - varying green shades
  const greenShades = ['bg-green-600', 'bg-green-500', 'bg-green-400']
  return greenShades[Math.min(depth - 1, 2)] ?? 'bg-green-300'
}

// Apply to node
<div className={`session-node ${getSessionColor(session)} ...`}>
```

### Badge System (SessionNode.tsx)

```typescript
function SessionBadge({ text, color }: { text: string; color: string }) {
  return (
    <span 
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ backgroundColor: color + '20', color }}
    >
      {text}
    </span>
  )
}

function SessionBadges({ session }: { session: MonitorSession }) {
  const badges = []
  const depth = getSessionDepth(session.key)
  
  if (hasSpawnedSessions(session)) {
    badges.push(<SessionBadge key="orch" text="🎯 Orchestrator" color="#3b82f6" />)
  }
  
  if (session.spawnedBy) {
    badges.push(<SessionBadge key="sub" text={`🤖 L${depth}`} color="#10b981" />)
  }
  
  if (session.kind === 'cron') {
    badges.push(<SessionBadge key="cron" text="⏰ Cron" color="#f59e0b" />)
  }
  
  return <div className="flex gap-1 flex-wrap">{badges}</div>
}
```

## Testing Strategy

1. **Test with current setup** (~15 sessions)
   - Main agent spawning 2-3 subagents
   - Subagent spawning sub-subagent (depth 2)
   - Standalone cron job
   - Verify color coding is distinct

2. **Test with heavy load** (30+ sessions)
   - Multiple orchestration groups
   - Deep nesting (depth 3-4)
   - Verify performance

3. **Test filtering**
   - Toggle session types on/off
   - Filter by orchestration group
   - Verify graph updates correctly

## Conclusion

**Primary Recommendation**: 
Implement **Phase 1** immediately (color coding + badges + legend) on top of the existing radial layout with collision fixes. This gives instant visual clarity with minimal effort.

**Long-term Vision**:
Build out Phase 2 (filtering, grouping) and Phase 3 (metrics) as the moltbot ecosystem grows. The current React Flow + radial layout foundation is solid.

**Dashboard Solution**: 
✅ **Keep React Flow + enhance with orchestration features**. No need to switch tools.

---

**Next Steps**:
1. Review this document with Felipe
2. Prioritize features based on immediate needs
3. Implement Phase 1 in a new branch
4. Test with live dashboard
5. Iterate based on real usage
