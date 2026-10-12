// Lógica pura do brain-dash: projeções, a banda acima do prompt e o painel ao lado do código.
// Sem `$`, para os testes a poderem chamar diretamente. De onde vêm os prazos é o radar.ts.
import type { Radar, Uso } from '../types'

export const JANELAS: Record<string, { nome: string; ms: number }> = {
  five_hour: { nome: '5h', ms: 5 * 3_600_000 },
  seven_day: { nome: 'week', ms: 7 * 86_400_000 },
}
const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type Cor = 'error' | 'warning'
export type Linha = { texto: string; cor?: Cor }
export type Projecao = { pct: number; projetado?: number; esgotaEm?: number }

/**
 * Onde a janela acaba ao ritmo médio que levou desde que abriu. Linear de propósito: é uma
 * estimativa, e nos primeiros 5 % da janela a média ainda não quer dizer nada.
 */
export function projetar(pct: number, reset: number | undefined, agora: number, janelaMs: number): Projecao {
  if (reset === undefined) return { pct }
  const decorrido = agora - (reset - janelaMs)
  if (pct <= 0 || decorrido < janelaMs * 0.05) return { pct }
  const ritmo = pct / decorrido
  const projetado = pct + ritmo * Math.max(0, reset - agora)
  if (projetado <= 100) return { pct, projetado }
  return { pct, projetado, esgotaEm: agora + Math.max(0, 100 - pct) / ritmo }
}

/**
 * Turnos até o contexto chegar ao limite, ao ritmo dos últimos turnos. Só conta a subida desde
 * a última descida: uma compactação ou um /clear não são ritmo.
 */
export function turnosAte(
  serie: readonly number[],
  tokens: number | undefined,
  limite: number | undefined,
): { porTurno?: number; turnos?: number } {
  if (tokens === undefined || limite === undefined) return {}
  let inicio = 0
  for (let i = 1; i < serie.length; i++) if ((serie[i] ?? 0) < (serie[i - 1] ?? 0)) inicio = i
  const subida = serie.slice(inicio).slice(-6)
  const primeiro = subida[0]
  const ultimo = subida[subida.length - 1]
  if (subida.length < 2 || primeiro === undefined || ultimo === undefined) return {}
  const porTurno = (ultimo - primeiro) / (subida.length - 1)
  if (porTurno <= 0) return { porTurno }
  return { porTurno, turnos: Math.max(0, Math.floor((limite - tokens) / porTurno)) }
}

