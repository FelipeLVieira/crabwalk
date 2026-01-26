import { memo } from 'react'
import type { NodeProps } from '@xyflow/react'
import { CrabIdleAnimation, CrabJumpAnimation, CrabAttackAnimation } from '~/components/ani'

export type ChaserCrabState = 'idle' | 'running' | 'attacking'

interface ChaserCrabData {
  state: ChaserCrabState
  facingLeft: boolean
}

function ChaserCrabNodeComponent({ data }: NodeProps) {
  const { state, facingLeft } = data as unknown as ChaserCrabData

  return (
    <div
      className="w-5 h-5 transition-transform duration-75"
      style={{
        transform: `scaleX(${facingLeft ? -1 : 1})`,
      }}
    >
      {state === 'idle' && <CrabIdleAnimation className="w-full h-full" />}
      {state === 'running' && <CrabJumpAnimation className="w-full h-full" />}
      {state === 'attacking' && <CrabAttackAnimation className="w-full h-full" />}
    </div>
  )
}

export const ChaserCrabNode = memo(ChaserCrabNodeComponent)
