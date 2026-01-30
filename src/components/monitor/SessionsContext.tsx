import { createContext, useContext } from 'react'
import type { MonitorSession } from '~/integrations/clawdbot'

const SessionsContext = createContext<MonitorSession[]>([])

export const SessionsProvider = SessionsContext.Provider

export function useSessions(): MonitorSession[] {
  return useContext(SessionsContext)
}
