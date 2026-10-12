import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { banda, barra, calendario, painel, projetar, sparkline, turnosAte } from '../hooks/calc'
import type { Fila } from '../hooks/calc'
import { config, lerFonte, lerJson, lerLinhas, montar, partirComando, quando } from '../hooks/radar'
import type { Radar } from '../types'

const H = 3_600_000
const texto = (f: Fila) => f.map(s => s.t).join('')
// Noon on Sunday, Oct 11 2026, in the machine's time zone: "today" does not depend on where the test runs.
const AGORA = new Date(2026, 9, 11, 12, 0).getTime()

// ---------------------------------------------------------------- projections

test('the 5-hour window projects at the average pace since it opened', () => {
  const reset = 10 * H
  // halfway through the window (2.5 h elapsed) at 50%: ends at 100%, does not run out early
  expect(projetar(50, reset, reset - 2.5 * H, 5 * H)).toEqual({ pct: 50, projetado: 100 })
  // at 60% halfway: 120% at reset; runs out when the last 40 points go at 24%/h = 1h40
  const p = projetar(60, reset, reset - 2.5 * H, 5 * H)
  expect(Math.round(p.projetado ?? 0)).toBe(120)
  expect(p.esgotaEm).toBe(reset - 2.5 * H + (40 / 60) * 2.5 * H)
})

test('too early in the window, or with no reset, it does not project', () => {
  expect(projetar(10, 5 * H, 0.1 * H, 5 * H)).toEqual({ pct: 10 }) // 2% of the window elapsed
  expect(projetar(10, undefined, 0, 5 * H)).toEqual({ pct: 10 })
})

test('context pace only counts the growth since the last compaction', () => {
  expect(turnosAte([100_000, 120_000, 140_000], 140_000, 200_000)).toEqual({ porTurno: 20_000, turnos: 3 })
  // the drop (a compaction) cuts the series: the pace is the one after it
  expect(turnosAte([100_000, 150_000, 30_000, 40_000], 40_000, 200_000)).toEqual({ porTurno: 10_000, turnos: 16 })
  expect(turnosAte([50_000], 50_000, 200_000)).toEqual({}) // one turn is not a pace
})

test('a bar always has the width asked for: filled, projected, empty and the marker', () => {
  const b = barra(20, 0.5, 'success', 0.75, 0.9)
  expect(texto(b)).toBe('██████████▒▒▒▒▒░░░│░') // marker at 0.9 of 20 cells: index 18
  expect(texto(barra(10, 1.4, 'error', 2))).toBe('██████████') // going past 100% does not widen it
  expect(sparkline([0, 500_000, 1_000_000], 1_000_000, 3)).toBe('▁▅█')
})

// ---------------------------------------------------------------- radar sources

const FICHEIRO = [
  '# Deadlines',
  'Notes without a date are left out.',
  '- [ ] 2026-10-13 Networks — project 1 !',
  '- [x] 2026-10-12 Already submitted',
  '- 18/10/2026 Databases: first delivery',
  '2026-10-09 Job fair — sign-up',
  '- Email the advisor !',
  '2026-02-30 a date that does not exist',
].join('\n')

test('the plain format: one date per line, ! at the end is critical, ticked boxes are skipped', () => {
  expect(lerLinhas(FICHEIRO)).toEqual({
    prazos: [
      { data: '2026-10-13', texto: 'Networks — project 1', critico: true },
      { data: '2026-10-18', texto: 'Databases: first delivery', critico: false },
      { data: '2026-10-09', texto: 'Job fair — sign-up', critico: false },
    ],
    sem_data: ['Email the advisor'],
    avisos: [],
  })
})

