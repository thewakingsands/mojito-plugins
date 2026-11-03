// Adapted from cactbot e79ea7f ui/raidboss/popup-text.ts (Apache-2.0).
// The callback ordering, output proxy, text precedence and TTS transforms are upstream.
// DOM, wall-clock timers and browser audio are replaced by injected Worker outputs.
import type { ClockService, Disposer } from '@ffcafe/mojito-plugin-sdk';
import type { Lang } from '../../resources/languages';
import type { RaidbossData } from '../../types/data';
import type { Matches } from '../../types/net_matches';
import type { LooseTrigger, Output, OutputStrings, PartialTriggerOutput, ResponseField,
  ResponseOutput, TriggerAutoConfig, TriggerField, TriggerOutput, TriggerSetAutoConfig } from '../../types/trigger';
import type { PerTriggerAutoConfig, PerTriggerOption, RaidbossOptions } from './raidboss_options';
export type ProcessedTrigger = LooseTrigger & {
  filename?: string;
  localRegex?: RegExp;
  localNetRegex?: RegExp;
  output?: Output;
  triggerSetAutoConfig?: Readonly<TriggerSetAutoConfig>;
};

const sounds = ['Alarm', 'Alert', 'Info', 'Long', 'Pull'] as const;
const soundStrs: readonly string[] = sounds;

type Sound = typeof sounds[number];
type SoundType = `${Sound}Sound`;
type SoundTypeVolume = `${SoundType}Volume`;

const texts = ['info', 'alert', 'alarm'] as const;

export type Text = typeof texts[number];
type TextUpper = `${Capitalize<Text>}`;
export type TextText = `${Text}Text`;
type TextUpperText = `${TextUpper}Text`;

type TextMap = {
  [text in Text]: {
    text: TextText;
    upperText: TextUpperText;
    upperSound: SoundType;
    upperSoundVolume: SoundTypeVolume;
    rumbleDuration: `${TextUpper}RumbleDuration`;
    rumbleWeak: `${TextUpper}RumbleWeak`;
    rumbleStrong: `${TextUpper}RumbleStrong`;
  };
};

const textMap: TextMap = {
  info: {
    text: 'infoText',
    upperText: 'InfoText',
    upperSound: 'InfoSound',
    upperSoundVolume: 'InfoSoundVolume',
    rumbleDuration: 'InfoRumbleDuration',
    rumbleWeak: 'InfoRumbleWeak',
    rumbleStrong: 'InfoRumbleStrong',
  },
  alert: {
    text: 'alertText',
    upperText: 'AlertText',
    upperSound: 'AlertSound',
    upperSoundVolume: 'AlertSoundVolume',
    rumbleDuration: 'AlertRumbleDuration',
    rumbleWeak: 'AlertRumbleWeak',
    rumbleStrong: 'AlertRumbleStrong',
  },
  alarm: {
    text: 'alarmText',
    upperText: 'AlarmText',
    upperSound: 'AlarmSound',
    upperSoundVolume: 'AlarmSoundVolume',
    rumbleDuration: 'AlarmRumbleDuration',
    rumbleWeak: 'AlarmRumbleWeak',
    rumbleStrong: 'AlarmRumbleStrong',
  },
};

const isObject = (x: unknown): x is { [key: string]: unknown } => {
  // JavaScript considers [] to be an object, so check for that explicitly.
  return x instanceof Object && !Array.isArray(x);
};

// User trigger may pass anything as parameters
type TriggerParams = { [key: string]: unknown };

export class TriggerOutputProxy {
  public outputStrings: OutputStrings;
  public overrideStrings: OutputStrings = {};
  public responseOutputStrings: { [outputName: string]: unknown } = {};
  public unknownValue = '???';

