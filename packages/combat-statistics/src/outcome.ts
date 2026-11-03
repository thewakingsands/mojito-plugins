import type { Actor, FightOutcome, RowSummary } from './model.js'

/**
 * The key of an actor without its generation. The game removes and adds every actor again when a fight moves to a
 * new arena, which gives the same enemy a new generation; the outcome treats them as one enemy.
 */
const lineage = (key: string) => key.replace(/:\d+:(\d+)$/, ':$1')
const generation = (key: string) => Number(/:(\d+):\d+$/.exec(key)?.[1] ?? 0)

/** What one fight needs to decide its result: deaths, last actions and HP, recorded while the fight runs. */
export class Outcome {
  private readonly died = new Map<string, number>()
  private readonly acted = new Map<string, number>()
  private readonly hp = new Map<string, { hpCur: number; hpMax: number | null }>()

  death(actor: Actor | undefined, at: number) {
    if (actor) this.died.set(lineage(actor.key), at)
  }
  action(actor: Actor | undefined, at: number) {
    if (actor) this.acted.set(lineage(actor.key), Math.max(this.acted.get(lineage(actor.key)) ?? -Infinity, at))
  }
  health(actor: Actor | undefined, hpCur: number, hpMax: number | null) {
    if (actor) this.hp.set(lineage(actor.key), { hpCur, hpMax })
  }

  /**
   * rows are the in-scope rows of the fight, whose damage targets are all enemies; the main enemy took the most damage
   * from them. actors gives the enemy names.
   */
  result(rows: RowSummary[], actors: Iterable<Actor>, ended: boolean): FightOutcome {
    // By lineage, with the newest generation that took damage
    const damage = new Map<string, { amount: number; key: string }>()
    for (const row of rows)
      for (const [key, target] of Object.entries(row.targets)) {
        if (target.damage <= 0 || key === 'unknown') continue
        const enemy = damage.get(lineage(key))
        if (!enemy) damage.set(lineage(key), { amount: target.damage, key })
        else {
          enemy.amount += target.damage
          if (generation(key) > generation(enemy.key)) enemy.key = key
        }
      }
    let main: string | null = null
    for (const [enemy, { amount }] of damage) if (main === null || amount > damage.get(main)!.amount) main = enemy
    let name: string | null = null
    for (const actor of actors) if (lineage(actor.key) === main) name = actor.name
    const hp = main === null ? undefined : this.hp.get(main)
    const mainEnemy =
      main === null
        ? null
        : {
            key: damage.get(main)!.key,
            name,
            hpCur: hp?.hpCur ?? null,
            hpMax: hp?.hpMax ?? null,
            hpPercent: hp?.hpMax ? (hp.hpCur / hp.hpMax) * 100 : null,
          }
    if (!ended) return { result: null, mainEnemy }
    // The game may leave combat before it reports the death, so HP 0 within the fight is a kill as well
    if (main !== null && (this.died.has(main) || hp?.hpCur === 0)) return { result: 'kill', mainEnemy }
    const members = rows.filter((row) => row.actor.kind === 'member')
    const wiped =
      members.length > 0 &&
      members.every((row) => {
        const died = this.died.get(lineage(row.actor.key))
        return died !== undefined && (this.acted.get(lineage(row.actor.key)) ?? -Infinity) <= died
      })
    return { result: wiped ? 'wipe' : 'ended', mainEnemy }
  }
}
