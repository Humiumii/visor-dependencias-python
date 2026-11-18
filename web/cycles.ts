import type { Connection } from './model'

export interface CycleGroup {
  members: string[]
  edges: Connection[]
}

// Kosaraju con una pila explícita para evitar límites de recursión.
export function findCycles(ids: string[], edges: Connection[]): CycleGroup[] {
  const outgoing = new Map(ids.map(id => [id, [] as string[]]))
  const incoming = new Map(ids.map(id => [id, [] as string[]]))
  for (const { source, target } of edges) {
    outgoing.get(source)!.push(target)
    incoming.get(target)!.push(source)
  }

  const visited = new Set<string>()
  const finishOrder: string[] = []
  for (const id of ids) {
    if (visited.has(id)) continue
    visited.add(id)
    const stack = [{ id, next: 0 }]
    while (stack.length) {
      const frame = stack[stack.length - 1]
      const neighbors = outgoing.get(frame.id)!
      if (frame.next === neighbors.length) {
        finishOrder.push(frame.id)
        stack.pop()
        continue
      }
      const next = neighbors[frame.next++]
      if (!visited.has(next)) {
        visited.add(next)
        stack.push({ id: next, next: 0 })
      }
    }
  }

  const groups: CycleGroup[] = []
  const groupById = new Map<string, CycleGroup>()
  visited.clear()
  for (const id of finishOrder.reverse()) {
    if (visited.has(id)) continue
    const members: string[] = []
    const stack = [id]
    visited.add(id)
    while (stack.length) {
      const current = stack.pop()!
      members.push(current)
      for (const previous of incoming.get(current)!) {
        if (!visited.has(previous)) {
          visited.add(previous)
          stack.push(previous)
        }
      }
    }
    if (members.length === 1 && !outgoing.get(id)!.includes(id)) continue
    const group = { members: members.sort(), edges: [] }
    groups.push(group)
    for (const member of members) groupById.set(member, group)
  }

  for (const edge of edges) {
    const group = groupById.get(edge.source)
    if (group && groupById.get(edge.target) === group) group.edges.push(edge)
  }
  return groups.sort((a, b) => a.members[0].localeCompare(b.members[0]))
}
