// Renders the README images from the mod's own drawing functions (painel, banda, blocoRadar), so
// every picture is what the mod actually draws for the sample data below, not a mock-up.
//
//   npx tsx docs/render.ts
//
// Bars, sparklines and calendar marks become shapes; text is placed on a fixed character grid, so
// the layout holds whatever monospace font the viewer has.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { banda, blocoRadar, painel } from '../brain-dash/hooks/calc'
import type { Fila, Seg } from '../brain-dash/hooks/calc'
import { lerLinhas, montar } from '../brain-dash/hooks/radar'
import type { Uso } from '../brain-dash/types'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'images')

// ---------------------------------------------------------------- sample data

const AGORA = new Date(2026, 9, 12, 14, 5).getTime() // Mon Oct 12 2026, 14:05
const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

const DEADLINES = `# Deadlines

- [ ] 2026-10-13 Release notes for v1.2 !
- [ ] 2026-10-15 Thesis draft to advisor !
- [ ] 2026-10-20 Networks exam
- [ ] 2026-10-23 Conference abstract
- [ ] 30/10/2026 Renew passport
- [ ] 2026-10-09 Book workshop flights
- [x] 2026-10-07 Grant report
- Reply to reviewer 2 !

Notes without a date are ignored.`

const USO: Uso = {
  tokens: 412_000,
  janela: 1_000_000,
  pct: 41,
  limiar: 800_000,
  limites: [
    { kind: 'five_hour', pct: 46, reset: AGORA + 2 * HORA + 10 * MIN },
    { kind: 'seven_day', pct: 31, reset: AGORA + 3 * DIA + 5 * HORA },
  ],
  usd: 3.42,
}

// Context at the end of each turn, with one compaction in the middle.
const SERIE = [120, 150, 185, 210, 260, 300, 340, 90, 130, 170, 220, 260, 300, 330, 360, 385, 412].map(k => k * 1000)

const RADAR = montar(lerLinhas(DEADLINES), AGORA, 21, 'DEADLINES.md')

// ---------------------------------------------------------------- drawing

const CW = 8.6 // character cell width
const LH = 20 // line height
const FS = 14 // font size
const FONT = `'JetBrains Mono','SF Mono','Cascadia Mono',Menlo,Consolas,'DejaVu Sans Mono',monospace`

