import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { banda, barra, calendario, painel, projetar, sparkline, turnosAte } from '../hooks/calc'
import type { Fila } from '../hooks/calc'
import type { Radar } from '../types'

const H = 3_600_000
const texto = (f: Fila) => f.map(s => s.t).join('')

// ---------------------------------------------------------------- projeções

test('a janela de 5h projeta ao ritmo médio desde que abriu', () => {
  const reset = 10 * H
  // a meio da janela (2,5 h decorridas) com 50 %: acaba nos 100 %, não esgota antes
  expect(projetar(50, reset, reset - 2.5 * H, 5 * H)).toEqual({ pct: 50, projetado: 100 })
  // com 60 % a meio: 120 % no reset, esgota quando faltarem 40 pontos a 24 %/h = 1h40
  const p = projetar(60, reset, reset - 2.5 * H, 5 * H)
  expect(Math.round(p.projetado ?? 0)).toBe(120)
  expect(p.esgotaEm).toBe(reset - 2.5 * H + (40 / 60) * 2.5 * H)
})

test('cedo demais na janela, ou sem reset, não projeta', () => {
  expect(projetar(10, 5 * H, 0.1 * H, 5 * H)).toEqual({ pct: 10 }) // 2 % da janela decorrida
  expect(projetar(10, undefined, 0, 5 * H)).toEqual({ pct: 10 })
})

test('o ritmo do contexto só conta a subida desde a última compactação', () => {
  expect(turnosAte([100_000, 120_000, 140_000], 140_000, 200_000)).toEqual({ porTurno: 20_000, turnos: 3 })
  // a descida (compactação) corta a série: o ritmo é o de depois
  expect(turnosAte([100_000, 150_000, 30_000, 40_000], 40_000, 200_000)).toEqual({ porTurno: 10_000, turnos: 16 })
  expect(turnosAte([50_000], 50_000, 200_000)).toEqual({}) // um turno não é ritmo
})

// ---------------------------------------------------------------- desenho

test('uma barra tem sempre a largura pedida: cheio, projeção, vazio e o marco', () => {
  const b = barra(20, 0.5, 'success', 0.75, 0.9)
  expect(texto(b)).toBe('██████████▒▒▒▒▒░░░│░') // marco a 0,9 de 20 células: índice 18
  expect(texto(barra(10, 1.4, 'error', 2))).toBe('██████████') // passar dos 100 % não alarga
  expect(sparkline([0, 500_000, 1_000_000], 1_000_000, 3)).toBe('▁▅█')
})

// ---------------------------------------------------------------- radar

const RADAR: Radar = {
  hoje: '2026-10-11',
  janela_dias: 21,
  prazos: [
    { data: '2026-10-09', dias: -2, quando: '09/10 VENCIDO 2d', texto: 'Feira de emprego — inscrição', critico: false },
    { data: '2026-10-13', dias: 2, quando: '13/10 2d', texto: 'Redes — trabalho 1 [CRITICO]', critico: true },
    { data: '2026-10-18', dias: 7, quando: '18/10 7d', texto: 'Bases de dados — 1.ª entrega [8%]', critico: false },
  ],
  sem_data: ['Orientador — email'],
  por_espelhar: [{ data: '2026-10-20', texto: 'Moodle: quiz' }],
  sem_avaliacao: [],
  falha: null,
  lidoEm: 0,
}

test('o calendário começa hoje e pinta cada dia com a pior cor que lá cai', () => {
  const dias = calendario(RADAR, 21)
  expect(dias.length).toBe(21)
  expect(dias[0]).toEqual({ iso: '2026-10-11', letra: 'D' }) // 11 out 2026 é domingo
  expect(dias[2]).toEqual({ iso: '2026-10-13', letra: 'T', cor: 'error' }) // o crítico
  expect(dias[7]).toEqual({ iso: '2026-10-18', letra: 'D', cor: 'suggestion' }) // longe e normal
  expect(dias.filter(d => d.cor).length).toBe(2) // o vencido fica fora do calendário, não da lista
})

test('a banda mostra os vencidos e o próximo prazo, a vermelho quando é crítico', () => {
  expect(banda(null, [], RADAR, 0)).toEqual([
    { texto: '1 vencido', cor: 'error' },
    { texto: '13/10 2d Redes — trabalho 1 [CRITICO] +1', cor: 'error' },
  ])
})

test('um radar que falhou diz que falhou, na banda e no painel', () => {
  const partido: Radar = { ...RADAR, prazos: [], falha: 'python3 saiu com 1: yaml' }
  expect(banda(null, [], partido, 0)).toEqual([{ texto: 'RADAR FALHOU — /brain', cor: 'error' }])
  const tudo = painel(null, [], partido, 0, 50).map(texto).join('\n')
  expect(tudo).toContain('RADAR FALHOU')
  expect(tudo).toContain('python3 saiu com 1')
})

