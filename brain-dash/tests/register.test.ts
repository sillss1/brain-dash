import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { banda, barra, calendario, painel, projetar, sparkline, turnosAte } from '../hooks/calc'
import type { Fila } from '../hooks/calc'
import { config, lerFonte, lerJson, lerLinhas, montar, partirComando, quando } from '../hooks/radar'
import type { Radar } from '../types'

const H = 3_600_000
const texto = (f: Fila) => f.map(s => s.t).join('')
// Meio-dia de domingo, 11 out 2026, no fuso da máquina: o "hoje" não depende de onde o teste corre.
const AGORA = new Date(2026, 9, 11, 12, 0).getTime()

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

test('uma barra tem sempre a largura pedida: cheio, projeção, vazio e o marco', () => {
  const b = barra(20, 0.5, 'success', 0.75, 0.9)
  expect(texto(b)).toBe('██████████▒▒▒▒▒░░░│░') // marco a 0,9 de 20 células: índice 18
  expect(texto(barra(10, 1.4, 'error', 2))).toBe('██████████') // passar dos 100 % não alarga
  expect(sparkline([0, 500_000, 1_000_000], 1_000_000, 3)).toBe('▁▅█')
})

// ---------------------------------------------------------------- fontes do radar

const FICHEIRO = [
  '# Prazos',
  'Notas soltas sem data ficam de fora.',
  '- [ ] 2026-10-13 Redes — trabalho 1 !',
  '- [x] 2026-10-12 Já entregue',
  '- 18/10/2026 Bases de dados: 1.ª entrega',
  '2026-10-09 Feira de emprego — inscrição',
  '- Orientador — email !',
  '2026-02-30 data que não existe',
].join('\n')

test('o formato simples: uma data por linha, ! no fim é crítico, caixas marcadas saem', () => {
  expect(lerLinhas(FICHEIRO)).toEqual({
    prazos: [
      { data: '2026-10-13', texto: 'Redes — trabalho 1', critico: true },
      { data: '2026-10-18', texto: 'Bases de dados: 1.ª entrega', critico: false },
      { data: '2026-10-09', texto: 'Feira de emprego — inscrição', critico: false },
    ],
    sem_data: ['Orientador — email'],
    avisos: [],
  })
})

test('o JSON aceita lista ou objeto, chaves em português ou inglês, e a saída do agenda.py', () => {
  const lista = [{ date: '2026-10-15', text: 'Report', critical: true }]
  expect(lerJson(lista).prazos).toEqual([{ data: '2026-10-15', texto: 'Report', critico: true }])
  const ingles = { deadlines: lista, undated: ['Call the lab'], warnings: ['2 to review'] }
  expect(lerJson(ingles)).toEqual({
    prazos: [{ data: '2026-10-15', texto: 'Report', critico: true }],
    sem_data: ['Call the lab'],
    avisos: ['2 to review'],
  })
  // O agenda.py --json do AI-Brain traz campos a mais (dias, quando, por_espelhar...): ignoram-se.
  const agenda = {
    hoje: '2026-10-11',
    prazos: [{ data: '2026-10-13', dias: 2, quando: '13/10 2d', texto: 'Redes [CRITICO]', critico: true }],
    sem_data: ['Orientador — email'],
    por_espelhar: [{ data: null, texto: 'x' }],
  }
  expect(lerFonte(JSON.stringify(agenda), '').prazos).toEqual([{ data: '2026-10-13', texto: 'Redes [CRITICO]', critico: true }])
  expect(() => lerJson({ outra: 1 })).toThrow('prazos')
})

