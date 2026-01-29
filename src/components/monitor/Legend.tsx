import { useState } from 'react'
import { ChevronDown, ChevronUp, Info } from 'lucide-react'
import { SESSION_TYPE_COLORS } from '~/lib/session-type-detection'

interface LegendItemProps {
  emoji: string
  label: string
  color: string
  description: string
}

function LegendItem({ emoji, label, color, description }: LegendItemProps) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div 
        className="w-3 h-3 rounded-sm" 
        style={{ backgroundColor: color }}
      />
      <span className="text-xs font-medium text-gray-200">
        {emoji} {label}
      </span>
      <span className="text-xs text-gray-400 ml-auto">
        {description}
      </span>
    </div>
  )
}

export function Legend() {
  const [isExpanded, setIsExpanded] = useState(true)

  return (
    <div className="bg-shell-900/95 border border-shell-700 rounded-lg shadow-lg backdrop-blur-sm">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-shell-800/50 transition-colors rounded-t-lg"
      >
        <Info size={14} className="text-crab-500" />
        <span className="text-xs font-display font-semibold uppercase tracking-wide text-gray-200">
          Session Types
        </span>
        <div className="ml-auto">
          {isExpanded ? (
            <ChevronUp size={14} className="text-gray-400" />
          ) : (
            <ChevronDown size={14} className="text-gray-400" />
          )}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="px-3 pb-2 border-t border-shell-700">
          <div className="space-y-0.5 pt-2">
            <LegendItem
              emoji="🎯"
              label="Orchestrator"
              color={SESSION_TYPE_COLORS.orchestrator}
              description="Main agent"
            />
            <LegendItem
              emoji="🤖"
              label="Subagent"
              color={SESSION_TYPE_COLORS.subagent}
              description="Spawned worker"
            />
            <LegendItem
              emoji="⏰"
              label="Scheduled"
              color={SESSION_TYPE_COLORS.cron}
              description="Cron job"
            />
            <LegendItem
              emoji="🔷"
              label="Standalone"
              color={SESSION_TYPE_COLORS.standalone}
              description="Single agent"
            />
          </div>
          
          <div className="mt-2 pt-2 border-t border-shell-700">
            <p className="text-[10px] text-gray-500 font-console">
              Lighter shades = deeper nesting (L2, L3...)
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
