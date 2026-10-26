import Papa from 'papaparse'
import { galpaoValido, normalizarGalpao } from './constantes'

export const COLUNAS_CSV = [
  'codigo',
  'nome_completo',
  'celular',
  'placa',
  'galpao',
  'status',
  'modal',
  'inativo_desde',
] as const

/** Colunas aceitas, mas não obrigatórias (não geram aviso se faltarem). */
export const COLUNAS_OPCIONAIS_CSV = ['cpf', 'realizou_rotas', 'qtd_rotas', 'ultima_rota'] as const

export interface LinhaImportacao {
  linha: number // número da linha no arquivo (cabeçalho = 1)
  codigo: string
  nome_completo: string
  celular: string
  placa: string
  galpao: string
  status: string
  modal: string
  inativo_desde: string
  cpf: string
  realizou_rotas: string
  qtd_rotas: string
  ultima_rota: string
}

export interface ErroLinha {
  linha: number | string
  codigo: string | null
  erro: string
}

export interface ResultadoLeitura {
  validas: LinhaImportacao[]
  erros: ErroLinha[]
  colunasFaltando: string[]
  total: number
}

const BOM = String.fromCharCode(0xfeff)
const DATA_ISO =/^\d{4}-\d{2}-\d{2}$/
const DATA_BR = /^\d{1,2}\/\d{1,2}\/\d{4}$/

function limpar(valor: unknown): string {
  return String(valor ?? '').trim()
}

/** Lê, normaliza e valida o CSV no navegador antes de enviar. */
export function lerCsvMotoristas(arquivo: File): Promise<ResultadoLeitura> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(arquivo, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replaceAll(BOM, '').trim().toLowerCase(),
      complete: (res) => {
        const cabecalho = res.meta.fields ?? []
        const colunasFaltando = COLUNAS_CSV.filter((c) => !cabecalho.includes(c))
        const validas: LinhaImportacao[] = []
        const erros: ErroLinha[] = []

        res.data.forEach((bruta, i) => {
          const linha = i + 2
          const item: LinhaImportacao = {
            linha,
            codigo: limpar(bruta.codigo),
            nome_completo: limpar(bruta.nome_completo),
            celular: limpar(bruta.celular),
            placa: limpar(bruta.placa).toUpperCase(),
            galpao: normalizarGalpao(bruta.galpao),
            status: limpar(bruta.status).toLowerCase(),
            modal: limpar(bruta.modal),
            inativo_desde: limpar(bruta.inativo_desde),
            cpf: limpar(bruta.cpf),
            realizou_rotas: limpar(bruta.realizou_rotas),
            qtd_rotas: limpar(bruta.qtd_rotas),
            ultima_rota: limpar(bruta.ultima_rota),
          }

          const problemas: string[] = []
          if (!item.codigo) problemas.push('codigo é obrigatório')
          if (item.galpao && !galpaoValido(item.galpao)) problemas.push(`galpão inválido: ${item.galpao}`)
          if (item.status !== 'ativo' && item.status !== 'inativo')
            problemas.push(`status inválido: "${limpar(bruta.status)}"`)
          if (item.inativo_desde && !DATA_ISO.test(item.inativo_desde) && !DATA_BR.test(item.inativo_desde))
            problemas.push(`data inválida em inativo_desde: ${item.inativo_desde}`)

          if (problemas.length) erros.push({ linha, codigo: item.codigo || null, erro: problemas.join('; ') })
          else validas.push(item)
        })

        resolve({ validas, erros, colunasFaltando, total: res.data.length })
      },
      error: (erro) => reject(erro),
    })
  })
}

/** Gera CSV com BOM UTF-8 e separador ";" (abre direto no Excel em pt-BR e no Sheets). */
/** Evita que um texto seja executado como fórmula ao abrir no Excel/Sheets. */
function celulaSegura(v: unknown): unknown {
  return typeof v === 'string' && /^[=+-@	]/.test(v) ? "'" + v : (v ?? '')
}

export function baixarCsv(nomeArquivo: string, linhas: Record<string, unknown>[], colunas: string[]) {
  const conteudo = Papa.unparse({ fields: colunas, data: linhas.map((l) => colunas.map((c) => celulaSegura(l[c]))) }, {
    delimiter: ';',
    newline: '\r\n',
  })
  const blob = new Blob([BOM + conteudo], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nomeArquivo
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