  private constructor(
    public trigger: ProcessedTrigger,
    public displayLang: Lang,
    public perTriggerAutoConfig?: PerTriggerAutoConfig,
  ) {
    this.outputStrings = trigger.outputStrings ?? {};

    if (trigger.id !== undefined && perTriggerAutoConfig) {
      const config = perTriggerAutoConfig[trigger.id];
      if (config && config.OutputStrings)
        this.overrideStrings = config.OutputStrings;
    }

    return new Proxy(this, {
      // Response output string subtlety:
      // Take this example response:
      //
      //    response: (data, matches, output) => {
      //      return {
      //        alarmText: output.someAlarm(),
      //        outputStrings: { someAlarm: 'string' }, // <- impossible
      //      };
      //    },
      //
      // Because the object being returned is evaluated all at once, the object
      // cannot simultaneously define outputStrings and use those outputStrings.
      // So, instead, responses need to set `output.responseOutputStrings`.
      // HOWEVER, this also has its own issues!  This value is set for the trigger
      // (which may have multiple active in flight instances).  This *should* be
      // ok because we guarantee that response/alarmText/alertText/infoText/tts
      // are evaluated sequentially for a single trigger before any other trigger
      // instance evaluates that set of triggers.  Finally, for ease of automating
      // the config ui, the response should return the exact same set of
      // outputStrings every time.  Thank you for coming to my TED talk.
      set(target, property, value): boolean {
        if (property === 'responseOutputStrings') {
          if (isObject(value)) {
            target[property] = value;
            return true;
          }
          console.error(
            `Invalid responseOutputStrings on trigger ${target.trigger.id ?? 'Unknown'}`,
          );
          return false;
        }

        // Be kind to user triggers that do weird things, and just console error this
        // instead of throwing an exception.
        console.error(`Invalid property '${String(property)}' on output.`);
        return false;
      },

      get(target, name) {
        // TODO: add a test that verifies nobody does this.
        if (name === 'toJSON' || typeof name !== 'string')
          return '{}';

        // Because output.func() must exist at the time of trigger eval,
        // always provide a function even before we know which keys are valid.
        return (params?: TriggerParams) => {
          const id = target.trigger.id ?? 'Unknown Trigger';

          // Priority: per-trigger config from ui > response > built-in trigger
          // Ideally, response provides everything and trigger provides nothing,
          // or there's no response and trigger provides everything.  Having
          // this well-defined smooths out the collision edge cases.
          let str = target.getReplacement(target.overrideStrings[name], params, name, id);
          if (str === undefined) {
            const responseString = target.responseOutputStrings[name];
            if (isObject(responseString))
              str = target.getReplacement(responseString, params, name, id);
          }
          if (str === undefined)
            str = target.getReplacement(target.outputStrings[name], params, name, id);
          if (str === undefined) {
            console.error(`Trigger ${target.trigger.id ?? ''} has missing outputString ${name}.`);
            return target.unknownValue;
          }
          return str;
        };
      },
    });
  }

  evaluateOutputParam(
    id: string,
    key: string,
    val: unknown,
    prop?: string,
    isNestedArray?: boolean,
  ): string {
    if (typeof val === 'string' || typeof val === 'number')
      return val.toString();
    if (typeof val !== 'object') {
      console.error(`Trigger ${id} has non-string param value ${key}.`);
      return this.unknownValue;
    }

    if (Array.isArray(val)) {
      // Don't allow nesting arrays here, e.g. [player1, [player2, player3]].
      if (isNestedArray) {
        console.error(`Trigger ${id} passed nested arrays to param value ${key}.`);
        return this.unknownValue;
      }

      // If a trigger passes in [player1, player2, player3] as a value,
      // and a user specifies `${players.job}`, then return:
      // `${players[0].job}, ${players[1].job}, ${players[2].job}`.
      // In general, this means that all array elements must either be simple
      // strings/numbers or all share the same prop, or there will be errors below
      // about non-existent properties. In practice, this likely will never happen.
      //
      // Also, this assumes that all locales are ok with ", " as a separator.
      // This seems to be true in practice.
      return val.map((p) => this.evaluateOutputParam(id, key, p, prop, true)).join(', ');
    }

    // Appease TypeScript, this shouldn't happen.
    if (!isObject(val))
      return this.unknownValue;

    if (prop !== undefined) {
      const retVal = val[prop];
      if (typeof retVal === 'string' || typeof retVal === 'number')
        return retVal.toString();

      if (retVal === undefined || retVal === null) {
        console.error(
          `Trigger ${id} is referencing non-existent object property ${key}.${prop}.`,
        );
      } else {
        console.error(
          `Trigger ${id} is referencing object property ${key}.${prop} with incorrect type ${typeof retVal}.`,
        );
      }
    }

    // At this point, we're going to try to return a default value if we can,
    // either from an error or because `prop` was unspecified.
    const toStringFunc = val['toString'];
    if (typeof toStringFunc !== 'function') {
      console.error(
        `Trigger ${id} has non-func ${key}.toString property.`,
      );
      return this.unknownValue;
    }

    const toStringVal: unknown = toStringFunc();
    if (typeof toStringVal !== 'string' && typeof toStringVal !== 'number') {
      console.error(
        `Trigger ${id} returned non-string ${typeof toStringVal} from ${key}.toString().`,
      );
      return this.unknownValue;
    }
    return toStringVal.toString();
  }

