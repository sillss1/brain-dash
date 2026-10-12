/** Uma janela de limite do plano (`five_hour`, `seven_day`): percentagem e reset em ms. */
export type Limite = { kind: string; pct: number; reset?: number }

/** O que o `session.measure` traz, mais o limiar de auto-compactação lido no fim de cada turno. */
export type Uso = {
  tokens?: number
  janela: number
  pct?: number
  limiar?: number
  limites: Limite[]
  usd?: number
}

/** Um prazo, tal como o `agenda.py --json` o devolve. */
export type Prazo = { data: string; dias: number; quando: string; texto: string; critico: boolean }

/** A saída do `agenda.py --json`, mais quando foi lida. */
export type Radar = {
  hoje: string
  janela_dias: number
  prazos: Prazo[]
  sem_data: string[]
  por_espelhar: { data: string | null; texto: string }[]
  sem_avaliacao: string[]
  falha: string | null
  lidoEm: number
}

declare module 'claude-code' {
  interface PluginState {
    'brain-dash': {
      uso: Uso | null
      /** Tokens de contexto no fim de cada turno da conversa principal, os últimos 24. */
      amostras: number[]
      /** null fora do AI-Brain (sem system/scripts/agenda.py): só se mostra o uso. */
      radar: Radar | null
      /** O painel está aberto e com lugar no ecrã: a banda acima do prompt cala-se. */
      aberto: boolean
    }
  }
}
