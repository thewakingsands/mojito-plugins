import { expect, it } from 'vitest'
import { records } from '../../log/records.test-helper.js'
import { replay } from '../../log/replay.js'
import { ReplayBuilder } from '../../replay/builder.js'
import { buildMapScene, sceneAt } from './scene.js'
import { memberShown, poseAt } from './tracks.js'

/** The log holds player names, so it stays out of the repository and this test reads it from a path. */
const LOG = process.env.MOJITO_REVIEW_LOG
const END_MS = 377_000

it.skipIf(!LOG)(
  'splits the attached fight into the panes of the acceptance table',
  async () => {
    const all = await records(LOG!)
    const start = all.findIndex((record) => record.kind === 'fightStart')
    const fight = all[start]
    const end = all.find((record) => record.kind === 'fightEnd')
    if (fight?.kind !== 'fightStart' || end?.kind !== 'fightEnd') throw new Error('the log has no finished fight')
    const visitStart = all.slice(0, start).findLastIndex((record) => record.kind === 'visitStart')
    const visitEnd = all.findIndex((record, i) => i > start && record.kind === 'visitEnd')
    const visit = all.slice(visitStart, visitEnd < 0 ? undefined : visitEnd + 1)

    const builder = new ReplayBuilder(fight.id, { visitId: 'v', startAt: fight.startAt, endAt: end.endAt })
    const summaries = await replay(visit, builder)
    const summary = summaries.find((item) => item.id === fight.id)
    const data = builder.finish(summary?.outcome.mainEnemy?.key ?? null, {})
    expect(data.fight.durationMs).toBeGreaterThan(END_MS - 1000)

    const scene = buildMapScene(data)
    expect(scene.segments.map((segment) => segment.from)).toEqual([0, 250_000, 278_500, 300_250, 328_250, 333_000])
    const sizes = scene.segments.map((segment) =>
      segment.panes.map(({ pane }) => pane.members.length).sort((a, b) => b - a),
    )
    expect(sizes).toEqual([[8], [1, 1, 1, 1, 1, 1, 1, 1], [8], [6, 1, 1], [7, 1], [8]])

    // No member leaves the range of the opening stretch, so the view stays as it is until the party splits
    const opening = sceneAt(scene, 0)[0].box
    for (let time = 0; time < 250_000; time += 250) expect(sceneAt(scene, time)[0].box).toEqual(opening)

    for (let time = 0; time <= data.fight.durationMs; time += 250)
      for (const { pane, box } of sceneAt(scene, time)) {
        expect(Math.max(box.maxX - box.minX, box.maxZ - box.minZ, 30)).toBeLessThanOrEqual(40)
        for (const member of pane.members) {
          const track = data.actors[member].track
          if (!memberShown(track, time)) continue
          const pose = poseAt(track, time)!
          expect(pose.x).toBeGreaterThanOrEqual(box.minX - 1e-3)
          expect(pose.x).toBeLessThanOrEqual(box.maxX + 1e-3)
          expect(pose.z).toBeGreaterThanOrEqual(box.minZ - 1e-3)
          expect(pose.z).toBeLessThanOrEqual(box.maxZ + 1e-3)
        }
      }
  },
  60_000,
)