  getReplacement(
    // Can't use optional modifier for this arg since the others aren't optional
    template: { [lang: string]: unknown } | string | undefined,
    params: TriggerParams | undefined,
    name: string,
    id: string,
  ): string | undefined {
    // If an output strings entry is edited in the config UI and then blanked,
    // the entry will still exist in the config file as an empty string.
    // These should be ignored as not being an override.
    // TODO: maybe blanked/default entries should be deleted from the config?
    if (template === undefined || template === '')
      return;

    let value: unknown;
    if (typeof template === 'string')
      // user config
      value = template;
    else
      value = template[this.displayLang] ?? template['en'];

    if (typeof value !== 'string') {
      console.error(`Trigger ${id} has invalid outputString ${name}.`, JSON.stringify(template));
      return;
    }

    return value.replace(/\${\s*([^}\s]+)\s*}/g, (_fullMatch: string, key: string) => {
      if (params !== undefined) {
        let prop: string | undefined = undefined;

        if (!(key in params) && key.includes('.')) {
          const parts = key.split('.');
          // Only a warning here (for user triggers), but mocha tests will error out for this case
          // If the user specifies extra parts, just ignore them
          if (parts.length > 2)
            console.warn(`Trigger ${id} has extra path parts for object parameter ${key}.`);
          key = parts[0] ?? '';
          prop = parts[1];
        }

        if (key in params) {
          const val = params[key];
          return this.evaluateOutputParam(id, key, val, prop);
        }
      }

      console.error(`Trigger ${id} can't replace ${key} in ${JSON.stringify(template)}.`);
      return this.unknownValue;
    });
  }

  static makeOutput(
    trigger: ProcessedTrigger,
    displayLang: Lang,
    perTriggerAutoConfig?: PerTriggerAutoConfig,
  ): Output {
    // `Output` is the common type used for the trigger data interface to support arbitrary
    // string keys and always returns a string. However, TypeScript doesn't have good support
    // for the Proxy representing this structure so we need to cast Proxy => unknown => Output
    return new TriggerOutputProxy(trigger, displayLang, perTriggerAutoConfig) as unknown as Output;
  }
}

export type RaidbossTriggerField =
  | TriggerField<RaidbossData, Matches, TriggerOutput<RaidbossData, Matches>>
  | TriggerField<RaidbossData, Matches, PartialTriggerOutput<RaidbossData, Matches>>;
export type RaidbossTriggerOutput =
  | TriggerOutput<RaidbossData, Matches>
  | PartialTriggerOutput<RaidbossData, Matches>;

const defaultOutput = TriggerOutputProxy.makeOutput({}, 'en');

export interface TriggerHelper {
  valueOrFunction: (f: RaidbossTriggerField) => RaidbossTriggerOutput;
  trigger: ProcessedTrigger;
  now: number;
  triggerOptions: PerTriggerOption;
  triggerAutoConfig: TriggerAutoConfig;
  // This setting only suppresses output, trigger still runs for data/logic purposes
  userSuppressedOutput: boolean;
  matches: Matches;
  response?: ResponseOutput<RaidbossData, Matches>;
  // Default options
  soundUrl?: string;
  soundVol?: number;
  triggerSoundVol?: number;
  defaultTTSText?: string;
  textAlertsEnabled: boolean;
  soundAlertsEnabled: boolean;
  spokenAlertsEnabled: boolean;
  groupSpokenAlertsEnabled: boolean;
  duration?: {
    fromConfig?: number;
    fromTrigger?: number;
    alarmText: number;
    alertText: number;
    infoText: number;
  };
  adjustedDelay?: number;
  countdown?: number;
  ttsText?: string;
  rumbleDurationMs?: number;
  rumbleWeak?: number;
  rumbleStrong?: number;
  output: Output;
}


