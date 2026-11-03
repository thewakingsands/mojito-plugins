import type { ClockService, Disposer } from '@ffcafe/mojito-plugin-sdk'
import type { Lang } from '../vendor/cactbot/resources/languages'
import type { RaidbossData } from '../vendor/cactbot/types/data'
import type { LooseTriggerSet, TimelineField } from '../vendor/cactbot/types/trigger'
import defaults, { type RaidbossOptions } from '../vendor/cactbot/ui/raidboss/raidboss_options'
import { Timeline, TimelineUI } from '../vendor/cactbot/ui/raidboss/timeline'
import type { Event, TimelineStyle } from '../vendor/cactbot/ui/raidboss/timeline_parser'
import {
  type ProcessedTrigger,
  TriggerOutputProxy,
  WorkerCallbacks,
} from '../vendor/cactbot/ui/raidboss/worker_callbacks'
import { compileMatcher, localizedConditions, MatchError, type Matcher, type StructuredEvent } from './matcher'
import { TimelineClock } from './timeline-clock'

export type RuleConfig = {
  enabled?: boolean
  level?: 'info' | 'alert' | 'alarm'
  audio?: 'tts' | 'sound' | 'none'
  matching?: { type: string; netRegex: Record<string, unknown> }
}
export type Settings = {
  language: Lang
  audio: 'tts' | 'sound' | 'none'
  rules: Record<string, Record<string, RuleConfig>>
  sets?: Record<string, Record<string, string | number | boolean>>
}
export type Diagnostic = {
  setId: string
  triggerId: string
  state: 'ready' | 'disabled_by_user' | 'needs_completion' | 'unsupported' | 'missing_data' | 'faulted'
  reason: string
  matches: number
}
export type Alert = {
  id: number
  setId: string
  triggerId: string
  level: 'info' | 'alert' | 'alarm'
  text: string
  expiresAt: number
}
export interface EngineOutput {
  changed(): void
  say(text: string, signal: AbortSignal): void
  play(path: string, volume: number | undefined, signal: AbortSignal): void
}
type Rule = { original: ProcessedTrigger; matcher?: Matcher; diagnostic: Diagnostic; config: RuleConfig }
type Group = {
  id: string
  set: LooseTriggerSet
  callbacks: WorkerCallbacks
  rules: Rule[]
  index: Map<string, Rule[]>
  timeline?: Timeline
  clock: TimelineClock
}

export const options = (language: Lang): RaidbossOptions => ({
  ...defaults,
  ParserLanguage: language,
  DisplayLanguage: language,
  PerTriggerOptions: {},
  PerTriggerAutoConfig: {},
  PerTriggerSetAutoConfig: {},
  DisabledTriggers: {},
  PerZoneTimelineConfig: {},
  TriggerSetConfig: {},
  PlayerNicks: {},
  InfoSound: 'sounds/percussion_hit.webm',
  AlertSound: 'sounds/Alert.webm',
  AlarmSound: 'sounds/Alarm.webm',
  LongSound: 'sounds/Long.webm',
  PullSound: 'sounds/sonar.webm',
})

export class RaidbossEngine {
  readonly diagnostics: Diagnostic[] = []
  alerts: Alert[] = []
  bars: { setId: string; id: string; text: string; endsAt: number; duration: boolean }[] = []
  sharedDataWarning = false
  /** Changes whenever the active groups change, i.e. when definitions/configurations may differ. */
  catalogRevision = 0
  private groups: Group[] = []
  private timers = new Set<Disposer>()
  private serial = 0
  private generation = 0
  private registrations = new WeakMap<ProcessedTrigger, Record<string, unknown>>()
  private sets: { path: string; set: LooseTriggerSet }[]
  constructor(
    sets: { path: string; set: unknown }[],
    private timelines: Record<string, string>,
    private clock: ClockService,
    private output: EngineOutput,
  ) {
    this.sets = sets.map(({ path, set: input }) => {
      if (!input || typeof input !== 'object') throw new Error(`Invalid trigger set: ${path}`)
      const set = input as LooseTriggerSet
      if (
        (set.triggers !== undefined && !Array.isArray(set.triggers)) ||
        (set.timelineTriggers !== undefined && !Array.isArray(set.timelineTriggers))
      )
        throw new Error(`Invalid trigger arrays: ${path}`)
      return {
        path,
        set: {
          ...set,
          triggers: [...(set.triggers ?? [])],
          timelineTriggers: [...(set.timelineTriggers ?? [])],
          timelineReplace: structuredClone(set.timelineReplace),
        },
      }
    })
    for (const { set } of this.sets)
      for (const trigger of set.triggers ?? []) {
        const record = trigger as unknown as Record<string, unknown>
        try {
          this.registrations.set(
            trigger,
            structuredClone(
              Object.fromEntries(
                Object.entries(record).filter(([key]) => key === 'type' || key.startsWith('netRegex')),
              ),
            ),
          )
        } catch {
          this.registrations.set(trigger, { type: record.type, netRegex: null })
        }
      }
  }

