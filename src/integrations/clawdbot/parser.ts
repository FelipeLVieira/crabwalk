import type {
  EventFrame,
  ChatEvent,
  AgentEvent,
  MonitorSession,
  MonitorAction,
  SessionInfo,
  ToolCall,
} from './protocol'
import { parseSessionKey } from './protocol'

export interface ParsedEvent {
  session?: Partial<MonitorSession>
  action?: MonitorAction
  toolCall?: { runId: string; tool: ToolCall }
}

export function sessionInfoToMonitor(info: SessionInfo): MonitorSession {
  const parsed = parseSessionKey(info.key)
  return {
    key: info.key,
    agentId: parsed.agentId,
    platform: parsed.platform,
    recipient: parsed.recipient,
    isGroup: parsed.isGroup,
    lastActivityAt: info.lastActivityAt,
    status: 'idle',
  }
}

export interface ChatParseResult {
  action: MonitorAction
  toolCalls: ToolCall[]
}

export function chatEventToAction(event: ChatEvent): ChatParseResult {
  // Map chat state to new action types
  let type: MonitorAction['type'] = 'streaming'
  if (event.state === 'final') type = 'complete'
  else if (event.state === 'delta') type = 'streaming'
  else if (event.state === 'aborted') type = 'aborted'
  else if (event.state === 'error') type = 'error'

  const action: MonitorAction = {
    id: `${event.runId}-${event.seq}`,
    runId: event.runId,
    sessionKey: event.sessionKey,
    seq: event.seq,
    type,
    eventType: 'chat',
    timestamp: Date.now(),
  }

  const toolCalls: ToolCall[] = []

  // Extract usage/stopReason from final events
  if (event.state === 'final') {
    if (event.usage) {
      action.inputTokens = event.usage.inputTokens
      action.outputTokens = event.usage.outputTokens
    }
    if (event.stopReason) {
      action.stopReason = event.stopReason
    }
  }

  if (event.message) {
    if (typeof event.message === 'string') {
      action.content = event.message
    } else if (typeof event.message === 'object') {
      const msg = event.message as Record<string, unknown>

      // Extract text and tools from content blocks
      if (Array.isArray(msg.content)) {
        const texts: string[] = []
        for (const block of msg.content) {
          if (typeof block === 'object' && block) {
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') {
              texts.push(b.text)
            } else if (b.type === 'tool_use') {
              toolCalls.push({
                id: String(b.id || `tool-${Date.now()}`),
                name: String(b.name || 'unknown'),
                args: b.input,
                status: 'pending',
                timestamp: Date.now(),
              })
            } else if (b.type === 'tool_result') {
              // Find matching tool call and update it
              const toolId = String(b.tool_use_id || '')
              const existingTool = toolCalls.find(t => t.id === toolId)
              if (existingTool) {
                existingTool.result = typeof b.content === 'string' ? b.content : JSON.stringify(b.content)
                existingTool.status = b.is_error ? 'error' : 'success'
              } else if (typeof b.content === 'string') {
                texts.push(b.content)
              }
            }
          }
        }
        if (texts.length > 0) {
          action.content = texts.join('')
        }
      } else if (typeof msg.content === 'string') {
        action.content = msg.content
      } else if (typeof msg.text === 'string') {
        action.content = msg.text
      }
    }
  }

  if (event.errorMessage) {
    action.content = event.errorMessage
  }

  return { action, toolCalls }
}

export interface AgentParseResult {
  action?: MonitorAction
  toolCall?: ToolCall
  toolResult?: { toolId: string; result: string; isError: boolean }
}

