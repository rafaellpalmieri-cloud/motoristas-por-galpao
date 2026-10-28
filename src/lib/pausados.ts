import type { Motorista } from './tipos'

/** Pausado no CRM (no app conta como inativo, mas aparece na aba Pausados). */
export function ehPausado(m: Pick<Motorista, 'status' | 'crm_status'>): boolean {
  return m.status === 'inativo' && m.crm_status === 'pausado'
}

/** Pausado que já operou: tem ID Coopmetro ou já fez rota. */
export function jaOperou(m: Pick<Motorista, 'id_coopmetro' | 'qtd_rotas'>): boolean {
  return !!m.id_coopmetro || (m.qtd_rotas ?? 0) > 0
}