  configurations(language: Lang) {
    return this.groups.flatMap((group) =>
      (group.set.config ?? []).map((entry) => {
        const config = entry as unknown as {
          id: string
          name?: Record<string, string>
          type?: string
          default?: string | number | boolean
          options?: Record<string, Record<string, string>>
        }
        return {
          setId: group.id,
          id: config.id,
          name: config.name?.[language] ?? config.name?.en ?? config.id,
          type: config.type ?? 'string',
          default: config.default ?? '',
          options: config.options?.[language] ?? config.options?.en ?? {},
        }
      }),
    )
  }
  definitions(language: Lang) {
    return this.sets
      .filter(({ path, set }) => this.groups.some((group) => group.id === (set.id ?? path)))
      .flatMap(({ path, set }) =>
        (set.triggers ?? []).map((trigger) => {
          const record = this.registrations.get(trigger)!
          return {
            setId: set.id ?? path,
            triggerId: trigger.id ?? '',
            path,
            original: JSON.stringify(
              { type: record.type, netRegex: localizedConditions(record, language) },
              (_key, value) => (value instanceof RegExp ? String(value) : value),
            ),
          }
        }),
      )
  }

  validateOverrides(settings: Settings): void {
    for (const { path, set } of this.sets)
      for (const trigger of set.triggers ?? []) {
        const override = settings.rules[set.id ?? path]?.[trigger.id ?? '']?.matching
        if (!override) continue
        const original = localizedConditions(this.registrations.get(trigger)!, settings.language)
        if (original && typeof original === 'object' && !(original instanceof RegExp)) {
          for (const key of Object.keys(original))
            if (key !== 'capture' && !(key in override.netRegex))
              throw new Error(`Override must retain the ${key} constraint of ${trigger.id}`)
        } else if (!Object.keys(override.netRegex).some((key) => key !== 'capture'))
          throw new Error(`Legacy rule ${trigger.id} requires complete matching conditions`)
      }
  }

  reset(): void {
    ++this.generation
    ++this.catalogRevision
    for (const group of this.groups) {
      group.callbacks.reset()
      group.timeline?.Stop()
      group.clock.clear()
    }
    for (const cancel of this.timers) void cancel()
    this.timers.clear()
    this.groups = []
    this.alerts = []
    this.bars = []
    this.diagnostics.length = 0
    this.sharedDataWarning = false
    this.output.changed()
  }

