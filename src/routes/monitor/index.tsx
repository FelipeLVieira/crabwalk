import { useState, useEffect, useCallback } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { trpc } from '~/integrations/trpc/client'
import {
  sessionsCollection,
  actionsCollection,
  upsertSession,
  addAction,
  updateSessionStatus,
  clearCollections,
} from '~/integrations/clawdbot'
import {
  ActionGraph,
  SessionList,
  SettingsPanel,
  StatusIndicator,
} from '~/components/monitor'
import { CrabIdleAnimation } from '~/components/ani'

export const Route = createFileRoute('/monitor/')({
  component: MonitorPageWrapper,
})

// Mobile breakpoint
const MOBILE_BREAKPOINT = 768

// Wrapper to ensure client-only rendering (useLiveQuery needs client)
function MonitorPageWrapper() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    return (
      <div className="h-screen flex items-center justify-center bg-shell-950 text-white">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="crab-icon-glow">
            <CrabIdleAnimation className="w-16 h-16" />
          </div>
          <div className="flex items-center gap-3">
            <Loader2 size={18} className="animate-spin text-crab-400" />
            <span className="font-display text-sm text-gray-400 tracking-wide uppercase">
              Loading Monitor...
            </span>
          </div>
        </motion.div>
      </div>
    )
  }

  return <MonitorPage />
}

function MonitorPage() {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historicalMode, setHistoricalMode] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)

  // Sidebar collapse state - default to collapsed on mobile
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < MOBILE_BREAKPOINT
    }
    return false
  })

  // Live queries from TanStack DB collections
  const sessionsQuery = useLiveQuery(sessionsCollection)
  const actionsQuery = useLiveQuery(actionsCollection)

  const sessions = sessionsQuery.data ?? []
  const actions = actionsQuery.data ?? []

  // Auto-collapse sidebar on mobile resize
  useEffect(() => {
    const handleResize = () => {
      const isMobile = window.innerWidth < MOBILE_BREAKPOINT
      setSidebarCollapsed(isMobile)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Check connection status on mount
  useEffect(() => {
    checkStatus()
  }, [])

  const checkStatus = async () => {
    try {
      const status = await trpc.clawdbot.status.query()
      setConnected(status.connected)
    } catch {
      setConnected(false)
    }
  }

  const handleConnect = async () => {
    setConnecting(true)
    setError(null)
    try {
      const result = await trpc.clawdbot.connect.mutate()
      if (result.status === 'connected' || result.status === 'already_connected') {
        setConnected(true)
        await loadSessions()
      } else if (result.status === 'error') {
        setError(result.message || 'Failed to connect')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection error')
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      await trpc.clawdbot.disconnect.mutate()
      setConnected(false)
      clearCollections()
    } catch (e) {
      console.error('Disconnect error:', e)
    }
  }

  const loadSessions = async () => {
    try {
      const result = await trpc.clawdbot.sessions.query(
        historicalMode ? { activeMinutes: 1440 } : { activeMinutes: 60 }
      )
      if (result.sessions) {
        for (const session of result.sessions) {
          upsertSession(session)
        }
      }
    } catch (e) {
      console.error('Failed to load sessions:', e)
    }
  }

  const handleRefresh = useCallback(async () => {
    await loadSessions()
  }, [historicalMode])

  const handleHistoricalModeChange = (enabled: boolean) => {
    setHistoricalMode(enabled)
    if (connected) {
      loadSessions()
    }
  }

  const handleDebugModeChange = async (enabled: boolean) => {
    setDebugMode(enabled)
    try {
      await trpc.clawdbot.setDebugMode.mutate({ enabled })
    } catch (e) {
      console.error('Failed to set debug mode:', e)
    }
  }

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  // Auto-connect on mount if not connected
  useEffect(() => {
    if (!connected && !connecting) {
      handleConnect()
    }
  }, [])

  // Poll for sessions while connected
  useEffect(() => {
    if (!connected) return
    const interval = setInterval(() => {
      loadSessions()
    }, 5000) // Poll every 5 seconds
    return () => clearInterval(interval)
  }, [connected, historicalMode])

  // Subscribe to real-time events
  useEffect(() => {
    if (!connected) return

    const subscription = trpc.clawdbot.events.subscribe(undefined, {
      onData: (data) => {
        if (data.type === 'session' && data.session?.key && data.session.status) {
          updateSessionStatus(data.session.key, data.session.status)
        }
        if (data.type === 'action' && data.action) {
          addAction(data.action)
        }
      },
      onError: (err) => {
        console.error('[monitor] subscription error:', err)
      },
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [connected])

  return (
    <div className="h-screen flex flex-col bg-shell-950 text-white overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-shell-900 border-b-2 border-shell-700 relative">
        {/* Gradient accent */}
        <div className="absolute inset-0 bg-linear-to-r from-crab-950/20 via-transparent to-transparent pointer-events-none" />

        <div className="relative flex items-center gap-4">
          <Link
            to="/"
            className="p-2 hover:bg-shell-800 rounded-lg transition-all border border-transparent hover:border-shell-600 group"
          >
            <ArrowLeft size={18} className="text-gray-400 group-hover:text-crab-400" />
          </Link>

          <div className="flex items-center gap-3">
            <div className="crab-icon-glow">
              <CrabIdleAnimation className="w-7 h-7" />
            </div>
            <h1 className="font-arcade text-xs text-crab-400 glow-red tracking-wider">
              MONITOR
            </h1>
          </div>

          <StatusIndicator status={connected ? 'active' : 'idle'} />
        </div>

        <div className="relative flex items-center gap-4">
          {connecting && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2"
            >
              <Loader2 size={14} className="animate-spin text-crab-400" />
              <span className="font-console text-xs text-shell-500">
                connecting...
              </span>
            </motion.div>
          )}

          {error && (
            <div className="font-console text-xs text-crab-400 max-w-xs truncate">
              <span className="text-crab-600">&gt;</span> error: {error}
            </div>
          )}

          {/* Stats display */}
          <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-shell-800/50 border border-shell-700 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="font-console text-[10px] text-shell-500 uppercase">Sessions</span>
              <span className="font-display text-sm text-neon-mint">{sessions.length}</span>
            </div>
            <div className="w-px h-4 bg-shell-700" />
            <div className="flex items-center gap-2">
              <span className="font-console text-[10px] text-shell-500 uppercase">Actions</span>
              <span className="font-display text-sm text-neon-peach">{actions.length}</span>
            </div>
          </div>

          <SettingsPanel
            connected={connected}
            historicalMode={historicalMode}
            debugMode={debugMode}
            onHistoricalModeChange={handleHistoricalModeChange}
            onDebugModeChange={handleDebugModeChange}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onRefresh={handleRefresh}
          />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <SessionList
          sessions={sessions}
          selectedKey={selectedSession}
          onSelect={setSelectedSession}
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
        />

        {/* Graph area */}
        <div className="flex-1 relative">
          <ActionGraph
            sessions={sessions}
            actions={actions}
            selectedSession={selectedSession}
            onSessionSelect={setSelectedSession}
          />
        </div>
      </div>
    </div>
  )
}
