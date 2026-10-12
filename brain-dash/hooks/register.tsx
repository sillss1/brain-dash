// brain-dash: um painel ao lado do código com o uso de tokens (barras e projeção) e o radar de
// prazos do AI-Brain (calendário de 21 dias). Abre sozinho no arranque; /brain volta a abri-lo.
// Com o painel fechado ou sem lugar (terminal estreito), o resumo fica numa banda acima do prompt.
//
// Alcance pequeno de propósito (research/tooling/2026-10-11-mods-do-claude-code-o-que-tocam-e-o-
// que-vale-a-pena-para-o-a.md): não ouve tool.call nem prompt.submit, não vai à rede, e o único
// processo que arranca é o `agenda.py --json` do próprio vault, que também não vai à rede.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage, TextProps } from 'claude-code'

import type { Radar, Uso } from '../types'
import { banda, painel } from './calc'
import type { Linha, Seg } from './calc'

const PANE = 'brain'
const LARGURA = 50 // colunas pedidas para o painel ancorado ao lado da conversa
const RADAR_MS = 30 * 60_000 // o radar muda de dia para dia; meia hora chega

const uso = atom({ plugin: 'brain-dash', key: 'uso' } as const, null)
const amostras = atom({ plugin: 'brain-dash', key: 'amostras' } as const, [])
const radar = atom({ plugin: 'brain-dash', key: 'radar' } as const, null)
const aberto = atom({ plugin: 'brain-dash', key: 'aberto' } as const, false)

function deMedida(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>, limiar: number | undefined): Uso {
  return {
    tokens: u.context.tokens,
    janela: u.context.window,
    pct: u.context.percent,
    limiar,
    limites: u.rateLimits.map(l => {
      const reset = l.resetsAt ? Date.parse(l.resetsAt) : NaN
      return Number.isFinite(reset) ? { kind: l.kind, pct: l.percentUsed, reset } : { kind: l.kind, pct: l.percentUsed }
    }),
    usd: u.cost?.usd,
  }
}

// Fora do AI-Brain (o mod pode estar instalado para todos os projetos) não há radar: o painel e a
// banda mostram só o uso. Variável do módulo: um reload volta a descobrir no session.start.
let semVault = false
let aLer: Promise<void> | undefined