export interface WorkerOutputs {
  text(helper: TriggerHelper, text: string, level: Text, duration: number): void;
  say(helper: TriggerHelper, text: string): void;
  play(helper: TriggerHelper, path: string, volume?: number): void;
  fault(trigger: ProcessedTrigger, error: unknown): void;
}
export class WorkerCallbacks {
  private generation = 0;
  private triggerSuppress: Record<string, number> = {};
  private faulted = new Set<ProcessedTrigger>();
  private controllers = new Map<ProcessedTrigger, AbortController>();
  constructor(public data: RaidbossData, public options: RaidbossOptions,
    private clock: ClockService, private outputs: WorkerOutputs) {}
  get displayLang(): Lang { return this.options.DisplayLanguage; }
  controller(trigger: ProcessedTrigger): AbortController {
    let controller = this.controllers.get(trigger);
    if (!controller) { controller = new AbortController(); this.controllers.set(trigger, controller); }
    return controller;
  }
  reset(): void {
    ++this.generation;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear(); this.faulted.clear(); this.triggerSuppress = {};
  }
  fault(trigger: ProcessedTrigger, error: unknown): void {
    if (this.faulted.has(trigger)) return;
    this.faulted.add(trigger); this.controller(trigger).abort(); this.outputs.fault(trigger, error);
  }
  cancel(trigger: ProcessedTrigger): void {
    this.faulted.add(trigger); this.controller(trigger).abort();
  }
  guarded(trigger: ProcessedTrigger, run: () => void): void {
    try { run(); } catch (error) { this.fault(trigger, error); }
  }
  run(trigger: ProcessedTrigger, matches: Matches, now: number): void {
    trigger.output ??= TriggerOutputProxy.makeOutput(trigger, this.displayLang);
    const captured = Object.assign([], { groups: matches }) as unknown as RegExpExecArray;
    this.guarded(trigger, () => this.OnTriggerInternal(trigger, captured, now));
  }
  OnTriggerInternal(
    trigger: ProcessedTrigger,
    matches: RegExpExecArray | null,
    currentTime: number,
  ): void {
    const generation = this.generation;
    if (this.faulted.has(trigger)) return;
    if (this._onTriggerInternalCheckSuppressed(trigger, currentTime))
      return;

    let groups: Matches = {};
    // If using named groups, treat matches.groups as matches
    // so triggers can do things like matches.target.
    if (matches && matches.groups) {
      groups = matches.groups;
    } else if (matches) {
      // If there are no matching groups, reproduce the old js logic where
      // groups ended up as the original RegExpExecArray object
      matches.forEach((value, idx) => {
        groups[idx] = value;
      });
    }

    // Set up a helper object so we don't have to throw
    // a ton of info back and forth between subfunctions
    const triggerHelper = this._onTriggerInternalGetHelper(trigger, groups, currentTime);

    if (!this._onTriggerInternalCondition(triggerHelper))
      return;

    this._onTriggerInternalPreRun(triggerHelper);

    // Evaluate for delay here, but run delay later
    const delayPromise = this._onTriggerInternalDelaySeconds(triggerHelper);
    this._onTriggerInternalDurationSeconds(triggerHelper);
    this._onTriggerInternalSuppressSeconds(triggerHelper);
    this._onTriggerInternalCountdownSeconds(triggerHelper);

    const triggerPostDelay = () => {
      if (generation !== this.generation || this.faulted.has(trigger)) return;
      const promise = this._onTriggerInternalPromise(triggerHelper);
      const triggerPostPromise = () => {
        if (generation !== this.generation || this.faulted.has(trigger)) return;
        this._onTriggerInternalSound(triggerHelper);
        this._onTriggerInternalSoundVolume(triggerHelper);
        this._onTriggerInternalResponse(triggerHelper);
        this._onTriggerInternalAlarmText(triggerHelper);
        this._onTriggerInternalAlertText(triggerHelper);
        this._onTriggerInternalInfoText(triggerHelper);

        // Rumble isn't a trigger function, so only needs to be ordered
        // after alarm/alert/info.
        // Rumble is unsupported in the Worker capability contract.

        // Priority audio order:
        // * user disabled (play nothing)
        // * if tts options are enabled globally or for this trigger:
        //   * user TTS triggers tts override
        //   * tts entries in the trigger
        //   * default alarm tts
        //   * default alert tts
        //   * default info tts
        // * if sound options are enabled globally or for this trigger:
        //   * user trigger sound overrides
        //   * sound entries in the trigger
        //   * alarm noise
        //   * alert noise
        //   * info noise
        // * else, nothing
        //
        // In general, tts comes before sounds and user overrides come
        // before defaults.  If a user trigger or tts entry is specified as
        // being valid but empty, this will take priority over the default
        // tts texts from alarm/alert/info and will prevent tts from playing
        // and allowing sounds to be played instead.
        this._onTriggerInternalTTS(triggerHelper);
        this._onTriggerInternalPlayAudio(triggerHelper);
        this._onTriggerInternalRun(triggerHelper);
      };

      // The trigger body must run synchronously when there is no promise.
      if (promise)
        void promise.then(() => this.guarded(trigger, triggerPostPromise)).catch((e) => { if (generation === this.generation) this.fault(trigger, e); });
      else
        triggerPostPromise();
    };

    // The trigger body must run synchronously when there is no delay.
    if (delayPromise)
      void delayPromise.then(() => this.guarded(trigger, triggerPostDelay)).catch((e) => { if (generation === this.generation) this.fault(trigger, e); });
    else
      triggerPostDelay();
  }

