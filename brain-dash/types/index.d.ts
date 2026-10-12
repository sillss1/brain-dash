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

/** Um prazo já situado no tempo: quantos dias faltam (negativo se venceu) e como se diz. */
export type Prazo = { data: string; dias: number; quando: string; texto: string; critico: boolean }

/** O radar pronto a desenhar, venha de um ficheiro de prazos ou de um comando. */
export type Radar = {
  hoje: string
  janela_dias: number
  /** O ficheiro ou o comando de onde veio, para o rodapé e para a mensagem de falha. */
  fonte: string
  prazos: Prazo[]
  /** Itens críticos ainda sem data. */
  sem_data: string[]
  /** Avisos livres que a fonte queira mostrar (só por JSON). */
  avisos: string[]
  falha: string | null
  lidoEm: number
}

declare module 'claude-code' {
  interface PluginState {
    'brain-dash': {
      uso: Uso | null
      /** Tokens de contexto no fim de cada turno da conversa principal, os últimos 24. */
      amostras: number[]
      /** null quando não há fonte de prazos (sem ficheiro e sem comando): só se mostra o uso. */
      radar: Radar | null
      /** O painel está aberto e com lugar no ecrã: a banda acima do prompt cala-se. */
      aberto: boolean
    }
  }
}