export function agentEventToAction(event: AgentEvent): AgentParseResult {
  const data = event.data

  // Handle lifecycle events
  if (event.stream === 'lifecycle') {
    let type: MonitorAction['type'] = 'streaming'
    let content: string | undefined
    let startedAt: number | undefined
    let endedAt: number | undefined

    if (data.phase === 'start') {
      type = 'start'
      content = 'Run started'
      startedAt = typeof data.startedAt === 'number' ? data.startedAt : event.ts
    } else if (data.phase === 'end') {
      type = 'complete'
      content = 'Run completed'
      endedAt = typeof data.endedAt === 'number' ? data.endedAt : event.ts
    }

    return {
      action: {
        id: `${event.runId}-${event.seq}`,
        runId: event.runId,
        sessionKey: event.sessionKey || event.stream,
        seq: event.seq,
        type,
        eventType: 'agent' as const,
        timestamp: event.ts,
        content,
        startedAt,
        endedAt,
      }
    }
  }

  // Handle tool use - return as tool call to be aggregated
  if (data.type === 'tool_use') {
    return {
      toolCall: {
        id: String(data.id || `tool-${event.seq}`),
        name: String(data.name || 'unknown'),
        args: data.input,
        status: 'running',
        timestamp: event.ts,
      }
    }
  }

  // Handle tool result
  if (data.type === 'tool_result') {
    return {
      toolResult: {
        toolId: String(data.tool_use_id || ''),
        result: typeof data.content === 'string' ? data.content : JSON.stringify(data.content),
        isError: Boolean(data.is_error),
      }
    }
  }

  // Text streaming (usually duplicates chat events)
  if (data.type === 'text') {
    return {
      action: {
        id: `${event.runId}-${event.seq}`,
        runId: event.runId,
        sessionKey: event.sessionKey || event.stream,
        seq: event.seq,
        type: 'streaming',
        eventType: 'agent' as const,
        timestamp: event.ts,
        content: String(data.text || ''),
      }
    }
  }

  return {}
}

export function parseEventFrame(frame: EventFrame): ParsedEvent | null {
  // Skip system events
  if (frame.event === 'health' || frame.event === 'tick') {
    return null
  }

  if (frame.event === 'chat' && frame.payload) {
    const chatEvent = frame.payload as ChatEvent
    const { action, toolCalls } = chatEventToAction(chatEvent)

    const result: ParsedEvent = {
      action,
      session: {
        key: chatEvent.sessionKey,
        status: chatEvent.state === 'delta' ? 'thinking' : 'active',
        lastActivityAt: Date.now(),
      },
    }

    // If there are tool calls, return the first one (others will come in subsequent events)
    if (toolCalls.length > 0) {
      result.toolCall = { runId: chatEvent.runId, tool: toolCalls[0]! }
    }

    return result
  }

  if (frame.event === 'agent' && frame.payload) {
    const agentEvent = frame.payload as AgentEvent
    const parsed = agentEventToAction(agentEvent)

    // Lifecycle events return action
    if (parsed.action) {
      return {
        action: parsed.action,
        session: agentEvent.sessionKey ? {
          key: agentEvent.sessionKey,
          status: agentEvent.data?.phase === 'start' ? 'thinking' : 'active',
          lastActivityAt: Date.now(),
        } : undefined,
      }
    }

    // Tool calls
    if (parsed.toolCall) {
      return {
        toolCall: { runId: agentEvent.runId, tool: parsed.toolCall },
        session: agentEvent.sessionKey ? {
          key: agentEvent.sessionKey,
          status: 'thinking',
          lastActivityAt: Date.now(),
        } : undefined,
      }
    }

    // Tool results - need special handling
    if (parsed.toolResult) {
      // Return as a pseudo tool call that will update existing tool
      return {
        toolCall: {
          runId: agentEvent.runId,
          tool: {
            id: parsed.toolResult.toolId,
            name: '', // Will be filled from existing
            result: parsed.toolResult.result,
            status: parsed.toolResult.isError ? 'error' : 'success',
            timestamp: agentEvent.ts,
          }
        },
        session: agentEvent.sessionKey ? {
          key: agentEvent.sessionKey,
          status: 'active',
          lastActivityAt: Date.now(),
        } : undefined,
      }
    }

    return null
  }

  return null
}
