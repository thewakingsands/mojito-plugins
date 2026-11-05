/** σ, the spread of the bias of one snapshot */
export const SNAPSHOT_SPREAD = 0.08
/** τ, the spread of the scale every snapshot of a caster shares */
export const SOURCE_SPREAD = 0.05
const BISECTION_STEPS = 80

/** A snapshot in a tick: its id and μ, the mean of its prior */
export interface Member {
  id: number
  prior: number
}

/** The mean and the covariance of the amounts of the members of a tick */
export interface Block {
  mean: number[]
  covariance: number[][]
}

/**
 * The scale η of every caster and the bias ε of every snapshot, as a Gaussian. A snapshot j of caster s ticks for
 * μ_j (1 + η_s + ε_j) on average.
 */
export class GaussianState {
  private mean: number[] = []
  private covariance: number[][] = []
  private sources = new Map<string, number>()
  private snapshots = new Map<number, { index: number; source: string }>()

  hasSource(source: string): boolean {
    return this.sources.has(source)
  }

  hasSnapshot(id: number): boolean {
    return this.snapshots.has(id)
  }

  /** Adds the scale of a caster with mean 0 and variance τ² */
  addSource(source: string): void {
    if (this.sources.has(source)) return
    this.sources.set(source, this.addComponent(SOURCE_SPREAD ** 2))
  }

  /** Adds the bias of a snapshot with mean 0 and variance σ², and the scale of its caster when it is new */
  addSnapshot(id: number, source: string): void {
    if (this.snapshots.has(id)) throw new Error(`snapshot ${id} is already in the state`)
    this.addSource(source)
    this.snapshots.set(id, { index: this.addComponent(SNAPSHOT_SPREAD ** 2), source })
  }

  /** Forgets the bias of the snapshot; the other components keep their marginal distribution */
  removeSnapshot(id: number): void {
    const snapshot = this.snapshots.get(id)
    if (!snapshot) return
    this.snapshots.delete(id)
    const removed = snapshot.index
    this.mean.splice(removed, 1)
    this.covariance.splice(removed, 1)
    for (const row of this.covariance) row.splice(removed, 1)
    const shift = (index: number) => (index > removed ? index - 1 : index)
    for (const [key, index] of this.sources) this.sources.set(key, shift(index))
    for (const item of this.snapshots.values()) item.index = shift(item.index)
  }

  /** The mean and the covariance of the amounts of the members */
  block(members: readonly Member[]): Block {
    const rows = members.map((member) => this.row(member))
    const mean = rows.map(({ prior, scale, bias }) => prior * (1 + this.mean[scale] + this.mean[bias]))
    const covariance = rows.map((a) =>
      rows.map(
        (b) =>
          a.prior *
          b.prior *
          (this.covariance[a.scale][b.scale] +
            this.covariance[a.scale][b.bias] +
            this.covariance[a.bias][b.scale] +
            this.covariance[a.bias][b.bias]),
      ),
    )
    return { mean, covariance }
  }

  /** ŷ, the sum the members are expected to tick for */
  predict(members: readonly Member[]): number {
    return this.block(members).mean.reduce((sum, value) => sum + value, 0)
  }

  /** Updates the state with a tick of the members that summed to observed, with the noise of their variances */
  update(members: readonly Member[], observed: number, noise: number): void {
    const rows = members.map((member) => this.row(member))
    const size = this.mean.length
    // g = Σ Hᵀ 1
    const gain = new Array<number>(size).fill(0)
    for (const { prior, scale, bias } of rows) {
      for (let index = 0; index < size; index++) {
        gain[index] += prior * (this.covariance[index][scale] + this.covariance[index][bias])
      }
    }
    let innovation = noise
    for (const { prior, scale, bias } of rows) innovation += prior * (gain[scale] + gain[bias])
    const residual = observed - this.predict(members)
    for (let index = 0; index < size; index++) this.mean[index] += (gain[index] * residual) / innovation
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) this.covariance[i][j] -= (gain[i] * gain[j]) / innovation
    }
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        const value = (this.covariance[i][j] + this.covariance[j][i]) / 2
        this.covariance[i][j] = value
        this.covariance[j][i] = value
      }
    }
  }

  private row(member: Member) {
    const snapshot = this.snapshots.get(member.id)
    if (!snapshot) throw new Error(`snapshot ${member.id} is not in the state`)
    return { prior: member.prior, scale: this.sources.get(snapshot.source) as number, bias: snapshot.index }
  }

  private addComponent(variance: number): number {
    const index = this.mean.length
    this.mean.push(0)
    for (const row of this.covariance) row.push(0)
    this.covariance.push(new Array<number>(index + 1).fill(0))
    this.covariance[index][index] = variance
    return index
  }
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

/**
 * The expected amount of each member given that they summed to observed. A negative result is projected:
 * x_j = max(0, m_j + λ V_jj), with λ such that the amounts sum to observed.
 * @param noise r of each member
 */
export function allocate(block: Block, noise: readonly number[], observed: number): number[] {
  const { mean, covariance } = block
  const variance = covariance.map((row, i) => row.map((value, j) => value + (i === j ? noise[i] : 0)))
  const spread = variance.map((row) => sum(row))
  const total = sum(spread)
  const residual = observed - sum(mean)
  const result = mean.map((value, index) => value + (spread[index] * residual) / total)
  if (result.every((value) => value >= 0)) return result

  const diagonal = variance.map((row, index) => Math.max(row[index], Number.MIN_VALUE))
  const project = (lambda: number) => mean.map((value, index) => Math.max(0, value + lambda * diagonal[index]))
  // Below low every amount is 0; at high they sum to observed or more
  let low = Math.min(...mean.map((value, index) => -value / diagonal[index]))
  let high = low + (observed + sum(mean.map(Math.abs))) / Math.min(...diagonal) + 1
  for (let step = 0; step < BISECTION_STEPS; step++) {
    const middle = (low + high) / 2
    if (sum(project(middle)) < observed) low = middle
    else high = middle
  }
  const projected = project((low + high) / 2)
  // The bisection leaves a rounding error; the largest share takes it
  const largest = projected.indexOf(Math.max(...projected))
  projected[largest] += observed - sum(projected)
  return projected
}

/**
 * Takes the information of one tick out of a block of a state that it updated, for the split after the battle.
 * @param noise R of the tick
 */
export function removeTick(block: Block, noise: number, observed: number): Block {
  const { mean, covariance } = block
  const gain = covariance.map((row) => sum(row))
  const factor = 1 / (noise - sum(gain))
  const residual = observed - sum(mean)
  return {
    mean: mean.map((value, index) => value - factor * gain[index] * residual),
    covariance: covariance.map((row, i) => row.map((value, j) => value + factor * gain[i] * gain[j])),
  }
}

/**
 * Integer shares that sum to total: the shares are rounded down, then the largest fractions take one more each.
 * Equal fractions go in the order of the members.
 */
export function roundShares(values: readonly number[], total: number): number[] {
  if (values.length === 0) return []
  const shares = values.map((value) => Math.max(0, Math.floor(value)))
  let left = total - sum(shares)
  const order = values
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (let at = 0; left > 0; at = (at + 1) % order.length, left--) shares[order[at].index]++
  // Values that summed to more than total give the excess back from the smallest fractions
  for (let at = order.length - 1; left < 0; at = (at - 1 + order.length) % order.length) {
    if (shares[order[at].index] > 0) {
      shares[order[at].index]--
      left++
    }
  }
  return shares
}
