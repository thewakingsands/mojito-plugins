const assert = require('node:assert/strict')
const { test } = require('node:test')
const { retainedByConstructor } = require('./heap-retention.cjs')

test('groups exclusively retained bytes without counting nested instances twice', () => {
  // Two owners share one leaf. One owner also holds a nested instance with private data.
  const graph = [
    ['root', 0, [[1], [2], [6, 1]]],
    ['Owner', 10, [[3], [4]]],
    ['Other', 20, [[4], [6, 2]]],
    ['Owner', 30, [[5]]],
    ['Shared', 40, []],
    ['Private', 50, []],
    ['WeakOnly', 60, []],
  ]
  const strings = graph.map(([name]) => name)
  const nodes = graph.flatMap(([, size, outgoing], i) => [0, i, 2 * i + 1, size, outgoing.length])
  const edges = graph.flatMap(([, , outgoing]) => outgoing.flatMap(([target, type = 0]) => [type, target * 5]))
  const groups = retainedByConstructor({
    snapshot: {
      meta: {
        node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
        node_types: [['object']],
        edge_fields: ['type', 'to_node'],
        edge_types: [['property', 'weak', 'shortcut']],
      },
    },
    nodes,
    edges,
    strings,
  })
  const get = (name) => groups.get(JSON.stringify(['object', name]))
  assert.equal(get('root').retainedBytes, 150)
  assert.equal(get('Owner').count, 2)
  assert.equal(get('Owner').shallowBytes, 40)
  assert.equal(get('Owner').retainedBytes, 90)
  assert.equal(get('Owner').largest.ownerId, 1)
  assert.equal(get('Other').retainedBytes, 20)
  assert.equal(get('Shared').largest.ownerId, 1)
  assert.equal(get('WeakOnly'), undefined)
})
