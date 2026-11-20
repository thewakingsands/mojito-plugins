const { readFileSync } = require('node:fs')
const { basename } = require('node:path')

function retainedByConstructor(snapshot) {
  const { nodes, edges, strings } = snapshot
  const {
    node_fields: nodeFields,
    node_types: nodeTypes,
    edge_fields: edgeFields,
    edge_types: edgeTypes,
  } = snapshot.snapshot.meta
  const nodeWidth = nodeFields.length
  const edgeWidth = edgeFields.length
  const nodeType = nodeFields.indexOf('type')
  const name = nodeFields.indexOf('name')
  const id = nodeFields.indexOf('id')
  const size = nodeFields.indexOf('self_size')
  const edgeCount = nodeFields.indexOf('edge_count')
  const edgeType = edgeFields.indexOf('type')
  const to = edgeFields.indexOf('to_node')
  const weak = edgeTypes[edgeType].indexOf('weak')
  const shortcut = edgeTypes[edgeType].indexOf('shortcut')
  const count = nodes.length / nodeWidth
  const starts = new Int32Array(count + 1)
  for (let i = 0; i < count; i++) starts[i + 1] = starts[i] + nodes[i * nodeWidth + edgeCount] * edgeWidth
  const strong = (source, edge) =>
    edges[edge + edgeType] !== weak && (source === 0 || edges[edge + edgeType] !== shortcut)
  const target = (edge) => edges[edge + to] / nodeWidth

  // Index predecessors while visiting reachable nodes in depth-first order.
  const predecessors = Array.from({ length: count }, () => [])
  const visited = new Uint8Array(count)
  const postorder = []
  const stack = [0]
  const next = starts.slice(0, count)
  visited[0] = 1
  while (stack.length) {
    const source = stack.at(-1)
    if (next[source] === starts[source + 1]) {
      postorder.push(stack.pop())
      continue
    }
    const edge = next[source]
    next[source] += edgeWidth
    if (!strong(source, edge)) continue
    const dest = target(edge)
    predecessors[dest].push(source)
    if (!visited[dest]) {
      visited[dest] = 1
      stack.push(dest)
    }
  }
  const order = postorder.reverse()
  const ranks = new Int32Array(count)
  order.forEach((node, rank) => {
    ranks[node] = rank
  })

  // Iterate in reverse postorder to compute the immediate dominator of each reachable node.
  const parent = new Int32Array(count).fill(-1)
  parent[0] = 0
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < order.length; i++) {
      const node = order[i]
      let dominator = -1
      for (let pred of predecessors[node]) {
        if (parent[pred] < 0) continue
        if (dominator < 0) dominator = pred
        else {
          while (dominator !== pred) {
            while (ranks[dominator] > ranks[pred]) dominator = parent[dominator]
            while (ranks[pred] > ranks[dominator]) pred = parent[pred]
          }
        }
      }
      if (dominator !== parent[node]) {
        parent[node] = dominator
        changed = true
      }
    }
  }

  const retained = new Float64Array(count)
  const children = Array.from({ length: count }, () => [])
  for (let i = order.length - 1; i > 0; i--) {
    const node = order[i]
    retained[node] += nodes[node * nodeWidth + size]
    retained[parent[node]] += retained[node]
    children[parent[node]].push(node)
  }
  const label = (node) => {
    const offset = node * nodeWidth
    return [nodeTypes[nodeType][nodes[offset + nodeType]], strings[nodes[offset + name]]]
  }
  const groups = new Map()
  const ancestors = new Map()
  const walk = [[0, false]]
  while (walk.length) {
    const [node, leaving] = walk.pop()
    const [type, labelName] = label(node)
    const key = JSON.stringify([type, labelName])
    if (leaving) {
      ancestors.set(key, ancestors.get(key) - 1)
      continue
    }
    if (!groups.has(key)) groups.set(key, { type, constructor: labelName, count: 0, shallowBytes: 0, retainedBytes: 0 })
    const group = groups.get(key)
    group.count++
    group.shallowBytes += nodes[node * nodeWidth + size]
    const ancestorsWithKey = ancestors.get(key) ?? 0
    // A nested instance of the same group is already included in the outer instance's retained size.
    if (!ancestorsWithKey) {
      group.retainedBytes += retained[node]
      if (!group.largest || retained[node] > group.largest.retainedBytes) {
        const owner = parent[node]
        group.largest = {
          id: nodes[node * nodeWidth + id],
          retainedBytes: retained[node],
          owner: label(owner),
          ownerId: nodes[owner * nodeWidth + id],
        }
      }
    }
    ancestors.set(key, ancestorsWithKey + 1)
    walk.push([node, true])
    for (const child of children[node]) walk.push([child, false])
  }
  return groups
}

function compare(beforeFile, afterFile) {
  const read = (file) => retainedByConstructor(JSON.parse(readFileSync(file, 'utf8')))
  const before = read(beforeFile)
  const after = read(afterFile)
  const empty = { count: 0, shallowBytes: 0, retainedBytes: 0 }
  const changes = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const first = before.get(key) ?? empty
    const last = after.get(key) ?? empty
    const [type, labelName] = JSON.parse(key)
    changes.push({
      type,
      constructor: labelName,
      countDelta: last.count - first.count,
      shallowBytesDelta: last.shallowBytes - first.shallowBytes,
      retainedBytesDelta: last.retainedBytes - first.retainedBytes,
      before: first,
      after: last,
    })
  }
  return {
    before: basename(beforeFile),
    after: basename(afterFile),
    groups: changes.sort((a, b) => b.retainedBytesDelta - a.retainedBytesDelta).slice(0, 30),
  }
}

module.exports = { compare, retainedByConstructor }
