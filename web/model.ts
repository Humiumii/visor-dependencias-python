export interface Module {
  id: string
  name: string
  path: string
  package: boolean
}

export interface Connection {
  source: string
  target: string
}

export interface AnalysisWarning {
  kind: string
  path: string
  line: number | null
  statement: string
  message: string
}

export interface Report {
  version: number
  project: string
  modules: Module[]
  edges: Connection[]
  warnings: AnalysisWarning[]
}
