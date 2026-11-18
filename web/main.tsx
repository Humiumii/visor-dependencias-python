import { useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import dagre from '@dagrejs/dagre'
import example from './observatorio.json'
import type { Report, Module } from './model'
import { findCycles } from './cycles'
import { readReport } from './read-report'
import '@fontsource-variable/dm-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './style.css'

const nodeWidth = 184
const nodeHeight = 52

function layout(report: Report) {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: 'LR',
    ranksep: 62,
    nodesep: 30,
    marginx: 38,
    marginy: 42,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  for (const module of report.modules)
    graph.setNode(module.id, { width: nodeWidth, height: nodeHeight })
  for (const edge of report.edges) graph.setEdge(edge.source, edge.target)
  dagre.layout(graph)
  return graph
}

function App() {
  const [report, setReport] = useState<Report>(example)
  const [selected, setSelected] = useState(
    example.modules.find((module) => module.name === 'cielos.servicio')?.id ??
      '',
  )
  const [focus, setFocus] = useState<'all' | 'cycles' | number>('all')
  const [locateId, setLocateId] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState<number | null>(null)
  const [viewport, setViewport] = useState({ width: 1, height: 1 })
  const scrollArea = useRef<HTMLDivElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const nodeButtons = useRef(new Map<string, HTMLButtonElement>())
  const cycles = useMemo(
    () =>
      findCycles(
        report.modules.map((item) => item.id),
        report.edges,
      ),
    [report],
  )
  const byModule = useMemo(() => {
    const groups = new Map<string, number>()
    cycles.forEach((group, index) =>
      group.members.forEach((id) => groups.set(id, index)),
    )
    return groups
  }, [cycles])
  const view = useMemo(() => {
    if (focus === 'all') return report
    const groups = focus === 'cycles' ? cycles : [cycles[focus]]
    const ids = new Set(groups.flatMap((group) => group.members))
    return {
      ...report,
      modules: report.modules.filter((item) => ids.has(item.id)),
      edges: groups.flatMap((group) => group.edges),
    }
  }, [report, focus, cycles])
  const graph = useMemo(() => layout(view), [view])
  const modules = useMemo(
    () => new Map(report.modules.map((module) => [module.id, module])),
    [report],
  )
  const module = modules.get(selected)
  const moduleGroup = byModule.get(selected)
  const outgoing = report.edges.filter((edge) => edge.source === selected)
  const incoming = report.edges.filter((edge) => edge.target === selected)
  const neighbors = new Set([
    ...outgoing.map((edge) => edge.target),
    ...incoming.map((edge) => edge.source),
  ])
  const search = query.trim().toLocaleLowerCase('es')
  const results = search
    ? report.modules.filter((item) =>
        item.name.toLocaleLowerCase('es').includes(search),
      )
    : []
  const width = Math.max(graph.graph().width || 0, 1)
  const height = Math.max(graph.graph().height || 0, 1)
  const fit = Math.min(1.25, viewport.width / width, viewport.height / height)
  const scale = zoom ?? Math.max(0.34, fit)

  useEffect(() => {
    const element = scrollArea.current!
    const observer = new ResizeObserver(([entry]) => {
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!locateId) return
    const button = nodeButtons.current.get(locateId)
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    button?.focus({ preventScroll: true })
    setLocateId('')
  }, [locateId, view])

  function changeFocus(next: typeof focus) {
    setFocus(next)
    setZoom(null)
    scrollArea.current?.scrollTo(0, 0)
    const group = byModule.get(selected)
    if (next === 'cycles' && group === undefined)
      setSelected(cycles[0]?.members[0] ?? '')
    if (typeof next === 'number' && group !== next)
      setSelected(cycles[next].members[0])
  }

  function select(id: string, locate = false) {
    setSelected(id)
    if (locate) {
      if (!graph.hasNode(id)) changeFocus('all')
      setLocateId(id)
    }
  }

  async function openReport(file: File) {
    setLoading(true)
    setError('')
    try {
      const next = readReport(await file.text())
      setReport(next)
      setSelected(next.modules[0]?.id ?? '')
      setQuery('')
      changeFocus('all')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo leer el archivo.',
      )
    } finally {
      setLoading(false)
    }
  }

  function moduleList(items: Module[], empty: string) {
    if (!items.length) return <p className="muted empty">{empty}</p>
    return (
      <ul className="modules">
        {items.map((item) => (
          <li key={item.id}>
            <button onClick={() => select(item.id, true)}>
              <span>{item.name}</span>
              <span aria-hidden="true">↗</span>
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ↳
          </span>
          Mapa de imports
        </div>
        <div className="header-actions">
          {report !== example && (
            <button
              className="action reset"
              disabled={loading}
              onClick={() => {
                setReport(example)
                setSelected(
                  example.modules.find(
                    (item) => item.name === 'cielos.servicio',
                  )?.id ?? '',
                )
                setQuery('')
                setError('')
                changeFocus('all')
              }}
            >
              Volver al ejemplo
            </button>
          )}
          <button
            className="action open"
            disabled={loading}
            onClick={() => filePicker.current?.click()}
          >
            <span aria-hidden="true">↑</span>{' '}
            {loading ? 'Abriendo…' : 'Abrir JSON'}
          </button>
          <input
            hidden
            ref={filePicker}
            type="file"
            accept=".json,application/json"
            aria-label="Informe JSON"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void openReport(file)
            }}
          />
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <p className="source">
              {report === example ? 'Proyecto de ejemplo' : 'Informe local'}
            </p>
            <h1>{report.project}</h1>
          </div>
          <div className="stats">
            <span>
              <b>{report.modules.length}</b>{' '}
              {report.modules.length === 1 ? 'módulo' : 'módulos'}
            </span>
            <span>
              <b>{report.edges.length}</b>{' '}
              {report.edges.length === 1 ? 'conexión' : 'conexiones'}
            </span>
            <span>
              <b>{cycles.length}</b>{' '}
              {cycles.length === 1 ? 'grupo cíclico' : 'grupos cíclicos'}
            </span>
          </div>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace">
          <section className="graph-panel" aria-labelledby="graph-title">
            <div className="toolbar">
              <h2 id="graph-title">Grafo de dependencias</h2>
              <div className="tools">
                <form
                  className="search"
                  role="search"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (results.length) {
                      select(results[0].id, true)
                      setQuery('')
                    }
                  }}
                >
                  <input
                    aria-label="Buscar módulo"
                    placeholder="Buscar módulo…"
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setQuery('')
                    }}
                  />
                  {search && (
                    <div className="results">
                      <span role="status">
                        {results.length
                          ? `${results.length} coincidencias`
                          : 'Sin coincidencias'}
                      </span>
                      {results.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => {
                            select(item.id, true)
                            setQuery('')
                          }}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                </form>
                <button
                  className="action focus"
                  disabled={!cycles.length}
                  aria-pressed={focus !== 'all'}
                  onClick={() =>
                    changeFocus(focus === 'all' ? 'cycles' : 'all')
                  }
                >
                  <span aria-hidden="true">⟳</span>{' '}
                  {focus === 'all' ? 'Enfocar ciclos' : 'Ver grafo completo'}
                </button>
              </div>
            </div>
            {focus !== 'all' && (
              <div className="cycle-tabs" aria-label="Grupos cíclicos">
                <button
                  className="action"
                  aria-pressed={focus === 'cycles'}
                  onClick={() => changeFocus('cycles')}
                >
                  Todos los grupos
                </button>
                {cycles.map((group, index) => (
                  <button
                    key={group.members[0]}
                    className="action"
                    aria-pressed={focus === index}
                    onClick={() => changeFocus(index)}
                  >
                    Grupo {index + 1}
                  </button>
                ))}
              </div>
            )}
            <div className="canvas">
              <div
                className="scroller"
                ref={scrollArea}
                tabIndex={0}
                aria-label="Área desplazable del grafo"
              >
                {!report.modules.length && (
                  <p className="graph-empty">El informe no contiene módulos.</p>
                )}
                <div
                  className="stage-size"
                  style={{ width: width * scale, height: height * scale }}
                >
                  <div
                    className="stage"
                    style={{ width, height, transform: `scale(${scale})` }}
                  >
                    <svg width={width} height={height} aria-hidden="true">
                      <defs>
                        {Object.entries({
                          normal: '#758482',
                          active: '#167752',
                          faint: '#aab5b1',
                          cycle: '#a9472f',
                        }).map(([key, color]) => (
                          <marker
                            key={key}
                            id={`arrow-${key}`}
                            markerWidth="9"
                            markerHeight="9"
                            refX="8"
                            refY="4.5"
                            orient="auto"
                            markerUnits="userSpaceOnUse"
                          >
                            <path d="M0 0 L9 4.5 L0 9 Z" fill={color} />
                          </marker>
                        ))}
                      </defs>
                      {view.edges.map((edge) => {
                        const direct =
                          edge.source === selected || edge.target === selected
                        const group = byModule.get(edge.source)
                        const cyclic =
                          group !== undefined &&
                          group === byModule.get(edge.target)
                        const tone = cyclic
                          ? 'cycle'
                          : direct
                            ? 'active'
                            : selected
                              ? 'faint'
                              : 'normal'
                        const {
                          points,
                        }: { points: { x: number; y: number }[] } = graph.edge(
                          edge.source,
                          edge.target,
                        )
                        return (
                          <polyline
                            key={JSON.stringify([edge.source, edge.target])}
                            className={`edge ${tone} ${direct ? 'direct' : ''}`}
                            points={points
                              .map((point) => `${point.x},${point.y}`)
                              .join(' ')}
                            markerEnd={`url(#arrow-${tone})`}
                          />
                        )
                      })}
                    </svg>
                    {view.modules.map((item) => {
                      const { x, y } = graph.node(item.id)
                      const group = byModule.get(item.id)
                      return (
                        <button
                          key={item.id}
                          className={`node ${neighbors.has(item.id) ? 'neighbor' : ''} ${selected === item.id ? 'chosen' : ''} ${group === undefined ? '' : 'cyclic'}`}
                          ref={(button) => {
                            if (button) nodeButtons.current.set(item.id, button)
                            else nodeButtons.current.delete(item.id)
                          }}
                          aria-pressed={selected === item.id}
                          onClick={() => select(item.id)}
                          title={item.path}
                          style={{
                            left: x - nodeWidth / 2,
                            top: y - nodeHeight / 2,
                            width: nodeWidth,
                            height: nodeHeight,
                          }}
                        >
                          <span className="node-type" aria-hidden="true">
                            {item.package ? 'PKG' : 'PY'}
                          </span>
                          <span className="node-name">{item.name}</span>
                          {group !== undefined && (
                            <span
                              className="cycle-mark"
                              aria-label={`Grupo cíclico ${group + 1}`}
                            >
                              ⟳
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className="zoom" aria-label="Zoom">
                <button
                  onClick={() => setZoom(Math.min(2, scale * 1.2))}
                  aria-label="Acercar"
                >
                  +
                </button>
                <button
                  onClick={() => setZoom(Math.max(0.34, scale / 1.2))}
                  aria-label="Alejar"
                >
                  −
                </button>
                <button
                  onClick={() => {
                    setZoom(null)
                    scrollArea.current?.scrollTo(0, 0)
                  }}
                  aria-label="Ajustar grafo"
                >
                  ⊡
                </button>
              </div>
            </div>
            <footer className="legend">
              <span>
                <b aria-hidden="true">⟶</b> Importador → importado
              </span>
              <span>
                <i className="dot green" /> Conexión directa
              </span>
              <span>
                <i className="dot rust" /> Conexión cíclica
              </span>
            </footer>
          </section>
          <aside className="inspector" aria-labelledby="detail-title">
            <div className="inspector-top">
              <h2 id="detail-title">Detalle del módulo</h2>
            </div>
            {module ? (
              <>
                <div className="module-title">
                  <span className="module-kind">
                    {module.package ? 'Paquete' : 'Módulo Python'}
                  </span>
                  <h3>{module.name}</h3>
                  <code>{module.path}</code>
                  <p
                    className={
                      moduleGroup === undefined
                        ? 'cycle-state'
                        : 'cycle-state in-cycle'
                    }
                  >
                    {moduleGroup === undefined
                      ? 'Fuera de ciclos'
                      : `⟳ Grupo cíclico ${moduleGroup + 1}`}
                  </p>
                </div>
                <section className="detail-section">
                  <h4>
                    <span aria-hidden="true">↗</span> Importa{' '}
                    <small>{outgoing.length}</small>
                  </h4>
                  {moduleList(
                    outgoing.map((edge) => modules.get(edge.target)!),
                    'Sin dependencias internas.',
                  )}
                </section>
                <section className="detail-section">
                  <h4>
                    <span aria-hidden="true">↙</span> Lo importan{' '}
                    <small>{incoming.length}</small>
                  </h4>
                  {moduleList(
                    incoming.map((edge) => modules.get(edge.source)!),
                    'Ningún módulo lo importa.',
                  )}
                </section>
                {moduleGroup !== undefined && (
                  <details
                    className="detail-section cycle-detail"
                    open={focus !== 'all'}
                  >
                    <summary>
                      Conexiones del ciclo ({cycles[moduleGroup].edges.length})
                    </summary>
                    <ul>
                      {cycles[moduleGroup].edges.map(({ source, target }) => (
                        <li key={JSON.stringify([source, target])}>
                          <button onClick={() => select(source, true)}>
                            {modules.get(source)!.name}
                          </button>
                          <span aria-label="importa">→</span>
                          <button onClick={() => select(target, true)}>
                            {modules.get(target)!.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="empty muted">
                Selecciona un módulo para ver sus conexiones.
              </p>
            )}
          </aside>
        </div>
        {!!report.warnings.length && (
          <details className="warnings">
            <summary>Avisos de análisis ({report.warnings.length})</summary>
            <ul>
              {report.warnings.map((warning, index) => (
                <li key={index}>
                  <code>
                    {warning.path}
                    {warning.line === null ? '' : `:${warning.line}`}
                  </code>{' '}
                  {warning.statement && <code> {warning.statement}</code>}{' '}
                  {warning.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
