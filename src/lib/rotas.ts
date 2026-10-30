import type { Motorista } from './tipos'

/** "03858756733" → "038.587.567-33" */
export function formatarCpf(cpf: string | null): string {
  const d = (cpf ?? '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (cpf ?? '')
}

/** Dias desde a última rota (horário de Brasília); null se não houver data. */
export function diasDesdeUltimaRota(ultima: string | null): number | null {
  if (!ultima) return null
  const hoje = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }))
  return Math.round((hoje.getTime() - new Date(ultima.slice(0, 10)).getTime()) / 86_400_000)
}

export const DIAS_PARADO = 30

/** Sem nenhuma rota no Power BI (inclui quem nem aparece lá: realizou_rotas vazio). */
export function nuncaRodou(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas'>): boolean {
  return m.realizou_rotas !== true || m.qtd_rotas === 0
}

/** Já rodou, mas a última rota foi há DIAS_PARADO dias ou mais. */
export function parado(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas' | 'ultima_rota'>): boolean {
  const dias = diasDesdeUltimaRota(m.ultima_rota)
  return !nuncaRodou(m) && dias !== null && dias >= DIAS_PARADO
}

/** A partir destes dias sem rota o motorista vai para os alertas, para cortar (igual a dias_corte_sem_rota() no banco). */
export const DIAS_CORTE = 20

/** Faixas do filtro "sem rota": valor do filtro, rótulo, mínimo e máximo de dias. */
export const FAIXAS_SEM_ROTA = [
  ['5', 'Sem rota há 5 a 9 dias', 5, 9],
  ['10', 'Sem rota há 10 a 14 dias', 10, 14],
  ['15', 'Sem rota há 15 a 19 dias', 15, 19],
  ['20', `Sem rota há ${DIAS_CORTE}+ dias (cortar)`, DIAS_CORTE, Infinity],
] as const

/** Atalho da página Início: já rodou, mas está sem rota há estes dias ou mais (filtro "sem10"). */
export const DIAS_SEM_ROTA_INICIO = 10

/** Dias sem rota de quem já rodou; null se nunca rodou ou não há data. */
export function diasSemRota(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas' | 'ultima_rota'>): number | null {
  return nuncaRodou(m) ? null : diasDesdeUltimaRota(m.ultima_rota)
}

export function paraCortar(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas' | 'ultima_rota'>): boolean {
  const dias = diasSemRota(m)
  return dias !== null && dias >= DIAS_CORTE
}
