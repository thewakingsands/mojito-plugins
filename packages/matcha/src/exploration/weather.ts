// Weather calculation adapted from cactbot; see ../../third-party/cactbot-NOTICE.md.
import type { ConditionWindow, WeatherRate } from './eureka-types.js'

export const EORZEA_HOUR_MS = 175_000
const DAY_MS = 24 * EORZEA_HOUR_MS
const WEATHER_MS = 8 * EORZEA_HOUR_MS

export function weatherChance(timeMs: number): number {
  const unix = Math.floor(timeMs / 1000)
  const bell = unix / 175
  const increment = (bell + 8 - (bell % 8)) % 24
  const totalDays = (unix / 4200) >>> 0
  const base = (totalDays * 100 + increment) >>> 0
  const step1 = ((base << 11) ^ base) >>> 0
  return (((step1 >>> 8) ^ step1) >>> 0) % 100
}

export function validWeatherRates(rates: readonly WeatherRate[] | null): rates is readonly WeatherRate[] {
  return (
    rates !== null &&
    rates.length > 0 &&
    rates.every(
      (entry) =>
        Number.isInteger(entry.weatherId) && entry.weatherId > 0 && Number.isFinite(entry.rate) && entry.rate > 0,
    ) &&
    rates.reduce((sum, entry) => sum + entry.rate, 0) === 100
  )
}

export function weatherAt(timeMs: number, rates: readonly WeatherRate[] | null): number | null {
  if (!Number.isFinite(timeMs) || timeMs < 0 || !validWeatherRates(rates)) return null
  const chance = weatherChance(timeMs)
  let cumulative = 0
  for (const entry of rates) {
    cumulative += entry.rate
    if (chance < cumulative) return entry.weatherId
  }
  return null
}

export function isNight(timeMs: number): boolean {
  const hour = (timeMs % DAY_MS) / EORZEA_HOUR_MS
  return hour >= 19 || hour < 6
}

function nextNightBoundary(timeMs: number): number {
  const day = Math.floor(timeMs / DAY_MS) * DAY_MS
  for (const hour of [6, 19, 30]) {
    const boundary = day + hour * EORZEA_HOUR_MS
    if (boundary > timeMs) return boundary
  }
  return day + DAY_MS
}

/** The current or next intersection, bounded to 512 weather/day changes. */
export function conditionWindow(
  from: number,
  weatherId: number | null,
  nightOnly: boolean,
  rates: readonly WeatherRate[] | null,
): ConditionWindow | null {
  if (!Number.isFinite(from) || from < 0) return null
  if (weatherId !== null && (!validWeatherRates(rates) || !rates.some((entry) => entry.weatherId === weatherId)))
    return null
  const weatherAlways = weatherId === null || rates?.every((entry) => entry.weatherId === weatherId)
  if (weatherAlways && !nightOnly) return { opensAt: from, closesAt: null }
  let opensAt: number | null = null
  let cursor = from
  for (let index = 0; index < 512; index++) {
    const weatherMatches = weatherAlways || weatherAt(cursor, rates) === weatherId
    const matches = weatherMatches && (!nightOnly || isNight(cursor))
    if (matches && opensAt === null) opensAt = cursor
    if (!matches && opensAt !== null) return { opensAt, closesAt: cursor }
    const weatherBoundary = weatherAlways ? Infinity : (Math.floor(cursor / WEATHER_MS) + 1) * WEATHER_MS
    const nightBoundary = nightOnly ? nextNightBoundary(cursor) : Infinity
    cursor = Math.min(weatherBoundary, nightBoundary)
  }
  return opensAt === null ? null : { opensAt, closesAt: null }
}
