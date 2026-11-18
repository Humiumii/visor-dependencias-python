import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findCycles } from '../web/cycles.ts'
import { readReport } from '../web/read-report.ts'

const connections = (...pairs) => pairs.map(([source, target]) => ({ source, target }))

test('grafo acíclico y módulos aislados', () => {
  assert.deepEqual(findCycles(['a', 'b', 'c'], connections(['a', 'b'])), [])
  assert.deepEqual(findCycles([], []), [])
})

test('ciclo indirecto con una conexión saliente', () => {
  const cycle = connections(['a', 'b'], ['b', 'c'], ['c', 'a'])
  assert.deepEqual(findCycles(['a', 'b', 'c', 'd'], [...cycle, ...connections(['c', 'd'])]),
    [{ members: ['a', 'b', 'c'], edges: cycle }])
})

test('dos ciclos separados y un puente unidireccional', () => {
  const first = connections(['a', 'b'], ['b', 'a'])
  const second = connections(['d', 'e'], ['e', 'd'])
  assert.deepEqual(findCycles(['a', 'b', 'd', 'e'], [...first, ...connections(['b', 'd']), ...second]),
    [{ members: ['a', 'b'], edges: first }, { members: ['d', 'e'], edges: second }])
})

test('import de un módulo hacia sí mismo', () => {
  const edges = connections(['a', 'a'])
  assert.deepEqual(findCycles(['a'], edges), [{ members: ['a'], edges }])
})

test('valida el formato de un informe y las referencias de sus conexiones', () => {
  const report = { version: 1, project: 'demo', modules: [
    { id: 'a.py', name: 'a', path: 'a.py', package: false },
  ], edges: [], warnings: [] }
  assert.deepEqual(readReport(JSON.stringify(report)), report)
  assert.throws(() => readReport('{'), /JSON válido/)
  assert.throws(() => readReport(JSON.stringify({ ...report, version: 2 })), /versión 1/)
  assert.throws(() => readReport(JSON.stringify({
    ...report, edges: connections(['a.py', 'missing.py']),
  })), /módulo desconocido/)
})