  // Build a default triggerHelper object for this trigger
  _onTriggerInternalGetHelper(
    trigger: ProcessedTrigger,
    matches: Matches,
    now: number,
  ): TriggerHelper {
    const id = trigger.id;
    let options: PerTriggerOption = {};
    let config: TriggerAutoConfig = {};
    let suppressed = false;
    if (id !== undefined) {
      options = this.options.PerTriggerOptions[id] ?? options;
      config = this.options.PerTriggerAutoConfig[id] ?? config;
      suppressed = this.options.DisabledTriggers[id] ?? suppressed;
    }

    const triggerHelper: TriggerHelper = {
      trigger: trigger,
      now: now,
      triggerOptions: options,
      triggerAutoConfig: config,
      // This setting only suppresses output, trigger still runs for data/logic purposes
      userSuppressedOutput: suppressed,
      matches: matches,
      // Default options
      textAlertsEnabled: this.options.TextAlertsEnabled,
      soundAlertsEnabled: this.options.SoundAlertsEnabled,
      spokenAlertsEnabled: this.options.SpokenAlertsEnabled,
      groupSpokenAlertsEnabled: this.options.GroupSpokenAlertsEnabled,
      valueOrFunction: (f: RaidbossTriggerField): RaidbossTriggerOutput => {
        let result = f;
        if (typeof result === 'function')
          result = result(this.data, triggerHelper.matches, triggerHelper.output);
        // All triggers return either a string directly, or an object
        // whose keys are different parser language based names.  For simplicity,
        // this is valid to do for any trigger entry that can handle a function.
        // In case anybody wants to encapsulate any fancy grammar, the values
        // in this object can also be functions.
        if (typeof result !== 'object' || result === null)
          return result;
        return triggerHelper.valueOrFunction(result[this.displayLang] ?? result['en']);
      },
      get output(): Output {
        if (this.trigger.output)
          return this.trigger.output;

        console.log(`Missing trigger.output for trigger ${trigger.id ?? 'Unknown'}`);
        return defaultOutput;
      },
    };

    this._onTriggerInternalHelperDefaults(triggerHelper);

    return triggerHelper;
  }

  _onTriggerInternalCheckSuppressed(trigger: ProcessedTrigger, when: number): boolean {
    const id = trigger.id;
    if (id !== undefined) {
      const suppress = this.triggerSuppress[id];
      if (suppress !== undefined) {
        if (suppress > when)
          return true;

        delete this.triggerSuppress[id];
      }
    }
    return false;
  }

  _onTriggerInternalCondition(triggerHelper: TriggerHelper): boolean {
    const condition = triggerHelper.triggerOptions.Condition ?? triggerHelper.trigger.condition;
    // If the condition is missing or hardcoded as `true`
    if (condition === undefined || condition === true)
      return true;
    // If the condition is hardcoded as `false`
    else if (condition === false)
      return false;

    const conditionFuncReturn = condition(this.data, triggerHelper.matches, triggerHelper.output);
    if (conditionFuncReturn === true)
      return true;
    // Treat all other return values as false (undefined | false)
    return false;
  }

