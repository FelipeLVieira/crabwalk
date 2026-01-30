import { initTRPC } from '@trpc/server'
import { observable } from '@trpc/server/observable'
import superjson from 'superjson'
import { z } from 'zod'
import { exec } from 'child_process'
import { promisify } from 'util'
import { getClawdbotClient } from '~/integrations/clawdbot/client'
import { getPersistenceService } from '~/integrations/clawdbot/persistence'
import {
  parseEventFrame,
  sessionInfoToMonitor,
  type MonitorSession,
  type MonitorAction,
  type MonitorExecEvent,
} from '~/integrations/clawdbot'

const execAsync = promisify(exec)

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
      const persistence = getPersistenceService()
      if (!client.connected) {
        return { sessions: [], error: 'Not connected' }
      }
      try {
        const sessions = await client.listSessions(input)
        const monitorSessions = sessions.map(sessionInfoToMonitor)
        // Persist sessions if service is enabled
        for (const session of monitorSessions) {
          persistence.upsertSession(session)
        }
        return { sessions: monitorSessions }
      } catch (error) {
        return {
          sessions: [],
          error: error instanceof Error ? error.message : 'Failed to list sessions',
        }
      }
    }),

  events: publicProcedure.subscription(() => {
    return observable<{
      type: 'session' | 'action' | 'exec'
      session?: Partial<MonitorSession>
      action?: MonitorAction
      execEvent?: MonitorExecEvent
    }>((emit) => {
      const client = getClawdbotClient()
      const persistence = getPersistenceService()

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
          if (debugMode && parsed.execEvent) {
            console.log('[DEBUG] Parsed exec:', parsed.execEvent.eventType, 'runId:', parsed.execEvent.runId, 'pid:', parsed.execEvent.pid)
          }
          if (parsed.session) {
            emit.next({ type: 'session', session: parsed.session })
          }
          if (parsed.action) {
            // Persist action if service is enabled
            persistence.addAction(parsed.action)
            emit.next({ type: 'action', action: parsed.action })
          }
          if (parsed.execEvent) {
            persistence.addExecEvent(parsed.execEvent)
            emit.next({ type: 'exec', execEvent: parsed.execEvent })
          }
        }
      })

      return () => {
        unsubscribe()
      }
    })
  }),

  // Persistence service
  persistenceStatus: publicProcedure.query(() => {
    const persistence = getPersistenceService()
    return persistence.getStatus()
  }),

  persistenceStart: publicProcedure.mutation(() => {
    const persistence = getPersistenceService()
    return persistence.start()
  }),

  persistenceStop: publicProcedure.mutation(() => {
    const persistence = getPersistenceService()
    return persistence.stop()
  }),

  persistenceHydrate: publicProcedure.query(() => {
    const persistence = getPersistenceService()
    return persistence.hydrate()
  }),

  persistenceClear: publicProcedure.mutation(() => {
    const persistence = getPersistenceService()
    return persistence.clear()
  }),
})

// Helper to run SSH commands on Mac Mini
async function sshMacMini(command: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      `ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no felipemacmini@felipes-mac-mini.local "${command}"`,
      { timeout: timeoutMs }
    )
    return { stdout, stderr }
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string }
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? 'SSH failed' }
  }
}

// Parse JSON safely
function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

// Unified router for multi-gateway dashboard
const unifiedRouter = router({
  // Fetch status from both gateways
  status: publicProcedure.query(async () => {
    // Fetch Mac Mini data via SSH
    const [macMiniStatus, macMiniCrons] = await Promise.all([
      sshMacMini('clawdbot status --json 2>/dev/null'),
      sshMacMini('clawdbot cron list --json 2>/dev/null'),
    ])

    // Parse Mac Mini responses
    const macMiniStatusData = safeJsonParse(macMiniStatus.stdout, null)
    const macMiniCronsData = safeJsonParse(macMiniCrons.stdout, { jobs: [] })

    // Get local MacBook data via exec
    let macbookStatusData = null
    let macbookCronsData = { jobs: [] }
    try {
      const { stdout: localStatus } = await execAsync('clawdbot status --json 2>/dev/null', { timeout: 5000 })
      macbookStatusData = safeJsonParse(localStatus, null)
    } catch { /* ignore */ }
    try {
      const { stdout: localCrons } = await execAsync('clawdbot cron list --json 2>/dev/null', { timeout: 5000 })
      macbookCronsData = safeJsonParse(localCrons, { jobs: [] })
    } catch { /* ignore */ }

    return {
      timestamp: Date.now(),
      gateways: {
        macbook: {
          name: 'MacBook Pro',
          host: 'local',
          status: macbookStatusData,
          crons: macbookCronsData,
          online: macbookStatusData !== null,
        },
        macmini: {
          name: 'Mac Mini',
          host: 'felipes-mac-mini.local',
          status: macMiniStatusData,
          crons: macMiniCronsData,
          online: macMiniStatusData !== null,
        },
      },
    }
  }),

  // Fetch all cron jobs from both gateways
  crons: publicProcedure.query(async () => {
    const [macMiniCrons, localCrons] = await Promise.all([
      sshMacMini('clawdbot cron list --json 2>/dev/null'),
      execAsync('clawdbot cron list --json 2>/dev/null', { timeout: 5000 }).catch(() => ({ stdout: '{"jobs":[]}' })),
    ])

    const macMiniJobs = safeJsonParse<{ jobs: unknown[] }>(macMiniCrons.stdout, { jobs: [] }).jobs.map(j => ({
      ...(j as object),
      gateway: 'macmini',
      gatewayName: 'Mac Mini',
    }))

    const macbookJobs = safeJsonParse<{ jobs: unknown[] }>(localCrons.stdout, { jobs: [] }).jobs.map(j => ({
      ...(j as object),
      gateway: 'macbook',
      gatewayName: 'MacBook Pro',
    }))

    return {
      timestamp: Date.now(),
      jobs: [...macbookJobs, ...macMiniJobs],
      counts: {
        macbook: macbookJobs.length,
        macmini: macMiniJobs.length,
        total: macbookJobs.length + macMiniJobs.length,
      },
    }
  }),

  // Fetch all sessions from both gateways
  sessions: publicProcedure.query(async () => {
    const [macMiniSessions, localSessions] = await Promise.all([
      sshMacMini('clawdbot sessions list --json 2>/dev/null'),
      execAsync('clawdbot sessions list --json 2>/dev/null', { timeout: 5000 }).catch(() => ({ stdout: '{"sessions":[]}' })),
    ])

    const macMiniData = safeJsonParse<{ sessions: unknown[] }>(macMiniSessions.stdout, { sessions: [] }).sessions.map(s => ({
      ...(s as object),
      gateway: 'macmini',
      gatewayName: 'Mac Mini',
    }))

    const macbookData = safeJsonParse<{ sessions: unknown[] }>(localSessions.stdout, { sessions: [] }).sessions.map(s => ({
      ...(s as object),
      gateway: 'macbook',
      gatewayName: 'MacBook Pro',
    }))

    return {
      timestamp: Date.now(),
      sessions: [...macbookData, ...macMiniData],
      counts: {
        macbook: macbookData.length,
        macmini: macMiniData.length,
        total: macbookData.length + macMiniData.length,
      },
    }
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
  unified: unifiedRouter,
})

export type AppRouter = typeof appRouter