test('a janela corta o longe e os vencidos antigos, mas um crítico vencido fica', () => {
  const r = montar(
    {
      prazos: [
        { data: '2026-10-13', texto: 'perto', critico: false },
        { data: '2026-11-30', texto: 'longe', critico: false },
        { data: '2026-09-01', texto: 'vencido antigo', critico: false },
        { data: '2026-09-01', texto: 'crítico antigo', critico: true },
        { data: '2026-10-11', texto: 'hoje', critico: false },
        { data: '2026-10-12', texto: 'amanhã', critico: false },
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
    '01/09 VENCIDO 40d crítico antigo',
    '11/10 HOJE hoje',
    '12/10 amanhã amanhã',
    '13/10 2d perto',
  ])
  expect(quando('2026-10-09', -2)).toBe('09/10 VENCIDO 2d')
})

test('o comando parte-se como numa shell simples, e as opções têm valores por omissão', () => {
  expect(partirComando(`python "scripts/my radar.py" --json ''`)).toEqual(['python', 'scripts/my radar.py', '--json', ''])
  expect(config({})).toEqual({ ficheiro: 'DEADLINES.md', comando: [], dias: 21 })
  expect(config({ radar_file: ' todo.md ', radar_command: 'make radar', radar_days: 400 })).toEqual({
    ficheiro: 'todo.md',
    comando: ['make', 'radar'],
    dias: 90,
  })
})

// ---------------------------------------------------------------- desenho do radar

const RADAR: Radar = montar(lerLinhas(FICHEIRO), AGORA, 21, 'DEADLINES.md')

test('o calendário começa hoje e pinta cada dia com a pior cor que lá cai', () => {
  const dias = calendario(RADAR, 21)
  expect(dias.length).toBe(21)
  expect(dias[0]).toEqual({ iso: '2026-10-11', letra: 'D' }) // 11 out 2026 é domingo
  expect(dias[2]).toEqual({ iso: '2026-10-13', letra: 'T', cor: 'error' }) // o crítico
  expect(dias[7]).toEqual({ iso: '2026-10-18', letra: 'D', cor: 'suggestion' }) // longe e normal
  expect(dias.filter(d => d.cor).length).toBe(2) // o vencido fica fora do calendário, não da lista
})

test('a banda mostra os vencidos e o próximo prazo, a vermelho quando é crítico', () => {
  expect(banda(null, [], RADAR, AGORA)).toEqual([
    { texto: '1 vencido', cor: 'error' },
    { texto: '13/10 2d Redes — trabalho 1 +1', cor: 'error' },
  ])
})

test('um radar que falhou diz que falhou e de onde, na banda e no painel', () => {
  const partido: Radar = { ...RADAR, prazos: [], falha: 'saiu com 1: yaml', fonte: 'python radar.py' }
  expect(banda(null, [], partido, AGORA)).toEqual([{ texto: 'RADAR FALHOU — /brain', cor: 'error' }])
  const tudo = painel(null, [], partido, AGORA, 50).map(texto).join('\n')
  expect(tudo).toContain('RADAR FALHOU')
  expect(tudo).toContain('saiu com 1')
  expect(tudo).toContain('fonte: python radar.py')
})

test('o painel não perde os vencidos, os críticos sem data, os avisos nem a fonte', () => {
  const tudo = painel(null, [], { ...RADAR, avisos: ['2 por rever'] }, AGORA, 50).map(texto).join('\n')
  expect(tudo).toContain('09/10 VENCIDO 2d')
  expect(tudo).toContain('⚑ sem data: Orientador — email')
  expect(tudo).toContain('⚑ 2 por rever')
  expect(tudo).toContain('fonte: DEADLINES.md')
})

test('sem fonte de prazos, o painel ensina a criar uma', () => {
  const tudo = painel(null, [], null, AGORA, 50, 'todo.md').map(texto).join('\n')
  expect(tudo).toContain('cria todo.md')
  expect(tudo).toContain('2026-10-15 Entregar o relatório !')
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
  props: { title: 'brain-dash', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
})

const USO = {
  startedAt: 0,
  context: { tokens: 420_000, window: 1_000_000, percent: 42 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
  cost: { usd: 1.5 },
}

/** O mundo por baixo do mod. `ficheiro` null = não existe; `saida` null = o comando falha. */
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
  // A banda sem mais ninguém: o que o motor (e outros mods) desenhariam por baixo deste.
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  // Por omissão o terminal é estreito e o painel fica à espera de lugar: a banda mostra o resumo.
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

test('com o terminal estreito, a banda junta o uso e o DEADLINES.md em todas as superfícies', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO })
  await $.session.start(INICIO)
  await clock.settle()
  expect(lidos.length).toBe(1)
  expect(lidos[0]).toMatch(/proj[\\/]DEADLINES\.md$/) // o motor normaliza o caminho ao sistema
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
    expect(await ui.find({ text: /13\/10 2d Redes/ })).toBeDefined()
    await ui.unmount()
  }
})