export function k(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

export function hora(ms: number, agora: number): string {
  const d = new Date(ms)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return new Date(agora).toDateString() === d.toDateString() ? hhmm : `${DIAS[d.getDay()]} ${hhmm}`
}

function corContexto(pct: number, turnos: number | undefined): Cor | undefined {
  if (pct >= 90 || (turnos !== undefined && turnos <= 2)) return 'error'
  if (pct >= 75 || (turnos !== undefined && turnos <= 5)) return 'warning'
  return undefined
}

function corLimite(p: Projecao): Cor | undefined {
  if (p.pct >= 90 || (p.projetado ?? 0) >= 100) return 'error'
  if ((p.projetado ?? p.pct) >= 80) return 'warning'
  return undefined
}

function corPrazo(dias: number, critico: boolean): Cor | undefined {
  if (dias < 0 || dias <= 2 || critico) return 'error'
  return dias <= 4 ? 'warning' : undefined
}

/** A linha acima do prompt (quando o painel não está aberto): contexto, janelas e o radar. */
export function banda(u: Uso | null, serie: readonly number[], r: Radar | null, agora: number): Linha[] {
  const seg: Linha[] = []
  if (u?.pct !== undefined) {
    const { turnos } = turnosAte(serie, u.tokens, u.limiar ?? u.janela)
    seg.push({
      texto: `ctx ${u.pct}%` + (turnos !== undefined ? ` ~${turnos} turns` : ''),
      cor: corContexto(u.pct, turnos),
    })
  }
  for (const l of u?.limites ?? []) {
    const j = JANELAS[l.kind]
    if (!j) continue
    const p = projetar(l.pct, l.reset, agora, j.ms)
    const proj = p.projetado !== undefined ? `→${Math.min(999, Math.round(p.projetado))}%` : ''
    const esgota = p.esgotaEm !== undefined ? ` runs out ${hora(p.esgotaEm, agora)}` : ''
    seg.push({ texto: `${j.nome} ${Math.round(l.pct)}%${proj}${esgota}`, cor: corLimite(p) })
  }
  if (r?.falha) {
    seg.push({ texto: 'RADAR FAILED — /brain', cor: 'error' })
  } else if (r) {
    const vencidos = r.prazos.filter(p => p.dias < 0).length
    if (vencidos) seg.push({ texto: `${vencidos} overdue`, cor: 'error' })
    const futuros = r.prazos.filter(p => p.dias >= 0)
    const prox = futuros[0]
    if (prox) {
      const resto = futuros.length > 1 ? ` +${futuros.length - 1}` : ''
      seg.push({ texto: `${prox.quando} ${prox.texto}${resto}`, cor: corPrazo(prox.dias, prox.critico) })
    }
  }
  return seg
}

// ---------------------------------------------------------------- o painel ao lado do código
//
// Tudo em texto com cor (blocos e pontos), não em Raster: o Raster é só do terminal, e assim o
// mesmo painel desenha-se no Desktop e os testes encontram-no por texto.

/** Um bocado de uma fila do painel. `cor` é uma chave do tema (segue o tema da pessoa). */
export type Seg = { t: string; cor?: string; dim?: boolean; bold?: boolean }
export type Fila = Seg[]

const NIVEIS = '▁▂▃▄▅▆▇█'
const LETRAS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] // Sun..Sat

/** Junta células do mesmo estilo num só segmento: menos elementos, o mesmo desenho. */
function juntar(celulas: Seg[]): Fila {
  const out: Fila = []
  for (const c of celulas) {
    const ult = out[out.length - 1]
    if (ult && ult.cor === c.cor && ult.dim === c.dim && ult.bold === c.bold) ult.t += c.t
    else out.push({ ...c })
  }
  return out
}

/** Título à esquerda e um valor encostado à direita, em `w` colunas. */
function titulo(esq: Seg, dir: Seg, w: number): Fila {
  return [esq, { t: ' '.repeat(Math.max(1, w - esq.t.length - dir.t.length)) }, dir]
}

/**
 * Uma barra de `w` células: cheia até `cheio` (0–1) na cor dada, sombreada até `sombra` (a
 * projeção), vazia no resto, e um marco opcional (o limiar de compactação).
 */
export function barra(w: number, cheio: number, cor: string, sombra = 0, marco?: number): Fila {
  const n = (f: number) => Math.max(0, Math.min(w, Math.round(f * w)))
  const a = n(cheio)
  const b = Math.max(a, n(sombra))
  const m = marco === undefined ? -1 : Math.min(w - 1, n(marco))
  const celulas: Seg[] = []
  for (let i = 0; i < w; i++) {
    if (i === m) celulas.push({ t: '│', cor: 'warning' })
    else if (i < a) celulas.push({ t: '█', cor })
    else if (i < b) celulas.push({ t: '▒', cor })
    else celulas.push({ t: '░', dim: true })
  }
  return juntar(celulas)
}

/** O contexto por turno, em 8 níveis, escalado ao limite (não ao máximo da série). */
export function sparkline(serie: readonly number[], limite: number, w: number): string {
  return serie
    .slice(-w)
    .map(v => NIVEIS[Math.max(0, Math.min(7, Math.floor((v / limite) * 8)))] ?? '▁')
    .join('')
}

function corPrazoVisual(dias: number, critico: boolean): string {
  return corPrazo(dias, critico) ?? 'suggestion'
}