  // Set defaults for triggerHelper object (anything that won't change based on
  // other trigger functions running)
  _onTriggerInternalHelperDefaults(triggerHelper: TriggerHelper): void {
    // Options priority:
    // backcompat triggerOptions > trigger autoconfig > trigger set autoconfig > top level option
    triggerHelper.textAlertsEnabled = triggerHelper.triggerOptions.TextAlert ??
      triggerHelper.triggerAutoConfig.TextAlertsEnabled ??
      triggerHelper.trigger.triggerSetAutoConfig?.TextAlertsEnabled ??
      triggerHelper.textAlertsEnabled;
    triggerHelper.soundAlertsEnabled = triggerHelper.triggerOptions.SoundAlert ??
      triggerHelper.triggerAutoConfig.SoundAlertsEnabled ??
      triggerHelper.trigger.triggerSetAutoConfig?.SoundAlertsEnabled ??
      triggerHelper.soundAlertsEnabled;
    triggerHelper.spokenAlertsEnabled = triggerHelper.triggerOptions.SpeechAlert ??
      triggerHelper.triggerAutoConfig.SpokenAlertsEnabled ??
      triggerHelper.trigger.triggerSetAutoConfig?.SpokenAlertsEnabled ??
      triggerHelper.spokenAlertsEnabled;

    // Load settings from triggerOptions if they're set
    triggerHelper.groupSpokenAlertsEnabled = triggerHelper.triggerOptions.GroupSpeechAlert ??
      triggerHelper.groupSpokenAlertsEnabled;

    // If the user has suppressed all output for the trigger, reflect that here
    if (triggerHelper.userSuppressedOutput) {
      triggerHelper.textAlertsEnabled = false;
      triggerHelper.soundAlertsEnabled = false;
      triggerHelper.spokenAlertsEnabled = false;
      triggerHelper.groupSpokenAlertsEnabled = false;
    }

    // If the user has disabled audio output, reflect that here
    if (!this.options.AudioAllowed) {
      triggerHelper.soundAlertsEnabled = false;
      triggerHelper.spokenAlertsEnabled = false;
      triggerHelper.groupSpokenAlertsEnabled = false;
    }
  }

  _onTriggerInternalPreRun(triggerHelper: TriggerHelper): void {
    triggerHelper.trigger?.preRun?.(
      this.data,
      triggerHelper.matches,
      triggerHelper.output,
    );
  }

  _onTriggerInternalDelaySeconds(helper: TriggerHelper): Promise<void> | undefined {
    const delay = 'delaySeconds' in helper.trigger ? helper.valueOrFunction(helper.trigger.delaySeconds) : 0;
    if (typeof delay !== 'number') return;
    const adjusted = Math.max(delay, 0);
    if (adjusted <= 0) return;
    helper.adjustedDelay = adjusted;
    return this.clock.sleep(adjusted * 1000, { signal: this.controller(helper.trigger).signal });
  }
  _onTriggerInternalDurationSeconds(triggerHelper: TriggerHelper): void {
    let valueDuration = triggerHelper.valueOrFunction(triggerHelper.trigger.durationSeconds);
    if (typeof valueDuration !== 'number')
      valueDuration = undefined;
    triggerHelper.duration = {
      fromConfig: triggerHelper.triggerAutoConfig.Duration,
      fromTrigger: valueDuration,
      alarmText: this.options.DisplayAlarmTextForSeconds,
      alertText: this.options.DisplayAlertTextForSeconds,
      infoText: this.options.DisplayInfoTextForSeconds,
    };
  }

  _onTriggerInternalSuppressSeconds(triggerHelper: TriggerHelper): void {
    const suppress = 'suppressSeconds' in triggerHelper.trigger
      ? triggerHelper.valueOrFunction(triggerHelper.trigger.suppressSeconds)
      : 0;
    if (typeof suppress !== 'number')
      return;
    if (triggerHelper.trigger.id !== undefined && suppress > 0)
      this.triggerSuppress[triggerHelper.trigger.id] = triggerHelper.now + suppress * 1000;
  }

  _onTriggerInternalCountdownSeconds(triggerHelper: TriggerHelper): void {
    let valueCountdown = triggerHelper.valueOrFunction(triggerHelper.trigger.countdownSeconds);
    if (typeof valueCountdown !== 'number')
      valueCountdown = undefined;
    triggerHelper.countdown = valueCountdown;
  }

  _onTriggerInternalPromise(triggerHelper: TriggerHelper): Promise<void> | undefined {
    let promise: Promise<void> | undefined;
    if ('promise' in triggerHelper.trigger) {
      const id = triggerHelper.trigger.id ?? 'Unknown';
      if (typeof triggerHelper.trigger.promise === 'function') {
        promise = triggerHelper.trigger.promise(
          this.data,
          triggerHelper.matches,
          triggerHelper.output,
        );

        // Make sure we actually get a Promise back from the function
        if (Promise.resolve(promise) !== promise) {
          console.error(`Trigger ${id}: promise function did not return a promise`);
          promise = undefined;
        }
      } else {
        console.error(`Trigger ${id}: promise defined but not a function`);
      }
    }
    return promise;
  }

