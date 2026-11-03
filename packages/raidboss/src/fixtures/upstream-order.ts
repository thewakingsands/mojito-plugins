// Test oracle: unchanged OnTriggerInternal sequence from cactbot e79ea7f popup-text.ts.
// Common output helpers are shared; this comparison covers ordering and matching, not real UI/audio.
import type { Matches } from '../../vendor/cactbot/types/net_matches'
import {
  type ProcessedTrigger,
  type TriggerHelper,
  WorkerCallbacks,
} from '../../vendor/cactbot/ui/raidboss/worker_callbacks'

const onTriggerException = (_trigger: ProcessedTrigger, error: unknown) => {
  throw error
}
export class UpstreamOrder extends WorkerCallbacks {
  _onTriggerInternalRumble(_helper: TriggerHelper): void {}
  override OnTriggerInternal(trigger: ProcessedTrigger, matches: RegExpExecArray | null, currentTime: number): void {
    if (this._onTriggerInternalCheckSuppressed(trigger, currentTime)) return

    let groups: Matches = {}
    // If using named groups, treat matches.groups as matches
    // so triggers can do things like matches.target.
    // biome-ignore lint/complexity/useOptionalChain: Preserve the upstream reference branch.
    if (matches && matches.groups) {
      groups = matches.groups
    } else if (matches) {
      // If there are no matching groups, reproduce the old js logic where
      // groups ended up as the original RegExpExecArray object
      matches.forEach((value, idx) => {
        groups[idx] = value
      })
    }

    // Set up a helper object so we don't have to throw
    // a ton of info back and forth between subfunctions
    const triggerHelper = this._onTriggerInternalGetHelper(trigger, groups, currentTime)

    if (!this._onTriggerInternalCondition(triggerHelper)) return

    this._onTriggerInternalPreRun(triggerHelper)

    // Evaluate for delay here, but run delay later
    const delayPromise = this._onTriggerInternalDelaySeconds(triggerHelper)
    this._onTriggerInternalDurationSeconds(triggerHelper)
    this._onTriggerInternalSuppressSeconds(triggerHelper)
    this._onTriggerInternalCountdownSeconds(triggerHelper)

    const triggerPostDelay = () => {
      const promise = this._onTriggerInternalPromise(triggerHelper)
      const triggerPostPromise = () => {
        this._onTriggerInternalSound(triggerHelper)
        this._onTriggerInternalSoundVolume(triggerHelper)
        this._onTriggerInternalResponse(triggerHelper)
        this._onTriggerInternalAlarmText(triggerHelper)
        this._onTriggerInternalAlertText(triggerHelper)
        this._onTriggerInternalInfoText(triggerHelper)

        // Rumble isn't a trigger function, so only needs to be ordered
        // after alarm/alert/info.
        this._onTriggerInternalRumble(triggerHelper)

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
        this._onTriggerInternalTTS(triggerHelper)
        this._onTriggerInternalPlayAudio(triggerHelper)
        this._onTriggerInternalRun(triggerHelper)
      }

      // The trigger body must run synchronously when there is no promise.
      if (promise) promise.then(triggerPostPromise, (e) => onTriggerException(trigger, e))
      else triggerPostPromise()
    }

    // The trigger body must run synchronously when there is no delay.
    if (delayPromise) delayPromise.then(triggerPostDelay, (e) => onTriggerException(trigger, e))
    else triggerPostDelay()
  }
}
