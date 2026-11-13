# cactbot Eureka rules and weather calculation

Source: https://github.com/quisquous/cactbot/tree/8d12b650896aed42e56bcfe07c8580426ab2b9f8

The limited four-island NM rules in `src/exploration/rules.ts` derive from
`ui/eureka/zone_anemos.ts`, `zone_pagos.ts`, `zone_pyros.ts`, and `zone_hydatos.ts`.
The weather chance calculation in `src/exploration/weather.ts` derives from
`resources/weather.ts`. These files are distributed under Apache-2.0; the license
is included in `cactbot-LICENSE`.

Modifications: rules retain only FATE IDs, territory IDs, cooldown durations and
weather/night conditions. The SS classification in `src/exploration/catalog.ts`
also references the finite BNpcBase rules in `util/gen_hunt_data.py`.
Names, maps and weather distributions come from the
installed game client. Weather and night windows are intersected, and night starts
at 19:00 inclusive. Local observation times and uncertain cooldowns are tracked
separately from the upstream UI.

Weather IDs were matched against Weather and WeatherRate at
https://github.com/xivapi/ffxiv-datamining/tree/52a72b38aa2f967cab36867f34cd9bee9debb88b.

The upstream weather calculation credits SaintCoinach's WeatherRate.cs at
https://github.com/ufx/SaintCoinach/blob/4bf6d951957502a7faa056ffc1cc7026a18fb253/SaintCoinach/Xiv/WeatherRate.cs,
relicensed there from the WTFPL.
