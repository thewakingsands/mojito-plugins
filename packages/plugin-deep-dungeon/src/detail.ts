import { type Language, type Monster, note } from './data.js'
import type { Target } from './state.js'

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
const labels: Record<string, string> = {
  Proximity: '距离',
  Sight: '视线',
  Sound: '声音',
  Blood: '血量',
  Magic: '魔法',
  Easy: '低',
  Caution: '注意',
  Danger: '危险',
  Impossible: '极高',
  Unknown: '未知',
}
const controls = { stun: '眩晕', heavy: '加重', slow: '减速', sleep: '睡眠', bind: '止步' }
export function detail(
  root: HTMLElement,
  monster: Monster | null,
  name: string,
  nameId: number | null,
  language: Language,
  hp: Target['hp'] = null,
) {
  root.replaceChildren()
  const heading = element('header')
  heading.append(element('h2', name))
  if (nameId !== null) heading.append(element('span', `#${nameId}`, 'name-id'))
  root.append(heading)
  if (hp) {
    const health = element('div', undefined, 'health')
    const percent = Math.min(100, Math.max(0, (hp.current / hp.max) * 100))
    health.append(
      element('span', `${hp.current.toLocaleString()} / ${hp.max.toLocaleString()}`),
      element('span', `${percent.toFixed(1)}%`),
    )
    const progress = element('progress')
    progress.max = hp.max
    progress.value = hp.current
    progress.setAttribute('aria-label', 'HP')
    root.append(health, progress)
  }
  if (!monster) {
    root.append(element('p', '暂无资料', 'empty'))
    return
  }
  const facts = element('dl', undefined, 'facts')
  for (const [key, value] of [
    ['感知', monster.aggro],
    ['危险度', monster.threat],
  ]) {
    const row = element('div')
    row.append(element('dt', key), element('dd', labels[value] ?? value))
    facts.append(row)
  }
  if (monster.undead) {
    const row = element('div')
    row.append(element('dt', '类型'), element('dd', '不死生物'))
    facts.append(row)
  }
  const resistances = element('dl', undefined, 'resistances')
  for (const [state, label] of [
    ['effective', '有效'],
    ['immune', '无效'],
    ['unknown', '未知'],
  ]) {
    const names = (Object.keys(controls) as (keyof typeof controls)[])
      .filter((key) => monster.weakness[key] === state)
      .map((key) => controls[key])
    if (names.length) {
      const row = element('div')
      row.append(element('dt', label), element('dd', names.join('、')))
      resistances.append(row)
    }
  }
  root.append(facts, resistances)
  const text = note(monster.notes, language)
  if (text !== null) root.append(element('p', text, 'notes'))
}