test('JSON takes a list or an object, English or Portuguese keys, and extra fields', () => {
  const lista = [{ date: '2026-10-15', text: 'Report', critical: true }]
  expect(lerJson(lista).prazos).toEqual([{ data: '2026-10-15', texto: 'Report', critico: true }])
  const ingles = { deadlines: lista, undated: ['Call the lab'], warnings: ['2 to review'] }
  expect(lerJson(ingles)).toEqual({
    prazos: [{ data: '2026-10-15', texto: 'Report', critico: true }],
    sem_data: ['Call the lab'],
    avisos: ['2 to review'],
  })
  // Portuguese keys, with fields the mod does not use (dias, quando, por_espelhar...): ignored.
  const portugues = {
    hoje: '2026-10-11',
    prazos: [{ data: '2026-10-13', dias: 2, quando: '13/10 2d', texto: 'Networks', critico: true }],
    sem_data: ['Email the advisor'],
    por_espelhar: [{ data: null, texto: 'x' }],
  }
  expect(lerFonte(JSON.stringify(portugues), '').prazos).toEqual([{ data: '2026-10-13', texto: 'Networks', critico: true }])
  expect(() => lerJson({ other: 1 })).toThrow('deadlines')
})

test('the window drops far and old overdue items, but a critical overdue one stays', () => {
  const r = montar(
    {
      prazos: [
        { data: '2026-10-13', texto: 'near', critico: false },
        { data: '2026-11-30', texto: 'far', critico: false },
        { data: '2026-09-01', texto: 'old overdue', critico: false },
        { data: '2026-09-01', texto: 'old critical', critico: true },
        { data: '2026-10-11', texto: 'same day', critico: false },
        { data: '2026-10-12', texto: 'next day', critico: false },
      ],
      sem_data: [],
      avisos: [],
    },
    AGORA,
    21,
    'DEADLINES.md',
  )
  expect(r.hoje).toBe('2026-10-11')
  expect(r.prazos.map(p => `${p.quando} ${p.texto}`)).toEqual([
    'Sep 1 OVERDUE 40d old critical',
    'Oct 11 today same day',
    'Oct 12 tomorrow next day',
    'Oct 13 2d near',
  ])
  expect(quando('2026-10-09', -2)).toBe('Oct 9 OVERDUE 2d')
})

test('the command is split like a simple shell, and the options have defaults', () => {
  expect(partirComando(`python "scripts/my radar.py" --json ''`)).toEqual(['python', 'scripts/my radar.py', '--json', ''])
  expect(config({})).toEqual({ ficheiro: 'DEADLINES.md', comando: [], dias: 21 })
  expect(config({ radar_file: ' todo.md ', radar_command: 'make radar', radar_days: 400 })).toEqual({
    ficheiro: 'todo.md',
    comando: ['make', 'radar'],
    dias: 90,
  })
})

// ---------------------------------------------------------------- drawing the radar

const RADAR: Radar = montar(lerLinhas(FICHEIRO), AGORA, 21, 'DEADLINES.md')

test('the calendar starts today and paints each day with the worst colour that falls on it', () => {
  const dias = calendario(RADAR, 21)
  expect(dias.length).toBe(21)
  expect(dias[0]).toEqual({ iso: '2026-10-11', letra: 'S' }) // Oct 11 2026 is a Sunday
  expect(dias[2]).toEqual({ iso: '2026-10-13', letra: 'T', cor: 'error' }) // the critical one
  expect(dias[7]).toEqual({ iso: '2026-10-18', letra: 'S', cor: 'suggestion' }) // far and normal
  expect(dias.filter(d => d.cor).length).toBe(2) // the overdue one is outside the calendar, not the list
})

test('the band shows overdue items and the next deadline, red when it is critical', () => {
  expect(banda(null, [], RADAR, AGORA)).toEqual([
    { texto: '1 overdue', cor: 'error' },
    { texto: 'Oct 13 2d Networks — project 1 +1', cor: 'error' },
  ])
})

test('a radar that failed says so, and from where, in the band and in the pane', () => {
  const partido: Radar = { ...RADAR, prazos: [], falha: 'exited with 1: yaml', fonte: 'python radar.py' }
  expect(banda(null, [], partido, AGORA)).toEqual([{ texto: 'RADAR FAILED — /brain', cor: 'error' }])
  const tudo = painel(null, [], partido, AGORA, 50).map(texto).join('\n')
  expect(tudo).toContain('RADAR FAILED')
  expect(tudo).toContain('exited with 1')
  expect(tudo).toContain('source: python radar.py')
})

test('the pane keeps overdue items, undated critical ones, warnings and the source', () => {
  const tudo = painel(null, [], { ...RADAR, avisos: ['2 to review'] }, AGORA, 50).map(texto).join('\n')
  expect(tudo).toContain('Oct 9 OVERDUE 2d')
  expect(tudo).toContain('⚑ no date: Email the advisor')
  expect(tudo).toContain('⚑ 2 to review')
  expect(tudo).toContain('source: DEADLINES.md')
})