const BG = '#0d1117'
const PANE_BG = '#161b22'
const BORDER = '#30363d'
const TXT = '#e6edf3'
const DIM = '#8b949e'
const COR: Record<string, string> = {
  claude: '#d97757',
  error: '#ff6b6b',
  warning: '#f2b53a',
  success: '#3fb950',
  suggestion: '#58a6ff',
  inactive: '#6e7681',
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cor = (s: Seg) => (s.cor ? (COR[s.cor] ?? TXT) : s.dim ? DIM : TXT)
const NIVEIS = '▁▂▃▄▅▆▇'

const BARRA = '█▒░'

/** A run of `n` bar cells of the same kind, as one rectangle (no seams between cells). */
function barraRect(ch: string, x: number, y: number, n: number, fill: string): string {
  const meio = y + LH / 2
  const estilo = ch === '█' ? `fill="${fill}"` : ch === '▒' ? `fill="${fill}" opacity="0.4"` : `fill="${DIM}" opacity="0.18"`
  return `<rect x="${x.toFixed(1)}" y="${meio - 6}" width="${(n * CW).toFixed(1)}" height="12" ${estilo}/>`
}

/** One cell drawn as a shape, or undefined when the character is text. */
function forma(ch: string, x: number, y: number, fill: string): string | undefined {
  const meio = y + LH / 2
  if (ch === '│') return `<rect x="${x + CW / 2 - 1}" y="${meio - 8}" width="2" height="16" fill="${fill}"/>`
  const n = NIVEIS.indexOf(ch)
  if (n >= 0) {
    const h = 3 + (n / 6) * 13
    return `<rect x="${x + 1}" y="${meio + 8 - h}" width="${CW - 2}" height="${h}" rx="1" fill="${fill}"/>`
  }
  if (ch === '■') return `<rect x="${x + 1}" y="${meio - 5}" width="${CW - 2.5}" height="10" rx="2" fill="${fill}"/>`
  if (ch === '·') return `<circle cx="${x + CW / 2}" cy="${meio}" r="1.4" fill="${DIM}"/>`
  if (ch === '●') return `<circle cx="${x + CW / 2}" cy="${meio}" r="4" fill="${fill}"/>`
  return undefined
}

/** Rows of segments at (x0, y0): shapes for the block characters, text on the grid for the rest. */
function filas(rows: Fila[], x0: number, y0: number): string {
  const out: string[] = []
  rows.forEach((row, i) => {
    const y = y0 + i * LH
    let col = 0
    for (const s of row) {
      const fill = cor(s)
      let run = ''
      let xs: number[] = []
      const fechar = () => {
        if (!run.trim()) {
          run = ''
          xs = []
          return
        }
        const peso = s.bold ? ' font-weight="700"' : ''
        out.push(`<text x="${xs.map(v => v.toFixed(1)).join(' ')}" y="${y + 14.5}" fill="${fill}"${peso}>${esc(run)}</text>`)
        run = ''
        xs = []
      }
      let barra: { ch: string; x: number; n: number } | undefined
      const fecharBarra = () => {
        if (barra) out.push(barraRect(barra.ch, barra.x, y, barra.n, fill))
        barra = undefined
      }
      for (const ch of Array.from(s.t)) {
        const x = x0 + col * CW
        if (BARRA.includes(ch)) {
          fechar()
          if (barra && barra.ch === ch) barra.n++
          else {
            fecharBarra()
            barra = { ch, x, n: 1 }
          }
          col++
          continue
        }
        fecharBarra()
        const f = forma(ch, x, y, fill)
        if (f) {
          fechar()
          out.push(f)
        } else {
          run += ch
          xs.push(x)
        }
        col++
      }
      fecharBarra()
      fechar()
    }
  })
  return out.join('\n')
}

function svg(w: number, h: number, corpo: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}" font-size="${FS}">
<rect width="${w}" height="${h}" rx="12" fill="${BG}"/>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="${BORDER}"/>
<circle cx="22" cy="20" r="6" fill="#ff5f57"/><circle cx="42" cy="20" r="6" fill="#febc2e"/><circle cx="62" cy="20" r="6" fill="#28c840"/>
${corpo}
</svg>
`
}

/** A pane box with its title, as Claude Code docks it beside the conversation. */
function caixa(x: number, y: number, cols: number, rows: number, titulo: string): string {
  const w = cols * CW + 28
  const h = rows * LH + 44
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${PANE_BG}" stroke="${BORDER}"/>
<text x="${x + 14}" y="${y + 21}" fill="${DIM}" font-size="12">${esc(titulo)}</text>
<line x1="${x}" y1="${y + 32}" x2="${x + w}" y2="${y + 32}" stroke="${BORDER}"/>`
}

// ---------------------------------------------------------------- the images

function pane(): string {
  const cols = 50
  const rows = painel(USO, SERIE, RADAR, AGORA, cols)
  const w = cols * CW + 28 + 40
  const h = rows.length * LH + 44 + 60
  return svg(w, h, `${caixa(20, 40, cols, rows.length, 'brain-dash')}\n${filas(rows, 34, 84)}`)
}

/** The pane docked beside a conversation drawn as placeholder lines. */
function hero(): string {
  const cols = 50
  const rows = painel(USO, SERIE, RADAR, AGORA, cols)
  const convW = 520
  const paneX = 20 + convW + 16
  const w = paneX + cols * CW + 28 + 20
  const h = rows.length * LH + 44 + 60
  const linhas: string[] = []
  let y = 52
  const bloco = (larguras: number[], cor: string, marca?: string) => {
    if (marca) linhas.push(`<text x="28" y="${y + 13}" fill="${marca}">●</text>`)
    for (const l of larguras) {
      linhas.push(`<rect x="48" y="${y + 4}" width="${l}" height="10" rx="5" fill="${cor}" opacity="0.55"/>`)
      y += 22
    }
    y += 14
  }
  linhas.push(`<text x="28" y="${y + 13}" fill="${DIM}">&gt;</text>`)
  linhas.push(`<rect x="48" y="${y + 4}" width="300" height="10" rx="5" fill="${TXT}" opacity="0.35"/>`)
  y += 36
  bloco([420, 380, 300], DIM, COR.claude)
  bloco([210], COR.success ?? DIM, COR.success)
  bloco([440, 410, 455, 260], DIM, COR.claude)
  bloco([190], COR.suggestion ?? DIM, COR.suggestion)
  bloco([400, 350, 430, 380, 220], DIM, COR.claude)
  const promptY = h - 74
  linhas.push(`<rect x="20" y="${promptY}" width="${convW}" height="40" rx="8" fill="none" stroke="${BORDER}"/>`)
  linhas.push(`<text x="36" y="${promptY + 25}" fill="${DIM}">&gt;</text>`)
  linhas.push(`<rect x="52" y="${promptY + 18}" width="2" height="12" fill="${TXT}"/>`)
  return svg(w, h, `${linhas.join('\n')}\n${caixa(paneX, 40, cols, rows.length, 'brain-dash')}\n${filas(rows, paneX + 14, 84)}`)
}