/** Os próximos `dias` dias a partir de `r.hoje`, cada um com a pior cor dos prazos que lá caem. */
export function calendario(r: Radar, dias: number): { iso: string; letra: string; cor?: string }[] {
  const [y, m, d] = r.hoje.split('-').map(Number)
  const out: { iso: string; letra: string; cor?: string }[] = []
  for (let i = 0; i < dias; i++) {
    const dia = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + i))
    const iso = dia.toISOString().slice(0, 10)
    const letra = LETRAS[dia.getUTCDay()] ?? '?'
    const cores = r.prazos.filter(p => p.data === iso).map(p => corPrazoVisual(p.dias, p.critico))
    const cor = cores.includes('error') ? 'error' : cores.includes('warning') ? 'warning' : cores[0]
    out.push(cor ? { iso, letra, cor } : { iso, letra })
  }
  return out
}

function blocoContexto(u: Uso, serie: readonly number[], w: number): Fila[] {
  const pct = u.pct ?? 0
  const limite = u.limiar ?? u.janela
  const { porTurno, turnos } = turnosAte(serie, u.tokens, limite)
  const cor = corContexto(pct, turnos) ?? 'claude'
  const filas: Fila[] = [
    titulo({ t: 'CONTEXT', bold: true }, { t: `${pct}%`, cor, bold: true }, w),
    barra(w, pct / 100, cor, 0, u.limiar !== undefined ? u.limiar / u.janela : undefined),
    [
      {
        t: `${k(u.tokens ?? 0)} of ${k(u.janela)}` + (u.limiar !== undefined ? ` · │ compacts at ${k(u.limiar)}` : ''),
        dim: true,
      },
    ],
  ]
  if (serie.length >= 2) {
    const ritmo = turnos !== undefined && porTurno !== undefined ? ` +${k(porTurno)}/turn · ~${turnos} turns` : ''
    const largura = Math.max(4, Math.min(serie.length, w - ritmo.length - 1))
    filas.push([{ t: sparkline(serie, limite, largura), cor }, { t: ritmo, dim: true }])
  }
  return filas
}

function blocoJanela(l: { pct: number; reset?: number }, nome: string, ms: number, agora: number, w: number): Fila[] {
  const p = projetar(l.pct, l.reset, agora, ms)
  const cor = corLimite(p) ?? 'success'
  const reset = l.reset !== undefined ? `reset ${hora(l.reset, agora)}` : ''
  const tempo = l.reset !== undefined ? Math.max(0, Math.min(1, (agora - (l.reset - ms)) / ms)) : undefined
  const bw = Math.max(8, w - 11)
  const num = (x: number) => `${Math.round(x)}%`.padStart(5)
  const filas: Fila[] = [titulo({ t: nome, bold: true }, { t: reset, dim: true }, w)]
  if (tempo !== undefined) {
    filas.push([{ t: 'time  ', dim: true }, ...barra(bw, tempo, 'inactive'), { t: num(tempo * 100), dim: true }])
  }
  filas.push([
    { t: 'usage ', dim: true },
    ...barra(bw, l.pct / 100, cor, (p.projetado ?? 0) / 100),
    { t: num(l.pct), cor, bold: true },
  ])
  if (p.projetado !== undefined) {
    const linha: Fila = [{ t: `      ▒ at reset, at the average pace: ${Math.round(p.projetado)}%`, dim: true }]
    if (p.esgotaEm !== undefined) linha.push({ t: ` · runs out ~${hora(p.esgotaEm, agora)}`, cor: 'error', bold: true })
    filas.push(linha)
  } else {
    filas.push([{ t: '      too early in the window to project', dim: true }])
  }
  return filas
}