  start(zone: number, data: RaidbossData, settings: Settings, preservePersistent = false): void {
    if (preservePersistent) {
      for (const group of this.groups.filter((group) => group.set.resetWhenOutOfCombat !== false)) {
        group.callbacks.reset()
        group.timeline?.Stop()
        group.clock.clear()
        this.diagnostics.splice(
          0,
          this.diagnostics.length,
          ...this.diagnostics.filter((item) => item.setId !== group.id),
        )
        this.alerts = this.alerts.filter((item) => item.setId !== group.id)
        this.bars = this.bars.filter((item) => item.setId !== group.id)
      }
      this.groups = this.groups.filter((group) => group.set.resetWhenOutOfCombat === false)
    } else this.reset()
    const active = this.sets.filter(
      ({ set }) =>
        set.zoneId === zone || set.zoneId === null || (Array.isArray(set.zoneId) && set.zoneId.includes(zone)),
    )
    // All active sets share one data object, as upstream does. Init faults stop the module.
    const initial = Object.assign({}, ...active.map(({ set }) => set.initData?.() ?? {}))
    Object.defineProperties(initial, Object.getOwnPropertyDescriptors(data))
    const shared = initial as RaidbossData
    const counts = new Map<string, number>()
    for (const { path, set } of active)
      for (const trigger of set.triggers ?? []) {
        const key = JSON.stringify([set.id ?? path, trigger.id])
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    const generation = this.generation
    for (const { path, set } of active) {
      const id = set.id ?? path
      if (preservePersistent && this.groups.some((group) => group.id === id)) continue
      const configuration: Record<string, unknown> = {}
      for (const entry of set.config ?? []) configuration[entry.id] = (entry as { default?: unknown }).default
      // Saved values for options the rule set no longer has stay in settings but are not applied.
      const ignored: string[] = []
      for (const [key, value] of Object.entries(settings.sets?.[id] ?? {})) {
        const entry = set.config?.find((entry) => entry.id === key) as
          | { type?: string; options?: Record<string, string> }
          | undefined
        if (
          !entry ||
          (entry.type === 'select' &&
            entry.options &&
            !Object.values(entry.options)
              .flatMap((options) => (typeof options === 'object' ? Object.values(options) : [options]))
              .includes(String(value)))
        )
          ignored.push(key)
        else configuration[key] = value
      }
      if (ignored.length)
        this.diagnostics.push({
          setId: id,
          triggerId: '(config)',
          state: 'unsupported',
          reason: `Saved configuration not applied: ${ignored.join(', ')}`,
          matches: 0,
        })
      const groupData = new Proxy(shared, {
        get(target, key, receiver) {
          return key === 'triggerSetConfig' ? configuration : Reflect.get(target, key, receiver)
        },
      })
      const opts = options(settings.language)
      const group: Group = {
        id,
        set,
        rules: [],
        index: new Map(),
        clock: new TimelineClock(this.clock),
        callbacks: undefined!,
      }
      const ruleFor = (trigger: ProcessedTrigger) => group.rules.find((rule) => rule.original === trigger)
      const audio = (trigger: ProcessedTrigger) => ruleFor(trigger)?.config.audio ?? settings.audio
      group.callbacks = new WorkerCallbacks(groupData, opts, this.clock, {
        text: (helper, text, level, duration) => {
          const alert = {
            id: ++this.serial,
            setId: id,
            triggerId: helper.trigger.id ?? 'timeline',
            text,
            level: ruleFor(helper.trigger)?.config.level ?? level,
            expiresAt: (this.clock.now() ?? 0) + duration * 1000,
          }
          this.alerts.push(alert)
          this.output.changed()
          const cancel = this.clock.setTimeout(() => {
            this.timers.delete(cancel)
            if (generation !== this.generation) return
            this.alerts = this.alerts.filter((entry) => entry !== alert)
            this.output.changed()
          }, duration * 1000)
          this.timers.add(cancel)
        },
        say: (helper, text) => {
          if (audio(helper.trigger) === 'tts') this.output.say(text, group.callbacks.controller(helper.trigger).signal)
        },
        play: (helper, path, volume) => {
          if (audio(helper.trigger) === 'sound')
            this.output.play(path, volume, group.callbacks.controller(helper.trigger).signal)
        },
        fault: (trigger, error) => {
          const rule = ruleFor(trigger)
          if (rule) {
            rule.diagnostic.state = 'faulted'
            rule.diagnostic.reason = String(error)
          } else
            this.diagnostics.push({
              setId: id,
              triggerId: trigger.id ?? 'timeline',
              state: 'faulted',
              reason: String(error),
              matches: 0,
            })
          this.sharedDataWarning = true
          this.output.changed()
        },
      })
      // Audio precedence is evaluated upstream; per-rule configuration selects its mode.
      opts.SpokenAlertsEnabled = settings.audio === 'tts'
      opts.SoundAlertsEnabled = settings.audio === 'sound'
      for (const original of set.triggers ?? []) {
        const trigger = original as ProcessedTrigger
        const config = settings.rules[id]?.[trigger.id ?? ''] ?? {}
        const diagnostic: Diagnostic = {
          setId: id,
          triggerId: trigger.id ?? '(missing id)',
          state: 'ready',
          reason: '',
          matches: 0,
        }
        const rule: Rule = { original: trigger, config, diagnostic }
        this.diagnostics.push(diagnostic)
        group.rules.push(rule)
        try {
          if (!trigger.id) throw new MatchError('unsupported', 'Trigger ID is required')
          if ((counts.get(JSON.stringify([id, trigger.id])) ?? 0) > 1)
            throw new MatchError('unsupported', 'Duplicate trigger ID in this group; all conflicts disabled')
          if (config.enabled === false) {
            diagnostic.state = 'disabled_by_user'
            continue
          }
          if ('rumble' in trigger) throw new MatchError('unsupported', 'Rumble is unavailable')
          const record = this.registrations.get(trigger)!
          trigger.output = TriggerOutputProxy.makeOutput(trigger, settings.language)
          rule.matcher = compileMatcher(
            config.matching?.type ?? record.type,
            config.matching?.netRegex ?? localizedConditions(record, settings.language),
            settings.language,
            set.timelineReplace,
          )
          const indexed = group.index.get(rule.matcher.type) ?? []
          indexed.push(rule)
          group.index.set(rule.matcher.type, indexed)
          if (rule.matcher.missingTranslations.length)
            diagnostic.reason = `Untranslated constraints retained: ${rule.matcher.missingTranslations.join(', ')}`
          if (config.audio)
            opts.PerTriggerAutoConfig[trigger.id] = {
              SpokenAlertsEnabled: config.audio === 'tts',
              SoundAlertsEnabled: config.audio === 'sound',
            }
        } catch (error) {
          diagnostic.state = error instanceof MatchError ? error.status : 'unsupported'
          diagnostic.reason = String(error)
          this.sharedDataWarning = true
        }
      }
      this.groups.push(group)
      this.startTimeline(group, groupData, opts, settings, generation)
    }
    ++this.catalogRevision
    this.output.changed()
  }

  private startTimeline(
    group: Group,
    data: RaidbossData,
    opts: RaidbossOptions,
    settings: Settings,
    generation: number,
  ): void {
    const set = group.set
    if (!set.timelineFile && !set.timeline) return
    const diagnostic: Diagnostic = { setId: group.id, triggerId: '(timeline)', state: 'ready', reason: '', matches: 0 }
    this.diagnostics.push(diagnostic)
    try {
      const files =
        set.timelineFile === undefined ? [] : Array.isArray(set.timelineFile) ? set.timelineFile : [set.timelineFile]
      const text = files.map((path) => {
        const file = this.timelines[path]
        if (file === undefined) throw new Error(`Timeline file missing: ${path}`)
        return file
      })
      const append = (field: TimelineField): void => {
        if (typeof field === 'function') append(field(data))
        else if (Array.isArray(field)) for (const entry of field) append(entry)
        else if (typeof field === 'string') text.push(field)
      }
      append(set.timeline)
      for (const trigger of set.timelineTriggers ?? [])
        (trigger as ProcessedTrigger).output = TriggerOutputProxy.makeOutput(trigger, settings.language)
      const timeline = new Timeline(
        text.join('\n'),
        set.timelineReplace ?? [],
        set.timelineTriggers ?? [],
        (set.timelineStyles ?? []) as TimelineStyle[],
        opts,
        0,
        group.clock,
      )
      const engine = this
      class View extends TimelineUI {
        override OnAddTimer(fightNow: number, event: Event): void {
          engine.bars.push({
            setId: group.id,
            id: event.id,
            text: event.text,
            endsAt: group.clock.now() + (event.time - fightNow) * 1000,
            duration: !!event.isDur,
          })
          engine.output.changed()
        }
        override OnRemoveTimer(event: Event): void {
          engine.bars = engine.bars.filter((bar) => bar.setId !== group.id || bar.id !== event.id)
          engine.output.changed()
        }
        override OnTrigger(trigger: ProcessedTrigger, matches: RegExpExecArray | null, time: number): void {
          if (generation === engine.generation) group.callbacks.run(trigger, matches?.groups ?? {}, time)
        }
        override OnShowInfoText(text: string, time: number): void {
          group.callbacks.run({ infoText: text }, {}, time)
        }
        override OnShowAlertText(text: string, time: number): void {
          group.callbacks.run({ alertText: text }, {}, time)
        }
        override OnShowAlarmText(text: string, time: number): void {
          group.callbacks.run({ alarmText: text }, {}, time)
        }
        override OnSpeakTTS(text: string): void {
          if (settings.audio === 'tts') engine.output.say(text, group.callbacks.controller({}).signal)
        }
      }
      new View().SetTimeline(timeline)
      group.timeline = timeline
    } catch (error) {
      diagnostic.state = 'unsupported'
      diagnostic.reason = String(error)
    }
  }

  event(event: StructuredEvent): void {
    const now = this.clock.now()
    if (now === null) return
    for (const group of this.groups) {
      if (group.timeline) {
        try {
          group.timeline.OnEvent(event, now)
        } catch (error) {
          for (const trigger of group.set.timelineTriggers ?? []) group.callbacks.cancel(trigger)
          group.timeline.Stop()
          group.clock.clear()
          group.timeline = undefined
          const diagnostic = this.diagnostics.find(
            (item) => item.setId === group.id && item.triggerId === '(timeline)',
          )!
          diagnostic.state = 'missing_data'
          diagnostic.reason = String(error)
          this.output.changed()
        }
      }
      for (const rule of group.index.get(event.type) ?? []) {
        if (!rule.matcher || !['ready', 'missing_data'].includes(rule.diagnostic.state)) continue
        const result = rule.matcher.match(event)
        if (!result) continue
        if ('missing' in result) {
          rule.diagnostic.state = 'missing_data'
          rule.diagnostic.reason = `Missing event field: ${result.missing}`
          this.output.changed()
          continue
        }
        rule.diagnostic.state = 'ready'
        rule.diagnostic.matches++
        group.callbacks.run(rule.original, result.matches, now)
        this.output.changed()
      }
    }
  }
}