test('com o painel ao lado do código, a banda cala-se; /brain fecha-o e ela volta', async ($, on) => {
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
  'com radar_command, o radar vem do comando e o ficheiro nem se lê',
  { options: { radar_command: 'python scripts/radar.py --json' } },
  async ($, on) => {
    const saida = JSON.stringify({ deadlines: [{ date: '2026-10-14', text: 'Exam', critical: true }] })
    const clock = motor(on, { ficheiro: FICHEIRO, saida })
    await $.session.start(INICIO)
    await clock.settle()
    expect(corridos).toEqual([['python', 'scripts/radar.py', '--json']])
    expect(lidos).toEqual([])
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
    expect(await ui.find({ text: /14\/10 3d Exam/ })).toBeDefined()
    await ui.unmount()
  },
)

test('um comando que falha faz a banda gritar em vez de ficar calada', { options: { radar_command: 'python radar.py' } }, async ($, on) => {
  const clock = motor(on, { ficheiro: null, saida: null })
  await $.session.start(INICIO)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /RADAR FALHOU/ })).toBeDefined()
  await ui.unmount()
})

test('sem ficheiro nem comando não há radar: a banda mostra só o uso e o painel a dica', async ($, on) => {
  const clock = motor(on, { ficheiro: null, colocado: true })
  await $.session.start(INICIO)
  await clock.settle()
  expect(corridos).toEqual([]) // nada a correr sem a pessoa o pedir
  const pane = await $.ui.mount(PANE('terminal') as never)
  expect(await pane.find({ text: /cria DEADLINES\.md/ })).toBeDefined()
  await pane.unmount()
  await $.command.run({ command: 'brain', args: '', origin: { kind: 'composer' } } as never) // fecha
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /ctx 42%/ })).toBeDefined()
  expect(await ui.find({ text: /Redes|RADAR/ })).toBeUndefined()
  await ui.unmount()
})

test('o painel desenha barras, o calendário e a lista, no terminal e no Desktop', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO, colocado: true })
  await $.session.start(INICIO)
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

test('o ficheiro editado a meio da sessão relê-se no fim do turno seguinte', async ($, on) => {
  const mundo: Mundo = { ficheiro: FICHEIRO, mtime: 0 }
  const clock = motor(on, mundo)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start(INICIO)
  await clock.settle()
  mundo.ficheiro = '2026-10-12 Prazo novo !'
  mundo.mtime = AGORA + 60_000
  await clock.advance(120_000)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answered' } as never)
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ text: /12\/10 amanhã Prazo novo/ })).toBeDefined()
  await ui.unmount()
})

test('só os turnos da conversa principal contam para o ritmo do contexto', async ($, on) => {
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
  await fim('worker-1') // um subagente: não pode entrar na série
  await fim()
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  // dois turnos principais, 400k → 420k: +20k por turno, ~29 turnos até encher 1M
  expect(await ui.find({ text: /ctx 42% ~29 turnos/ })).toBeDefined()
  await ui.unmount()
})

test('quando o painel não cabe, diz porquê e como o abrir, em vez de ficar calado', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO }) // terminal estreito
  await $.session.start(INICIO)
  await clock.settle()
  expect(avisos.length).toBe(1)
  expect(avisos[0]).toContain('narrow')
  expect(avisos[0]).toContain('/brain')
})

test('com lugar, o painel abre sem aviso', async ($, on) => {
  const clock = motor(on, { ficheiro: FICHEIRO, colocado: true })
  await $.session.start(INICIO)
  await clock.settle()
  expect(avisos).toEqual([])
})
