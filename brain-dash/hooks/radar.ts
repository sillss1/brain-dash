// O radar, separado do desenho: de onde vêm os prazos e como se normalizam. Há duas fontes e um só
// caminho depois delas:
//
//   ficheiro (DEADLINES.md por omissão) ─┐
//                                         ├─ lerFonte → Lido ─ montar → Radar ─ calc.ts desenha
//   comando (radar_command)  ─────────────┘
//
// As duas aceitam os mesmos dois formatos: linhas simples (uma por prazo) ou JSON. Quem tem um
// script seu (o AI-Brain tem o agenda.py) aponta o comando para ele; quem não tem escreve um
// ficheiro. Lógica pura, sem `$`, para os testes a poderem chamar diretamente.
import type { PluginOptions } from 'claude-code'

import type { Prazo, Radar } from '../types'

/** Um prazo como sai da fonte, antes de se saber quantos dias faltam. */
export type Bruto = { data: string; texto: string; critico: boolean }
export type Lido = { prazos: Bruto[]; sem_data: string[]; avisos: string[] }
export type Config = { ficheiro: string; comando: string[]; dias: number }

export const FICHEIRO = 'DEADLINES.md'
const DIAS = 21
// Um vencido fica à vista duas semanas; um crítico, até ser marcado feito ou apagado.
const VENCIDO_MAX_DIAS = 14
const DIA_MS = 86_400_000

/** As opções do manifesto (`userConfig`), com os valores por omissão onde faltam ou não servem. */
export function config(o: PluginOptions): Config {
  const ficheiro = typeof o.radar_file === 'string' && o.radar_file.trim() ? o.radar_file.trim() : FICHEIRO
  const comando = typeof o.radar_command === 'string' ? partirComando(o.radar_command.trim()) : []
  const d = typeof o.radar_days === 'number' && o.radar_days > 0 ? Math.round(o.radar_days) : DIAS
  return { ficheiro, comando, dias: Math.max(1, Math.min(d, 90)) }
}

/**
 * Parte um comando em argumentos, com aspas simples ou duplas. Sem shell: um pipe ou um `&&` vão
 * como texto, e quem precisar deles escreve `sh -c '...'`.
 */
export function partirComando(cmd: string): string[] {
  const out: string[] = []
  let cur = ''
  let aspa: string | undefined
  let houve = false
  for (const c of cmd) {
    if (aspa) {
      if (c === aspa) aspa = undefined
      else cur += c
    } else if (c === '"' || c === "'") {
      aspa = c
      houve = true
    } else if (/\s/.test(c)) {
      if (cur || houve) out.push(cur)
      cur = ''
      houve = false
    } else {
      cur += c
    }
  }
  if (cur || houve) out.push(cur)
  return out
}

function iso(a: number, m: number, d: number): string | undefined {
  const t = new Date(Date.UTC(a, m - 1, d))
  if (t.getUTCFullYear() !== a || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined
  return t.toISOString().slice(0, 10)
}

const RE_ISO = /(\d{4})-(\d{2})-(\d{2})/
const RE_DMA = /(\d{1,2})\/(\d{1,2})\/(\d{4})/

/** A primeira data da linha (`2026-10-15` ou `15/10/2026`) e a linha sem ela. */
export function acharData(s: string): { data: string; resto: string } | undefined {
  for (const [re, ordem] of [
    [RE_ISO, [1, 2, 3]],
    [RE_DMA, [3, 2, 1]],
  ] as const) {
    const m = re.exec(s)
    if (!m) continue
    const [a, me, d] = ordem.map(i => Number(m[i]))
    const data = iso(a ?? 0, me ?? 0, d ?? 0)
    if (data) return { data, resto: s.slice(0, m.index) + s.slice(m.index + m[0].length) }
  }
  return undefined
}

/** Tira o que sobra à volta do texto depois de lhe tirar a data: espaços, traços, dois pontos. */
function limpar(s: string): string {
  return s.replace(/^[\s—–:|·-]+/, '').replace(/[\s—–:|·-]+$/, '')
}

/**
 * O formato simples, uma linha por prazo:
 *
 *   2026-10-15 Entregar o relatório !     ← `!` no fim: crítico
 *   - [ ] 20/10/2026 Exame de Redes         ← listas e caixas do Markdown servem
 *   - [x] 2026-10-01 Já feito               ← caixa marcada: ignorado
 *   - Email ao orientador !                 ← item crítico sem data: vai para "sem data"
 *
 * Títulos (`#`) e linhas sem data e sem `!` são ignorados, para o ficheiro poder ter notas.
 */
export function lerLinhas(texto: string): Lido {
  const out: Lido = { prazos: [], sem_data: [], avisos: [] }
  for (const crua of texto.split(/\r?\n/)) {
    let l = crua.trim()
    if (!l || l.startsWith('#') || l.startsWith('<!--')) continue
    const marcador = /^([-*+]|\d+[.)])\s+/.exec(l)
    if (marcador) l = l.slice(marcador[0].length)
    const caixa = /^\[([ xX])\]\s*/.exec(l)
    if (caixa) {
      if (caixa[1] !== ' ') continue
      l = l.slice(caixa[0].length)
    }
    const critico = /!\s*$/.test(l)
    if (critico) l = l.replace(/\s*!+\s*$/, '')
    const d = acharData(l)
    if (d) out.prazos.push({ data: d.data, texto: limpar(d.resto) || '(sem texto)', critico })
    else if (critico && marcador) out.sem_data.push(limpar(l))
  }
  return out
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])