test('no row of the pane is wider than the pane, even when a window runs out', () => {
  // Found in a real session: "runs out" next to the projection was cut off at 50 columns.
  const uso = {
    tokens: 412_000,
    janela: 1_000_000,
    pct: 41,
    limiar: 800_000,
    limites: [
      { kind: 'five_hour', pct: 49, reset: AGORA + 3.8 * H },
      { kind: 'seven_day', pct: 33, reset: AGORA + 4.6 * 24 * H },
    ],
    usd: 0,
  }
  const filas = painel(uso, [300_000, 350_000, 412_000], RADAR, AGORA, 50)
  const tudo = filas.map(texto)
  expect(tudo.filter(l => [...l].length > 50)).toEqual([])
  expect(tudo.some(l => /^ {6}runs out ~/.test(l))).toBe(true)
})

test('with no deadline source, the pane explains how to add one', () => {
  const tudo = painel(null, [], null, AGORA, 50, 'todo.md').map(texto).join('\n')
  expect(tudo).toContain('create todo.md')
  expect(tudo).toContain('2026-10-15 Submit the report !')
})

// ---------------------------------------------------------------- in the engine

const BAND = {
  plugin: 'brain-dash',
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 } },
}
const PANE = (surface: 'terminal' | 'desktop') => ({
  plugin: 'brain-dash',
  component: 'Pane' as const,
  requestId: 'brain',
  surface,
  props: { title: 'brain-dash', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

const USO = {
  startedAt: 0,
  context: { tokens: 420_000, window: 1_000_000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
  cost: { usd: 1.5 },
}

/** The world beneath the mod. `ficheiro` null = no file; `saida` null = the command fails. */
type Mundo = {
  ficheiro: string | null
  mtime?: number
  saida?: string | null
  uso?: () => typeof USO
  colocado?: boolean
}

let avisos: string[] = []
let corridos: string[][] = []
let lidos: string[] = []

function motor(on: On, mundo: Mundo) {
  avisos = []
  corridos = []
  lidos = []
  const clock = mock.clock(on, { now: AGORA })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.invalidate', () => ({ value: undefined }))
  // The band with nobody else: what the engine (and other mods) would draw beneath this one.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  // By default the terminal is narrow and the pane waits for room: the band shows the summary.
  on('ui.open', () => ({ value: mundo.colocado ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    avisos.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/proj' }))
  on('fs.exists', () => ({ value: mundo.ficheiro !== null }))
  on('fs.read', (_$, e) => {
    lidos.push(e.path)
    return { value: mundo.ficheiro ?? '' }
  })
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: mundo.mtime ?? 0, isLink: false } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: mundo.uso ? mundo.uso() : USO }))
  on('process.run', (_$, e) => {
    corridos.push([...e.argv])
    return {
      value:
        mundo.saida === null || mundo.saida === undefined
          ? { exitCode: 1, stdout: '', stderr: 'ModuleNotFoundError: yaml', isStdoutTruncated: false, isStderrTruncated: false }
          : { exitCode: 0, stdout: mundo.saida, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  return clock
}

const INICIO = { surface: 'terminal', isInteractive: true, cwd: '/proj' } as const

test('in a narrow terminal, the band joins usage and DEADLINES.md on every surface', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO })
  await $.session.start(INICIO)
  await clock.settle()
  expect(lidos.length).toBe(1)
  expect(lidos[0]).toMatch(/proj[\\/]DEADLINES\.md$/) // the engine normalises the path to the OS
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
    expect(await ui.find({ text: /Oct 13 2d Networks/ })).toBeDefined()
    await ui.unmount()
  }
})

test('with the pane beside the code the band goes quiet; /brain closes it and the band returns', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO, colocado: true })
  await $.session.start(INICIO)
  await clock.settle()
  const antes = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await antes.find({ text: /ctx 42%/ })).toBeUndefined()
  await antes.unmount()
  await $.command.run({ command: 'brain', args: '', origin: { kind: 'composer' } } as never)
  await clock.settle()
  const depois = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await depois.find({ text: /ctx 42%/ })).toBeDefined()
  await depois.unmount()
})

