/** The speeds of the host's recording replay, which the speed button cycles through */
export const SPEEDS = [1, 2, 5, 10] as const

export const nextSpeed = (speed: number) => SPEEDS[(SPEEDS.indexOf(speed as never) + 1) % SPEEDS.length]

/** A playback started at a review time and a moment of real time */
export interface Clock {
  from: number
  startedAt: number
  speed: number
}

/** Starts playing at the time, or from the start when it is at the end */
export const play = (time: number, durationMs: number, now: number, speed: number): Clock => ({
  from: time >= durationMs ? 0 : time,
  startedAt: now,
  speed,
})

/** The review time of the playback at a moment of real time, and whether it reached the end */
export function playhead(clock: Clock, now: number, durationMs: number): { time: number; ended: boolean } {
  const time = clock.from + (now - clock.startedAt) * clock.speed
  return time >= durationMs ? { time: durationMs, ended: true } : { time, ended: false }
}
