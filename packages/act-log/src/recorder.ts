import type {
  Batch,
  FileWriter,
  Observation,
  ObservationSubscription,
  PluginContext,
  Sample,
} from '@ffcafe/mojito-plugin-sdk'
import { LogFormat } from './format.js'
import { LogObservations } from './observations.js'
import { packetTypes } from './packets.js'

export type Status = 'idle' | 'choosing' | 'waiting' | 'recording' | 'stopping' | 'stopped' | 'incomplete'
export type RecorderState = { status: Status; name: string; lines: number; error: string }
export class Recorder {
  state: RecorderState = { status: 'idle', name: '', lines: 0, error: '' }
  private run?: { abort: AbortController; sub?: ObservationSubscription; done?: Promise<void>; problem?: string }
  constructor(
    private ctx: PluginContext,
    private publish: (state: RecorderState) => void,
  ) {}
  private update(change: Partial<RecorderState>) {
    this.state = { ...this.state, ...change }
    this.publish(this.state)
  }
  private permitted() {
    const grants = this.ctx.capabilities.get()
    for (const cap of ['packets.read', 'identity.read']) {
      if (grants[cap]?.state !== 'available')
        throw new Error(cap === 'packets.read' ? '请在插件权限中允许读取数据包' : '请在插件权限中允许读取角色身份')
    }
  }
  async start() {
    if (this.run) return
    const run: NonNullable<Recorder['run']> = { abort: new AbortController() }
    this.run = run
    this.update({ status: 'choosing', name: '', lines: 0, error: '' })
    let writer: FileWriter | null = null
    try {
      this.permitted()
      writer = await this.ctx.host.openWriteFile({ extensions: ['log', 'txt'] }, { signal: run.abort.signal })
      if (!writer) {
        this.run = undefined
        this.update({ status: 'idle' })
        return
      }
      this.permitted()
      run.abort.signal.throwIfAborted()
      const file = writer,
        format = new LogFormat(),
        input = new LogObservations(this.ctx.data)
      this.update({ status: 'waiting', name: file.name })
      const max = Math.floor(this.ctx.limits.values['transport.messageBytes'] / 2)
      const consume = async (batch: Batch<Sample<Observation>>) => {
        let chunks: Uint8Array[] = [],
          length = 0,
          writing = false
        let observedAt = batch.items[0]?.meta.observedAt
        const check = () => {
          run.abort.signal.throwIfAborted()
          this.permitted()
        }
        const flush = async () => {
          if (!chunks.length) return
          check()
          const bytes = new Uint8Array(length)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
          }
          writing = true
          await file.write(bytes, { signal: run.abort.signal })
          writing = false
          this.update({ lines: this.state.lines + chunks.length })
          chunks = []
          length = 0
        }
        try {
          for (const sample of batch.items) {
            check()
            observedAt = sample.meta.observedAt
            if (this.state.status === 'waiting') this.update({ status: 'recording' })
            for (const row of await input.consume(sample)) {
              const bytes = format.encode(row)
              if (length + bytes.length > max) await flush()
              chunks.push(bytes)
              length += bytes.length
            }
          }
          await flush()
        } catch (e) {
          run.problem = message(e)
          if (!writing && observedAt !== undefined) {
            check()
            await flush()
            const text = run.problem.replace(/[|\r\n]+/gu, ' ')
            await file.write(format.encode({ type: 254, timestamp: observedAt, fields: [text] }), {
              signal: run.abort.signal,
            })
            this.update({ lines: this.state.lines + 1 })
          }
          throw e
        }
      }
      const sub = this.ctx.observations.subscribe(
        {
          packets: { directions: ['recv'], channels: ['zone'], types: packetTypes },
          events: { types: ['gameLog', 'statusSlotsChanged'] },
          memory: ['combatant', 'party', 'zone', 'player'],
          initial: true,
        },
        consume,
        { signal: run.abort.signal },
      )
      run.sub = sub
      run.done = sub.closed.then(async (result) => {
        if (result.reason !== 'completed') {
          run.problem ??= result.error?.message ?? result.reason
          run.abort.abort()
        }
        try {
          await file.close()
        } catch (e) {
          run.problem ??= message(e)
        }
        this.run = undefined
        this.update({ status: run.problem ? 'incomplete' : 'stopped', error: run.problem ?? '' })
      })
      await sub.ready
    } catch (e) {
      if (run.done) {
        await run.done
        return
      }
      try {
        await writer?.close()
      } catch (closeError) {
        run.problem = message(closeError)
      }
      this.run = undefined
      this.update({
        status: writer ? 'incomplete' : 'idle',
        name: writer?.name ?? '',
        error: run.problem ?? message(e),
      })
    }
  }
  async stop() {
    const run = this.run
    if (!run?.sub) return
    this.update({ status: 'stopping' })
    try {
      await run.sub.finish()
    } catch (e) {
      run.problem ??= message(e)
    }
    await run.done
  }
  async dispose() {
    const run = this.run
    if (!run) return
    run.abort.abort()
    run.sub?.dispose()
    await run.done
  }
}
function message(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