test('o painel não perde os vencidos, os críticos sem data nem os por espelhar', () => {
  const tudo = painel(null, [], RADAR, 0, 50).map(texto).join('\n')
  expect(tudo).toContain('09/10 VENCIDO 2d')
  expect(tudo).toContain('⚑ sem data: Orientador — email')
  expect(tudo).toContain('⚑ 1 por espelhar')
})

// ---------------------------------------------------------------- no motor

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
  props: { title: 'AI-Brain', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

const USO = {
  startedAt: 0,
  context: { tokens: 420_000, window: 1_000_000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
  cost: { usd: 1.5 },
}

type Opcoes = { vault: boolean; radar: string | null; uso?: () => typeof USO; colocado?: boolean }

let avisos: string[] = []

function motor(on: On, opcoes: Opcoes) {
  avisos = []
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.invalidate', () => ({ value: undefined }))
  // A banda sem mais ninguém: o que o motor (e o you-should-know) desenharia por baixo do mod.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  // Por omissão o terminal é estreito e o painel fica à espera de lugar: a banda mostra o resumo.
  on('ui.open', () => ({ value: opcoes.colocado ? { isPlaced: true } : { isPlaced: false, reason: 'narrow' } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => {
    avisos.push(String((e as { text?: unknown }).text ?? JSON.stringify(e)))
    return { value: undefined }
  })
  on('session.root', () => ({ value: '/vault' }))
  on('fs.exists', () => ({ value: opcoes.vault }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: opcoes.uso ? opcoes.uso() : USO }))
  on('process.run', () => ({
    value:
      opcoes.radar === null
        ? { exitCode: 1, stdout: '', stderr: 'ModuleNotFoundError: yaml', isStdoutTruncated: false, isStderrTruncated: false }
        : { exitCode: 0, stdout: opcoes.radar, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  return clock
}

test('com o terminal estreito, a banda junta o uso e o radar em todas as superfícies', async ($, on) => {
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle()
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
    expect(await ui.find({ text: /13\/10 2d Redes/ })).toBeDefined()
    await ui.unmount()
  }
})

test('com o painel ao lado do código, a banda cala-se; /brain fecha-o e ela volta', async ($, on) => {
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR), colocado: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
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

test('sem python que sirva, a banda grita em vez de ficar calada', async ($, on) => {
  const clock = motor(on, { vault: true, radar: null })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /RADAR FALHOU/ })).toBeDefined()
  await ui.unmount()
})

test('fora do AI-Brain não há radar, só o uso', async ($, on) => {
  const clock = motor(on, { vault: false, radar: JSON.stringify(RADAR) })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/outro' })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
  expect(await ui.find({ text: /Redes|RADAR/ })).toBeUndefined()
  await ui.unmount()
})

test('o painel desenha barras, o calendário e a lista, no terminal e no Desktop', async ($, on) => {
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR), colocado: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle() // o painel abre-se sozinho no arranque
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(PANE(surface) as never)
    expect(await ui.find({ text: /^CONTEXTO$/ })).toBeDefined()
    expect(await ui.find({ text: /^█+$/ })).toBeDefined() // a barra do contexto
    expect(await ui.find({ text: /JANELA 5H/ })).toBeDefined()
    expect(await ui.find({ text: /■/ })).toBeDefined() // o calendário
    expect(await ui.find({ text: /Redes — trabalho 1/ })).toBeDefined()
    expect(await ui.find({ key: 'atualizar' })).toBeDefined()
    await ui.unmount()
  }
})

test('só os turnos da conversa principal contam para o ritmo do contexto', async ($, on) => {
  let tokens = 400_000
  const uso = () => ({ ...USO, context: { ...USO.context, tokens, percent: tokens / 10_000 } })
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR), uso })
  on('turn.complete', () => ({ text: '' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 0, isLink: false } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle()
  const fim = (agentId?: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answered', ...(agentId ? { agentId } : {}) } as never)
  await fim()
  tokens = 420_000
  await fim('worker-1') // um subagente: não pode entrar na série
  await fim()
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  // dois turnos principais, 400k → 420k: +20k por turno, ~29 turnos até encher 1M
  expect(await ui.find({ text: /ctx 42% ~29 turnos/ })).toBeDefined()
  await ui.unmount()
})

test('quando o painel não cabe, diz porquê e como o abrir, em vez de ficar calado', async ($, on) => {
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR) }) // terminal estreito
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle()
  expect(avisos.length).toBe(1)
  expect(avisos[0]).toContain('narrow')
  expect(avisos[0]).toContain('/brain')
})

test('com lugar, o painel abre sem aviso', async ($, on) => {
  const clock = motor(on, { vault: true, radar: JSON.stringify(RADAR), colocado: true })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/vault' })
  await clock.settle()
  expect(avisos).toEqual([])
})