export function blocoRadar(r: Radar, agora: number, w: number): Fila[] {
  if (r.falha) {
    return [
      [{ t: 'RADAR FAILED', cor: 'error', bold: true }],
      [{ t: r.falha, cor: 'error' }],
      [{ t: "Don't assume there are no deadlines.", bold: true }],
      [{ t: `source: ${r.fonte}`, dim: true }],
    ]
  }
  const dias = calendario(r, r.janela_dias || 21)
  const cw = w >= dias.length * 2 ? 2 : 1
  const pad = (s: string) => s.padEnd(cw)
  const filas: Fila[] = [
    titulo({ t: `RADAR · ${dias.length} days`, bold: true }, { t: `read ${hora(r.lidoEm, agora)}`, dim: true }, w),
    juntar(dias.map((d, i) => (i === 0 ? { t: pad(d.letra), bold: true } : { t: pad(d.letra), dim: true }))),
    juntar(dias.map(d => (d.cor ? { t: pad('■'), cor: d.cor } : { t: pad('·'), dim: true }))),
    [{ t: '▲ today', dim: true }],
    [],
  ]
  for (const p of r.prazos) {
    filas.push([
      { t: '● ', cor: corPrazoVisual(p.dias, p.critico) },
      { t: `${p.quando.padEnd(18)} `, dim: p.dias > 4 && !p.critico },
      { t: p.texto },
    ])
  }
  if (r.prazos.length === 0) filas.push([{ t: `Nothing in the next ${r.janela_dias} days.`, dim: true }])
  if (r.sem_data.length) filas.push([{ t: '⚑ no date: ', cor: 'warning', bold: true }, { t: r.sem_data.join(' · ') }])
  for (const a of r.avisos) filas.push([{ t: '⚑ ', cor: 'warning' }, { t: a }])
  filas.push([], [{ t: `source: ${r.fonte}`, dim: true }])
  return filas
}

/** Sem fonte de prazos: diz como ter uma, em vez de deixar o lugar vazio. */
function semRadar(ficheiro: string): Fila[] {
  return [
    [{ t: 'RADAR', bold: true }],
    [{ t: `No deadlines yet: create ${ficheiro} at the`, dim: true }],
    [{ t: 'project root, one per line (! = critical):', dim: true }],
    [{ t: '  2026-10-15 Submit the report !', cor: 'suggestion' }],
    [{ t: 'or point radar_command at your own script.', dim: true }],
  ]
}

/**
 * O painel inteiro, fila a fila, para `w` colunas. Uma fila vazia é uma linha em branco.
 * `ficheiro` é o nome que a dica sugere quando não há radar.
 */
export function painel(
  u: Uso | null,
  serie: readonly number[],
  r: Radar | null,
  agora: number,
  w: number,
  ficheiro = 'DEADLINES.md',
): Fila[] {
  const d = new Date(agora)
  const relogio = `${DIAS[d.getDay()]} ${MESES[d.getMonth()]} ${d.getDate()} ${hora(agora, agora)}`
  const filas: Fila[] = [titulo({ t: 'BRAIN-DASH', cor: 'claude', bold: true }, { t: relogio, dim: true }, w), []]
  if (u?.tokens !== undefined) filas.push(...blocoContexto(u, serie, w), [])
  for (const l of u?.limites ?? []) {
    const j = JANELAS[l.kind]
    if (j) filas.push(...blocoJanela(l, j.nome === '5h' ? '5-HOUR WINDOW' : 'WEEK', j.ms, agora, w), [])
  }
  if (!u) filas.push([{ t: 'Usage: arrives with the first reply.', dim: true }], [])
  else if (!u.limites.some(l => JANELAS[l.kind])) filas.push([{ t: 'Limits: no reading yet.', dim: true }], [])
  if (u?.usd !== undefined) {
    filas.push([{ t: `session $${u.usd.toFixed(2)} API-equivalent (quota on a plan)`, dim: true }], [])
  }
  filas.push(...(r ? blocoRadar(r, agora, w) : semRadar(ficheiro)))
  return filas
}