  _onTriggerInternalSound(triggerHelper: TriggerHelper): void {
    const result = triggerHelper.valueOrFunction(triggerHelper.trigger.sound);
    if (typeof result === 'string')
      triggerHelper.soundUrl = result;
  }

  _onTriggerInternalSoundVolume(triggerHelper: TriggerHelper): void {
    const result = triggerHelper.valueOrFunction(triggerHelper.trigger.soundVolume);
    if (typeof result === 'number')
      triggerHelper.triggerSoundVol = result;
  }

  _onTriggerInternalResponse(triggerHelper: TriggerHelper): void {
    let response: ResponseField<RaidbossData, Matches> = {};
    const trigger = triggerHelper.trigger;
    if (trigger.response) {
      // Can't use ValueOrFunction here as r returns a non-localizable object.
      response = trigger.response;
      while (typeof response === 'function')
        response = response(this.data, triggerHelper.matches, triggerHelper.output);

      // Turn falsy values into a default no-op response.
      if (!response)
        response = {};
    }
    triggerHelper.response = response;
  }

  _onTriggerInternalAlarmText(triggerHelper: TriggerHelper): void {
    this._addTextFor('alarm', triggerHelper);
  }

  _onTriggerInternalAlertText(triggerHelper: TriggerHelper): void {
    this._addTextFor('alert', triggerHelper);
  }

  _onTriggerInternalInfoText(triggerHelper: TriggerHelper): void {
    this._addTextFor('info', triggerHelper);
  }

  _onTriggerInternalTTS(triggerHelper: TriggerHelper): void {
    if (!triggerHelper.groupSpokenAlertsEnabled || typeof triggerHelper.ttsText === 'undefined') {
      let result = undefined;
      if (triggerHelper.triggerOptions.TTSText !== undefined) {
        result = triggerHelper.valueOrFunction(triggerHelper.triggerOptions.TTSText);
      } else if (triggerHelper.trigger.tts !== undefined) {
        // Allow null/false/NaN/0/'' in this branch.
        result = triggerHelper.valueOrFunction(triggerHelper.trigger.tts);
      } else if (triggerHelper.response) {
        const resp: ResponseField<RaidbossData, Matches> = triggerHelper.response;
        if (resp.tts !== undefined)
          result = triggerHelper.valueOrFunction(resp.tts);
      }

      // Allow falsey values to disable tts entirely
      // Undefined will fall back to defaultTTSText
      if (result !== undefined) {
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (result)
          // FIXME:
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          triggerHelper.ttsText = result?.toString();
      } else {
        triggerHelper.ttsText = triggerHelper.defaultTTSText;
      }
    }
  }

