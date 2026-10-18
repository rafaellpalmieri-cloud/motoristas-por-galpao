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

/** Sem nenhuma rota registrada na planilha. */
export function nuncaRodou(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas'>): boolean {
  return m.realizou_rotas === false || m.qtd_rotas === 0
}

/** Já rodou, mas a última rota foi há DIAS_PARADO dias ou mais. */
export function parado(m: Pick<Motorista, 'realizou_rotas' | 'qtd_rotas' | 'ultima_rota'>): boolean {
  const dias = diasDesdeUltimaRota(m.ultima_rota)
  return !nuncaRodou(m) && dias !== null && dias >= DIAS_PARADO
}