/** The band above the prompt, when the pane is closed or the terminal is narrow. */
function band(): string {
  const segs = banda(USO, SERIE, RADAR, AGORA)
  const row: Fila = segs.flatMap((s, i) => {
    const seg: Seg = s.cor ? { t: s.texto, cor: s.cor } : { t: s.texto, dim: true }
    return i === 0 ? [seg] : [{ t: ' │ ', dim: true }, seg]
  })
  const cols = row.reduce((n, s) => n + Array.from(s.t).length, 0)
  const w = Math.max(640, cols * CW + 60)
  const h = 150
  const prompt = `<rect x="20" y="78" width="${w - 40}" height="44" rx="8" fill="none" stroke="${BORDER}"/>
<text x="36" y="105" fill="${DIM}">&gt;</text><rect x="52" y="94" width="2" height="13" fill="${TXT}"/>`
  // The band's separators are text, not bar markers: draw this one row as plain text runs.
  const texto = row
    .map(s => `<tspan fill="${cor(s)}">${esc(s.t)}</tspan>`)
    .join('')
  return svg(w, h, `<text x="30" y="${62}" xml:space="preserve">${texto}</text>\n${prompt}`)
}

/** DEADLINES.md on the left, the radar it becomes on the right. */
function deadlines(): string {
  const src = DEADLINES.split('\n')
  const radar = blocoRadar(RADAR, AGORA, 44)
  const leftCols = 44
  const leftW = leftCols * CW + 28
  const rightX = 20 + leftW + 56
  const rows = Math.max(src.length, radar.length)
  const w = rightX + 44 * CW + 28 + 20
  const h = rows * LH + 44 + 60
  const realce = (l: string): Fila => {
    if (l.startsWith('#')) return [{ t: l, cor: 'claude', bold: true }]
    if (/\[x\]/.test(l)) return [{ t: l, dim: true }]
    const critico = /!\s*$/.test(l)
    const corpo = critico ? l.replace(/\s*!\s*$/, '') : l
    const m = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.exec(corpo)
    const out: Fila = m
      ? [{ t: corpo.slice(0, m.index), dim: true }, { t: m[0], cor: 'suggestion' }, { t: corpo.slice(m.index + m[0].length) }]
      : [{ t: corpo, dim: !critico }]
    if (critico) out.push({ t: ' !', cor: 'error', bold: true })
    return out
  }
  // In the source, the box characters are text, not drawing marks.
  const fonte = src
    .map((l, i) => {
      const spans = realce(l)
        .map(s => `<tspan fill="${cor(s)}"${s.bold ? ' font-weight="700"' : ''}>${esc(s.t)}</tspan>`)
        .join('')
      return `<text x="34" y="${84 + i * LH + 14.5}" xml:space="preserve">${spans}</text>`
    })
    .join('\n')
  const seta = `<path d="M ${20 + leftW + 14} ${h / 2} h 26" stroke="${COR.claude}" stroke-width="2.5"/>
<path d="M ${20 + leftW + 40} ${h / 2 - 7} l 9 7 l -9 7 z" fill="${COR.claude}"/>`
  return svg(
    w,
    h,
    `${caixa(20, 40, leftCols, rows, 'DEADLINES.md')}\n${fonte}\n${seta}\n${caixa(rightX, 40, 44, rows, 'brain-dash · radar')}\n${filas(radar, rightX + 14, 84)}`,
  )
}

mkdirSync(OUT, { recursive: true })
for (const [nome, f] of [
  ['hero', hero],
  ['pane', pane],
  ['band', band],
  ['deadlines', deadlines],
] as const) {
  writeFileSync(join(OUT, `${nome}.svg`), f())
  console.log(`docs/images/${nome}.svg`)
}
