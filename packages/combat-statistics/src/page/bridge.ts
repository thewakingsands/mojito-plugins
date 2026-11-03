import type { Value } from '@ffcafe/mojito-plugin-sdk'
import type { ViewBridge } from '@ffcafe/mojito-plugin-sdk/view'
import { createContext, useContext, useEffect, useState } from 'react'
import type { Command } from '../view-model.js'

export const Bridge = createContext<{ view: ViewBridge; command: (input: Command) => Promise<Value> } | null>(null)
export const useBridge = () => useContext(Bridge)!

/** The latest value of a view channel; subscribing delivers its snapshot first. */
export function useChannel<T>(channel: string): T | null {
  const { view } = useBridge()
  const [state, setState] = useState<T | null>(null)
  useEffect(() => {
    const sub = view.subscribe(channel, (batch) => {
      const last = batch.items.at(-1)
      if (last !== undefined && last !== null) setState(last as unknown as T)
    })
    return () => sub.dispose()
  }, [view, channel])
  return state
}
