import type { AnalysisWarning, Connection, Module, Report } from './model'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isModule(value: unknown): value is Module {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.name === 'string' && value.name.length > 0 &&
    typeof value.path === 'string' && typeof value.package === 'boolean'
}

function isWarning(value: unknown): value is AnalysisWarning {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.path === 'string' &&
    (value.line === null || (typeof value.line === 'number' && Number.isInteger(value.line) && value.line > 0)) &&
    typeof value.statement === 'string' && typeof value.message === 'string'
}

export function readReport(text: string): Report {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no contiene JSON válido.')
  }

  if (!isRecord(raw) || raw.version !== 1 || typeof raw.project !== 'string' ||
    !Array.isArray(raw.modules) || !raw.modules.every(isModule) ||
    !Array.isArray(raw.edges) || !Array.isArray(raw.warnings) || !raw.warnings.every(isWarning)) {
    throw new Error('Elige un informe JSON de versión 1 generado por la CLI.')
  }

  const ids = new Set(raw.modules.map(item => item.id))
  if (ids.size !== raw.modules.length) throw new Error('El informe contiene módulos con identificadores repetidos.')
  const seen = new Set<string>()
  const edges: Connection[] = []
  for (const edge of raw.edges) {
    if (!isRecord(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string' ||
      !ids.has(edge.source) || !ids.has(edge.target)) {
      throw new Error('El informe contiene una conexión con un módulo desconocido.')
    }
    const key = JSON.stringify([edge.source, edge.target])
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({ source: edge.source, target: edge.target })
  }

  return { version: 1, project: raw.project, modules: raw.modules, warnings: raw.warnings, edges }
}