/**
 * O formato JSON: uma lista de prazos, ou `{ prazos, sem_data, avisos }`. Aceita as chaves em
 * português e em inglês (`deadlines`, `date`, `text`, `critical`, `undated`, `warnings`), e ignora
 * o resto — por isso a saída do `agenda.py --json` do AI-Brain serve tal como está.
 */
export function lerJson(v: unknown): Lido {
  const obj: Record<string, unknown> = Array.isArray(v)
    ? { prazos: v }
    : v !== null && typeof v === 'object'
      ? (v as Record<string, unknown>)
      : {}
  const lista = obj.prazos ?? obj.deadlines
  if (!Array.isArray(lista)) throw new Error('o JSON não tem "prazos" nem "deadlines"')
  const prazos: Bruto[] = []
  for (const p of lista) {
    if (p === null || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    const d = acharData(String(r.data ?? r.date ?? ''))
    if (!d) continue
    const texto = String(r.texto ?? r.text ?? r.title ?? '').trim() || '(sem texto)'
    prazos.push({ data: d.data, texto, critico: Boolean(r.critico ?? r.critical) })
  }
  return { prazos, sem_data: textos(obj.sem_data ?? obj.undated), avisos: textos(obj.avisos ?? obj.warnings) }
}

/** Escolhe o formato: `.json`, ou um texto que comece por `{` ou `[`, é JSON; o resto são linhas. */
export function lerFonte(texto: string, nome: string): Lido {
  const t = texto.trim()
  if (nome.toLowerCase().endsWith('.json') || t.startsWith('{') || t.startsWith('[')) return lerJson(JSON.parse(t))
  return lerLinhas(texto)
}

/** A data de hoje no fuso da máquina, em `AAAA-MM-DD`. */
export function hojeDe(agora: number): string {
  const d = new Date(agora)
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()) ?? '1970-01-01'
}

function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS)
}

/** `15/10 3d`, `13/10 amanhã`, `12/10 HOJE`, `09/10 VENCIDO 3d`. */
export function quando(data: string, dias: number): string {
  const dm = `${data.slice(8, 10)}/${data.slice(5, 7)}`
  if (dias < 0) return `${dm} VENCIDO ${-dias}d`
  if (dias === 0) return `${dm} HOJE`
  if (dias === 1) return `${dm} amanhã`
  return `${dm} ${dias}d`
}

/** Situa os prazos no tempo e corta a janela: os próximos `janela` dias e os vencidos recentes. */
export function montar(l: Lido, agora: number, janela: number, fonte: string): Radar {
  const hoje = hojeDe(agora)
  const prazos: Prazo[] = l.prazos
    .map(p => {
      const dias = diasEntre(hoje, p.data)
      return { ...p, dias, quando: quando(p.data, dias) }
    })
    .filter(p => p.dias <= janela && (p.dias >= -VENCIDO_MAX_DIAS || p.critico))
    .sort((a, b) => a.data.localeCompare(b.data) || Number(b.critico) - Number(a.critico))
  return { hoje, janela_dias: janela, fonte, prazos, sem_data: l.sem_data, avisos: l.avisos, falha: null, lidoEm: agora }
}

/** Um radar que não correu diz que não correu: o silêncio não pode querer dizer duas coisas. */
export function falhou(fonte: string, falha: string, agora: number, janela: number): Radar {
  return { hoje: hojeDe(agora), janela_dias: janela, fonte, prazos: [], sem_data: [], avisos: [], falha, lidoEm: agora }
}