  _onTriggerInternalPlayAudio(triggerHelper: TriggerHelper): void {
    if (
      triggerHelper.trigger.sound !== undefined &&
      triggerHelper.soundUrl !== undefined &&
      soundStrs.includes(triggerHelper.soundUrl)
    ) {
      const namedSound = `${triggerHelper.soundUrl}Sound`;
      const namedSoundVolume = `${triggerHelper.soundUrl}SoundVolume`;
      const sound = this.options[namedSound];
      if (typeof sound === 'string') {
        triggerHelper.soundUrl = sound;
        const soundVol = this.options[namedSoundVolume];
        if (typeof soundVol === 'number')
          triggerHelper.soundVol = soundVol;
      }
    }

    triggerHelper.soundUrl = triggerHelper.triggerOptions.SoundOverride ?? triggerHelper.soundUrl;
    triggerHelper.soundVol = triggerHelper.triggerOptions.VolumeOverride ??
      triggerHelper.triggerSoundVol ?? triggerHelper.soundVol;

    // Text to speech overrides all other sounds.  This is so
    // that a user who prefers tts can still get the benefit
    // of infoText triggers without tts entries by turning
    // on (speech=true, text=true, sound=true) but this will
    // not cause tts to play over top of sounds or noises.
    if (triggerHelper.ttsText !== undefined && triggerHelper.spokenAlertsEnabled) {
      // Heuristics for auto tts.
      // * In case this is an integer.
      triggerHelper.ttsText = triggerHelper.ttsText.toString();
      // * Remove a bunch of chars.
      triggerHelper.ttsText = triggerHelper.ttsText.replace(/[#!]/g, '');
      // * slashes between mechanics
      triggerHelper.ttsText = triggerHelper.ttsText.replace('/', ' ');
      // * tildes at the end for emphasis
      triggerHelper.ttsText = triggerHelper.ttsText.replace(/~+$/, '');
      // * arrows helping visually simple to understand e.g. ↖ Front left / Back right ↘
      triggerHelper.ttsText = triggerHelper.ttsText.replace(/[↖-↙]/g, '');
      // * Korean TTS reads wrong with '1번째'
      triggerHelper.ttsText = triggerHelper.ttsText.replace('1번째', '첫번째');
      // * arrows at the front or the end are directions, e.g. "east =>"
      triggerHelper.ttsText = triggerHelper.ttsText.replace(/[-=]+>\s*$/g, '');
      triggerHelper.ttsText = triggerHelper.ttsText.replace(/^\s*<[-=]+/g, '');
      // * arrows in the middle are a sequence, e.g. "in => out => spread"
      const arrowReplacement = {
        en: ' then ',
        de: ' dann ',
        fr: ' puis ',
        ja: 'や',
        cn: '然后',
        ko: ' 그리고 ',
        tc: '然後',
      };
      triggerHelper.ttsText = triggerHelper.ttsText.replace(
        /\s*(<[-=]|[=-]>)\s*/g,
        arrowReplacement[this.displayLang],
      );
      // * Countdown substitution marker, if present
      triggerHelper.ttsText = triggerHelper.ttsText.replaceAll('{{CD}}', '');

      this.outputs.say(triggerHelper, triggerHelper.ttsText);
    } else if (triggerHelper.soundUrl !== undefined && triggerHelper.soundAlertsEnabled) {
      this.outputs.play(triggerHelper, triggerHelper.soundUrl, triggerHelper.soundVol);
    }
  }

  _onTriggerInternalRun(triggerHelper: TriggerHelper): void {
    triggerHelper.trigger?.run?.(
      this.data,
      triggerHelper.matches,
      triggerHelper.output,
    );
  }

  _addTextFor(textType: Text, triggerHelper: TriggerHelper): void {
    // infoText
    const lowerTextKey = textMap[textType].text;
    // InfoText
    const upperTextKey = textMap[textType].upperText;
    // InfoSound
    const upperSound = textMap[textType].upperSound;
    // InfoSoundVolume
    const upperSoundVolume = textMap[textType].upperSoundVolume;

    let textObj: RaidbossTriggerOutput = triggerHelper.triggerOptions[upperTextKey];
    if (textObj === undefined && triggerHelper.trigger[lowerTextKey] !== undefined)
      textObj = triggerHelper.trigger[lowerTextKey];
    if (textObj === undefined && triggerHelper.response !== undefined)
      textObj = triggerHelper.response[lowerTextKey];
    if (textObj === undefined || textObj === null)
      return;
    let text = triggerHelper.valueOrFunction(textObj);
    if (text === undefined || text === null)
      return;
    if (typeof text === 'number')
      text = text.toString();
    if (typeof text !== 'string')
      text = String(text);
    // Ignore empty strings so that config ui "blank spaces" are ignored.
    text = text.trim();
    if (text === '')
      return;

    text = this.options.TransformText(text) ?? text;
    triggerHelper.defaultTTSText = triggerHelper.defaultTTSText ?? text;
    if (text && typeof text === 'string' && triggerHelper.textAlertsEnabled) {
      // per-trigger option > trigger field > option duration by text type
      let duration = triggerHelper.duration?.fromConfig ?? triggerHelper.duration?.fromTrigger;
      if (duration === undefined && triggerHelper.duration)
        duration = triggerHelper.duration[lowerTextKey];
      duration = Math.max(duration ?? 0, triggerHelper.countdown ?? 0);

      this.outputs.text(triggerHelper, text, textType, duration);
      if (triggerHelper.soundUrl === undefined) {
        triggerHelper.soundUrl = this.options[upperSound];
        triggerHelper.soundVol = this.options[upperSoundVolume];
      }
      if (triggerHelper.rumbleDurationMs === undefined) {
        triggerHelper.rumbleDurationMs = this.options[textMap[textType].rumbleDuration];
        triggerHelper.rumbleWeak = this.options[textMap[textType].rumbleWeak];
        triggerHelper.rumbleStrong = this.options[textMap[textType].rumbleStrong];
      }
    }
  }

}