async function lerRadar($: EngineInterface): Promise<void> {
  const raiz = await $.session.root()
  const script = `${raiz}/system/scripts/agenda.py`
  if (!(await $.fs.exists(script))) {
    semVault = true
    await update($, radar, () => null)
    return
  }
  semVault = false
  const agora = await $.clock.now()
  // A mesma ordem que o session-start.js: o venv da máquina; sem ele, o agenda.py só precisa
  // de pyyaml, e o python do sistema chega.
  const pythons: string[] = []
  for (const p of [`${raiz}/system/.venv/Scripts/python.exe`, `${raiz}/system/.venv/bin/python`]) {
    if (await $.fs.exists(p)) pythons.push(p)
  }
  pythons.push('python3', 'python')
  let falha = 'nenhum python encontrado'
  for (const py of pythons) {
    try {
      const r = await $.process.run([py, script, '--json'], { cwd: raiz, timeoutMs: 20_000 })
      if (r.exitCode !== 0) {
        falha = `${py} saiu com ${r.exitCode}: ${r.stderr.trim().slice(0, 160)}`
        continue
      }
      const dados = JSON.parse(r.stdout) as Omit<Radar, 'lidoEm'>
      await update($, radar, () => ({ ...dados, lidoEm: agora }))
      return
    } catch (err) {
      falha = `${py}: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  // Silêncio não pode significar duas coisas: um radar que não correu diz que não correu.
  await update($, radar, () => ({
    hoje: '',
    janela_dias: 0,
    prazos: [],
    sem_data: [],
    por_espelhar: [],
    sem_avaliacao: [],
    falha,
    lidoEm: agora,
  }))
}

function refrescarRadar($: EngineInterface): Promise<void> {
  aLer ??= lerRadar($).finally(() => {
    aLer = undefined
  })
  return aLer
}

/** No fim de cada turno: o ritmo do contexto, e o radar se estiver velho ou o YAML mudou. */
async function fimDeTurno($: EngineInterface): Promise<void> {
  const u = await $.session.usage({ breakdown: 'summary' }) // estimado localmente, sem pedidos
  const b = u.context.breakdown
  const limiar = b?.isAutoCompactEnabled ? b.autoCompactThreshold : undefined
  await update($, uso, () => deMedida(u, limiar))
  const tokens = u.context.tokens
  if (tokens !== undefined) await update($, amostras, s => [...s, tokens].slice(-24))

  if (semVault) return
  const r = await read($, radar)
  const agora = await $.clock.now()
  let velho = !r || agora - r.lidoEm > RADAR_MS
  if (!velho && r) {
    const yaml = `${await $.session.root()}/personal/academic-deadlines.yaml`
    const st = await $.fs.stat(yaml).catch(() => undefined)
    velho = st !== undefined && st.mtimeMs > r.lidoEm
  }
  if (velho) void refrescarRadar($)
}

async function recomecar($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  await update($, uso, prev => deMedida(u, prev?.limiar))
  await refrescarRadar($)
}

/**
 * Abre o painel. Sem ser a pessoa a pedir, só tem lugar num terminal largo (>= 144 colunas; 110
 * depois de o abrir à mão uma vez) — e quando não cabe, o motor deixa-o à espera em silêncio. Foi
 * assim que a primeira instalação pareceu "não ficar" (11 out 2026): diz-se sempre porquê.
 */
async function abrir($: EngineInterface): Promise<void> {
  const r = await $.ui.open({ id: PANE, title: 'AI-Brain', columns: LARGURA })
  await update($, aberto, () => r.isPlaced)
  if (!r.isPlaced) {
    $.ui.toast(`brain-dash: o painel não coube (${r.reason}). /brain abre-o já; ao lado do código precisa de /tui fullscreen.`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'brain',
      description: 'AI-Brain: painel ao lado do código com contexto, limites com projeção e radar de prazos',
    })
    $.clock.every(RADAR_MS, () => void refrescarRadar($))
    // As barras de tempo e as projeções andam com o relógio: redesenhar a cada minuto.
    $.clock.every(60_000, () => $.ui.invalidate('ui.render'))
    void recomecar($)
    void abrir($)

    return next(e)
  })

  // /clear, /resume e /branch repõem o $.state: voltar a ler tudo.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    void recomecar($)
    void abrir($)

    return next(e)
  }).catch(($, e, next) => next(e)) // não guarda nada: se falhar, o arranque segue como seguiria

  on('session.measure', async ($, e, next) => {
    await update($, uso, prev => deMedida(e, prev?.limiar))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const fim = await next(e)
    // Os turnos dos subagentes (os workers do `orquestrar`) também acabam aqui: não são ritmo
    // da conversa principal, e o contexto que o $.session.usage() mede é o dela.
    if (!e.agentId) await fimDeTurno($)

    return fim
  })

  // /brain é um interruptor: abre o painel, ou fecha-o se já estiver ao lado do código.
  on('command.run', { command: 'brain' }, async $ => {
    if (await read($, aberto)) {
      await $.ui.close({ id: PANE })
      return {}
    }
    await abrir($)
    void refrescarRadar($)

    return {}
  })

  // Fechado pela pessoa (ou pelo motor): a banda volta a mostrar o resumo.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await update($, aberto, () => false)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A banda é partilhada (o you-should-know também escreve aqui): o que os de baixo desenham fica.
    const deles = await next(e)
    if (e.props.hasSurvey || (await read($, aberto))) return deles
    const segs = banda(await read($, uso), await read($, amostras), await read($, radar), await $.clock.now())
    if (segs.length === 0) return deles

    const { Box, Text } = $.ui.resolve(e)
    const pedaco = (s: Linha) => (s.cor ? <Text color={s.cor}>{s.texto}</Text> : <Text dimColor>{s.texto}</Text>)
    const filhos = segs.flatMap((s, i) => (i === 0 ? [pedaco(s)] : [<Text dimColor> │ </Text>, pedaco(s)]))
    const linha = <Text wrap="truncate-end">{filhos}</Text>

    return deles ? (
      <Box flexDirection="column">
        {deles}
        {linha}
      </Box>
    ) : (
      linha
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const filas = painel(
      await read($, uso),
      await read($, amostras),
      await read($, radar),
      await $.clock.now(),
      Math.max(20, e.props.bodyColumns),
    )
    // Props só as que existem: um `color: undefined` não é o mesmo que não ter cor.
    const seg = (s: Seg) => {
      const p: TextProps = {}
      if (s.cor) p.color = s.cor
      if (s.dim) p.dimColor = true
      if (s.bold) p.bold = true
      return <Text {...p}>{s.t}</Text>
    }

    return (
      <Box flexDirection="column">
        {filas.map(f => (f.length === 0 ? <Text> </Text> : <Text wrap="truncate-end">{f.map(seg)}</Text>))}
        <Text> </Text>
        <Button key="atualizar" label="atualizar radar" hotkey="r" plain onPress={() => void refrescarRadar($)} />
      </Box>
    )
  })
}
