# Upstream provenance

Rule corpus and required runtime files from https://github.com/quisquous/cactbot at
`e79ea7f16093be5b80cda0e2d5bc8eb899d6fb4b`, under the included Apache-2.0 LICENSE.
Original file paths are retained. No upstream NOTICE file was present.

Mojito adaptations are documented here as they are introduced. Source files are
preserved in this directory so algorithm changes remain reviewable against the
pinned upstream. This is not a claim of complete cactbot compatibility.

- `resources/overlay_plugin_api.ts` is a replacement query boundary, not upstream
  WebSocket/DOM transport. Unbound calls fail.
- `raidboss_options.ts` uses Worker defaults and reports unavailable ACT/OverlayPlugin
  versions. Browser user-config evaluation is omitted; configuration stays data-only.
- `resources/user_config.d.ts` declares the data subset needed here, without the
  upstream browser configuration loader or eval.

- `ui/raidboss/worker_callbacks.ts` extracts the output proxy, trigger helper,
  callback ordering, response/text selection and TTS transforms from popup-text.ts.
  Clock delays, generation/fault cancellation and outputs replace browser facilities.
- `timeline_parser.ts` retains parsing/windows/labels/jumps/duration/translation;
  structured sync uses Mojito's field matcher. Legacy log sync fails the timeline.
- `timeline.ts` retains scheduling/jump/bar algorithms, injects session-clock timers,
  and accepts structured events. Browser/log-line controllers are omitted. Parser
  errors or a required missing sync field stop the timeline through the caller.
- `netlog_defs.ts` wraps its existing console assertion in Boolean for current TS DOM types.
- `types/event.d.ts` makes Party.worldId optional, so unavailable worlds are not
  fabricated while real entity classJob still drives PartyTracker roles.
- `src/fixtures/upstream-order.ts` is a test-only extraction of the original
  OnTriggerInternal sequence. Synthetic P1N tests compare original log matching
  and that sequence against structured matching; shared output helpers mean this
  does not independently validate browser rendering, speech, or real recordings.
