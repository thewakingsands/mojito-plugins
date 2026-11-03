import { PluginError, pluginError } from './errors.js'
import type { Batch, BatchListener, Subscription } from './types.js'

/** Yield one batch at a time; advancing the iterator acknowledges consumption of the prior batch. */
export function iterateBatches<T>(
  register: (listener: BatchListener<T>) => Subscription,
): AsyncIterableIterator<Batch<T>> {
  let ended = false
  let failure: unknown
  let waiting: { resolve(value: IteratorResult<Batch<T>>): void; reject(error: unknown): void } | undefined
  let batch: Batch<T> | undefined
  let consumed: (() => void) | undefined
  const subscription = register((value) => {
    if (ended) return
    if (batch || consumed) throw pluginError('internal', 'Concurrent subscription batch')
    return new Promise<void>((resolve) => {
      consumed = resolve
      if (waiting) {
        waiting.resolve({ done: false, value })
        waiting = undefined
      } else batch = value
    })
  })
  const finish = (error?: unknown) => {
    if (ended) return
    ended = true
    failure = error
    batch = undefined
    consumed?.()
    consumed = undefined
    if (waiting) {
      if (error) waiting.reject(error)
      else waiting.resolve({ done: true, value: undefined })
      waiting = undefined
    }
  }
  void subscription.closed.then(({ error }) => finish(error ? new PluginError(error) : undefined))
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      if (waiting) return Promise.reject(pluginError('invalid_argument', 'Only one next() may be pending'))
      if (failure) return Promise.reject(failure)
      if (ended) return Promise.resolve({ done: true as const, value: undefined })
      if (batch) {
        const value = batch
        batch = undefined
        return Promise.resolve({ done: false as const, value })
      }
      consumed?.()
      consumed = undefined
      return new Promise<IteratorResult<Batch<T>>>((resolve, reject) => {
        waiting = { resolve, reject }
      })
    },
    async return() {
      subscription.dispose()
      finish()
      return { done: true, value: undefined }
    },
    async throw(error) {
      subscription.dispose()
      finish(error)
      throw error
    },
  }
}
