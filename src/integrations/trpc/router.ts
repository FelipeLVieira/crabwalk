import { initTRPC } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import superjson from 'superjson'
import { z } from 'zod'
import { getClawdbotClient } from '~/integrations/clawdbot/client'
import {
  parseEventFrame,
  sessionInfoToMonitor,
  type MonitorSession,
  type MonitorAction,
  type ToolCall,
} from '~/integrations/clawdbot'

// Server-side debug mode state
let debugMode = false

// Server-side log collection
let collectLogs = false
const collectedEvents: Array<{ timestamp: number; event: unknown }> = []

const t = initTRPC.create({
  transformer: superjson,
})

export const router = t.router
export const publicProcedure = t.procedure

// Clawdbot router
const clawdbotRouter = router({
  connect: publicProcedure.mutation(async () => {
    const client = getClawdbotClient()
    if (client.connected) {
      return { status: 'already_connected' as const }
    }
    try {
      const hello = await client.connect()
      return {
        status: 'connected' as const,
        protocol: hello.protocol,
        features: hello.features,
        presenceCount: hello.snapshot?.presence?.length ?? 0,
      }
    } catch (error) {
      return {
        status: 'error' as const,
        message: error instanceof Error ? error.message : 'Connection failed',
      }
    }
  }),

  disconnect: publicProcedure.mutation(() => {
    const client = getClawdbotClient()
    client.disconnect()
    return { status: 'disconnected' as const }
  }),

  status: publicProcedure.query(() => {
    const client = getClawdbotClient()
    return { connected: client.connected }
  }),

  setDebugMode: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      debugMode = input.enabled
      console.log(`[clawdbot] debug mode ${debugMode ? 'enabled' : 'disabled'}`)
      return { debugMode }
    }),

  getDebugMode: publicProcedure.query(() => {
    return { debugMode }
  }),

  // Log collection
  setLogCollection: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      collectLogs = input.enabled
      if (input.enabled) {
        console.log(`[clawdbot] log collection started`)
      } else {
        console.log(`[clawdbot] log collection stopped, ${collectedEvents.length} events collected`)
      }
      return { collectLogs, eventCount: collectedEvents.length }
    }),

  getLogCollection: publicProcedure.query(() => {
    return { collectLogs, eventCount: collectedEvents.length }
  }),

  downloadLogs: publicProcedure.query(() => {
    return {
      events: collectedEvents,
      count: collectedEvents.length,
      collectedAt: new Date().toISOString(),
    }
  }),

  clearLogs: publicProcedure.mutation(() => {
    const count = collectedEvents.length
    collectedEvents.length = 0
    console.log(`[clawdbot] cleared ${count} collected events`)
    return { cleared: count }
  }),

  sessions: publicProcedure
    .input(
      z
        .object({
          limit: z.number().optional(),
          activeMinutes: z.number().optional(),
          agentId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const client = getClawdbotClient()
      if (!client.connected) {
        return { sessions: [], error: 'Not connected' }
      }
      try {
        const sessions = await client.listSessions(input)
        return {
          sessions: sessions.map(sessionInfoToMonitor),
        }
      } catch (error) {
        return {
          sessions: [],
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        }
      }
    }),

  events: publicProcedure.subscription(() => {
    return observable<{
      type: 'session' | 'action'
      session?: Partial<MonitorSession>
      action?: MonitorAction
    }>((emit) => {
      const client = getClawdbotClient()

      const unsubscribe = client.onEvent((event) => {
        // Collect raw event when log collection is enabled
        if (collectLogs) {
          collectedEvents.push({
            timestamp: Date.now(),
            event,
          })
        }

        // Log raw event when debug mode is enabled
        if (debugMode) {
          console.log('\n[DEBUG] Raw event:', JSON.stringify(event, null, 2))
        }

        const parsed = parseEventFrame(event)
        if (parsed) {
          if (debugMode && parsed.action) {
            console.log('[DEBUG] Parsed action:', parsed.action.type, parsed.action.eventType, 'sessionKey:', parsed.action.sessionKey)
          }
          if (debugMode && parsed.toolCall) {
            console.log('[DEBUG] Tool call:', parsed.toolCall.tool.name, 'status:', parsed.toolCall.tool.status)
          }
          if (parsed.session) {
            emit.next({ type: 'session', session: parsed.session })
          }
          if (parsed.action) {
            emit.next({ type: 'action', action: parsed.action })
          }
          if (parsed.toolCall) {
            emit.next({ type: 'toolCall', runId: parsed.toolCall.runId, tool: parsed.toolCall.tool })
          }
        }
      })

      return () => {
        unsubscribe()
      }
    })
  }),
})

export const appRouter = router({
  hello: publicProcedure
    .input(z.object({ name: z.string().optional() }))
    .query(({ input }) => {
      return { greeting: `Hello ${input.name ?? 'World'}!` }
    }),

  getItems: publicProcedure.query(() => {
    return [
      { id: 1, name: 'Item 1' },
      { id: 2, name: 'Item 2' },
      { id: 3, name: 'Item 3' },
    ]
  }),

  clawdbot: clawdbotRouter,
})

export type AppRouter = typeof appRouter