test(
  'with radar_command, the radar comes from the command and the file is not read',
  { options: { radar_command: 'python scripts/radar.py --json' } },
  async ($, on) => {
    const saida = JSON.stringify({ deadlines: [{ date: '2026-10-14', text: 'Exam', critical: true }] })
    const clock = motor(on, { ficheiro: FICHEIRO, saida })
    await $.session.start(INICIO)
    await clock.settle()
    expect(corridos).toEqual([['python', 'scripts/radar.py', '--json']])
    expect(lidos).toEqual([])
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
    expect(await ui.find({ text: /Oct 14 3d Exam/ })).toBeDefined()
    await ui.unmount()
  },
)

test('a failing command makes the band shout instead of going quiet', { options: { radar_command: 'python radar.py' } }, async ($, on) => {
  const clock = motor(on, { ficheiro: null, saida: null })
  await $.session.start(INICIO)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /RADAR FAILED/ })).toBeDefined()
  await ui.unmount()
})

test('with no file and no command there is no radar: usage in the band, the hint in the pane', async ($, on) => {
  const clock = motor(on, { ficheiro: null, colocado: true })
  await $.session.start(INICIO)
  await clock.settle()
  expect(corridos).toEqual([]) // nothing runs unless the person asks for it
  const pane = await $.ui.mount(PANE('terminal') as never)
  expect(await pane.find({ text: /create DEADLINES\.md/ })).toBeDefined()
  await pane.unmount()
  await $.command.run({ command: 'brain', args: '', origin: { kind: 'composer' } } as never) // closes it
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
  expect(await ui.find({ text: /Networks|RADAR/ })).toBeUndefined()
  await ui.unmount()
})

test('the pane draws the bars, the calendar and the list, in the terminal and on Desktop', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO, colocado: true })
  await $.session.start(INICIO)
  await clock.settle() // the pane opens on its own at startup
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface) as never)
    expect(await ui.find({ text: /^CONTEXT$/ })).toBeDefined()
    expect(await ui.find({ text: /^█+$/ })).toBeDefined() // the context bar
    expect(await ui.find({ text: /5-HOUR WINDOW/ })).toBeDefined()
    expect(await ui.find({ text: /■/ })).toBeDefined() // the calendar
    expect(await ui.find({ text: /Networks — project 1/ })).toBeDefined()
    expect(await ui.find({ key: 'atualizar' })).toBeDefined()
    await ui.unmount()
  }
})

test('a file edited mid-session is read again at the end of the next turn', async ($, on) => {
  const mundo: Mundo = { ficheiro: FICHEIRO, mtime: 0 }
  const clock = motor(on, mundo)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(INICIO)
  await clock.settle()
  mundo.ficheiro = '2026-10-12 New deadline !'
  mundo.mtime = AGORA + 60_000
  await clock.advance(120_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answered' } as never)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /Oct 12 tomorrow New deadline/ })).toBeDefined()
  await ui.unmount()
})

test('only the main conversation turns count towards the context pace', async ($, on) => {
  let tokens = 400_000
  const uso = () => ({ ...USO, context: { ...USO.context, tokens, percent: tokens / 10_000 } })
  const clock = motor(on, { ficheiro: FICHEIRO, uso })
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(INICIO)
  await clock.settle()
  const fim = (agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answered', ...(agentId ? { agentId } : {}) } as never)
  await fim()
  tokens = 420_000
  await fim('worker-1') // a subagent: must not enter the series
  await fim()
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  // two main turns, 400k → 420k: +20k per turn, ~29 turns until 1M is full
  expect(await ui.find({ text: /ctx 42% ~29 turns/ })).toBeDefined()
  await ui.unmount()
})

test('when the pane does not fit, it says why and how to open it instead of staying quiet', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO }) // narrow terminal
  await $.session.start(INICIO)
  await clock.settle()
  expect(avisos.length).toBe(1)
  expect(avisos[0]).toContain('narrow')
  expect(avisos[0]).toContain('/brain')
})

test('with room, the pane opens without a toast', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO, colocado: true })
  await $.session.start(INICIO)
  await clock.settle()
  expect(avisos).toEqual([])
})
