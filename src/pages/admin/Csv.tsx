import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { IconeBaixar } from '../../components/Icones'
import { useToast } from '../../components/Toast'
import { Botao, Cartao, Pagina } from '../../components/ui'
import { baixarCsv, COLUNAS_CSV, COLUNAS_OPCIONAIS_CSV,lerCsvMotoristas, type ErroLinha, type ResultadoLeitura } from '../../lib/csv'
import { formatarData, formatarDataHora } from '../../lib/datas'
import { mensagemErro } from '../../lib/erros'
import { buscarTodas } from '../../lib/paginacao'
import { supabase } from '../../lib/supabase'

const TAMANHO_LOTE = 500

interface Relatorio {
  novos: number
  atualizados: number
  erros: ErroLinha[]
}

function Importar() {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [leitura, setLeitura] = useState<ResultadoLeitura | null>(null)
  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [progresso, setProgresso] = useState<{ feito: number; total: number } | null>(null)
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)

  async function escolher(f: File | undefined) {
    setRelatorio(null)
    setErro(null)
    setLeitura(null)
    setArquivo(f ?? null)
    if (!f) return
    setLendo(true)
    try {
      setLeitura(await lerCsvMotoristas(f))
    } catch (e) {
      setErro(`Não foi possível ler o arquivo: ${mensagemErro(e)}`)
    } finally {
      setLendo(false)
    }
  }

  async function importar() {
    if (!leitura) return
    const linhas = leitura.validas
    const rel: Relatorio = { novos: 0, atualizados: 0, erros: [...leitura.erros] }
    setProgresso({ feito: 0, total: linhas.length })
    try {
      for (let i = 0; i < linhas.length; i += TAMANHO_LOTE) {
        const lote = linhas.slice(i, i + TAMANHO_LOTE)
        const { data, error } = await supabase.rpc('importar_motoristas', { p_linhas: lote })
        if (error) {
          // Lote inteiro falhou (rede, permissão...): registra e segue para o próximo.
          lote.forEach((l) => rel.erros.push({ linha: l.linha, codigo: l.codigo, erro: mensagemErro(error) }))
        } else {
          const r = data as Relatorio
          rel.novos += r.novos
          rel.atualizados += r.atualizados
          rel.erros.push(...r.erros)
        }
        setProgresso({ feito: Math.min(i + TAMANHO_LOTE, linhas.length), total: linhas.length })
      }
    } finally {
      rel.erros.sort((a, b) => Number(a.linha) - Number(b.linha))
      setRelatorio(rel)
      setProgresso(null)
      setLeitura(null)
      setArquivo(null)
      if (inputRef.current) inputRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['motoristas'] })
      queryClient.invalidateQueries({ queryKey: ['resumo'] })
    }
  }

  const importando = !!progresso

  return (
    <Cartao className="mb-6">
      <h2 className="text-lg font-bold text-slate-900">Importar CSV</h2>
      <p className="mt-1 text-sm text-slate-600">
        Colunas: <code className="text-xs">{COLUNAS_CSV.join(', ')}</code> (opcionais:{' '}
        <code className="text-xs">{COLUNAS_OPCIONAIS_CSV.join(', ')}</code>). Separador vírgula ou ponto e vírgula. Motoristas que já
        existem (mesmo código) têm nome, celular, placa, modal e galpão atualizados; o <strong>status não é alterado</strong>.
      </p>

      <label className="mt-4 flex min-h-14 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-sky-300 bg-sky-50 px-4 text-center font-semibold text-sky-800">
        {arquivo ? arquivo.name : 'Escolher arquivo .csv'}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={importando}
          onChange={(e) => escolher(e.target.files?.[0])}
        />
      </label>

      {lendo && <p className="mt-3 text-slate-600">Lendo arquivo…</p>}
      {erro && <p className="mt-3 text-rose-700">{erro}</p>}

      {leitura && (
        <div className="mt-4 flex flex-col gap-3">
          {leitura.colunasFaltando.length > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Colunas ausentes no arquivo: <strong>{leitura.colunasFaltando.join(', ')}</strong>
              {leitura.colunasFaltando.includes('codigo') ? ' — sem a coluna codigo nada pode ser importado.' : ' (ficarão vazias).'}
            </p>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-slate-100 px-3 py-1">{leitura.total} linhas</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{leitura.validas.length} válidas</span>
            <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700">{leitura.erros.length} com erro</span>
          </div>

          {leitura.validas.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    {['Linha', 'Código', 'Nome', 'Placa', 'Galpão', 'Status'].map((c) => (
                      <th key={c} className="whitespace-nowrap px-3 py-2 font-semibold">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leitura.validas.slice(0, 10).map((l) => (
                    <tr key={l.linha} className="border-t border-slate-100">
                      <td className="px-3 py-2 text-slate-500">{l.linha}</td>
                      <td className="px-3 py-2">{l.codigo}</td>
                      <td className="max-w-40 truncate px-3 py-2">{l.nome_completo}</td>
                      <td className="px-3 py-2">{l.placa}</td>
                      <td className="px-3 py-2">{l.galpao || '—'}</td>
                      <td className="px-3 py-2">{l.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leitura.validas.length > 10 && (
                <p className="bg-slate-50 px-3 py-2 text-xs text-slate-500">Mostrando 10 de {leitura.validas.length} linhas válidas.</p>
              )}
            </div>
          )}

          {leitura.erros.length > 0 && <ListaErros erros={leitura.erros} titulo="Linhas com erro (não serão enviadas)" />}

          <Botao disabled={!leitura.validas.length} onClick={importar}>
            Importar {leitura.validas.length} linha(s)
          </Botao>
        </div>
      )}

      {progresso && (
        <div className="mt-4">
          <p className="mb-1 text-sm text-slate-600">
            Enviando… {progresso.feito} de {progresso.total}
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-sky-600 transition-all"
              style={{ width: `${progresso.total ? (progresso.feito / progresso.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {relatorio && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-900">Importação concluída</p>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-white px-3 py-1 font-semibold">{relatorio.novos} novos</span>
            <span className="rounded-full bg-white px-3 py-1 font-semibold">{relatorio.atualizados} atualizados</span>
            <span className="rounded-full bg-white px-3 py-1 font-semibold text-rose-700">{relatorio.erros.length} erros</span>
          </div>
          {relatorio.erros.length > 0 && <ListaErros erros={relatorio.erros} titulo="Erros por linha" />}
        </div>
      )}
    </Cartao>
  )
}

function ListaErros({ erros, titulo }: { erros: ErroLinha[]; titulo: string }) {
  return (
    <details className="rounded-xl border border-rose-200 bg-white" open={erros.length <= 10}>
      <summary className="min-h-11 cursor-pointer px-3 py-2 font-semibold text-rose-800">
        {titulo} ({erros.length})
      </summary>
      <ul className="max-h-64 overflow-y-auto px-3 pb-3 text-sm">
        {erros.map((e, i) => (
          <li key={`${e.linha}-${i}`} className="border-t border-rose-100 py-1.5">
            <strong>Linha {e.linha}</strong>
            {e.codigo ? ` (${e.codigo})` : ''}: {e.erro}
          </li>
        ))}
      </ul>
    </details>
  )
}

interface LinhaExport {
  codigo: string
  nome_completo: string | null
  celular: string | null
  placa: string | null
  modal: string | null
  galpao: string | null
  status: string
  inativo_desde: string | null
  motivo_inativacao: string | null
  cpf: string | null
  realizou_rotas: boolean | null
  qtd_rotas: number | null
  ultima_rota: string | null
  atualizado_em: string | null
  atualizado_por_nome: string | null
}

function Exportar() {
  const [exportando, setExportando] = useState(false)
  const toast = useToast()

  async function exportar() {
    setExportando(true)
    try {
      const dados = await buscarTodas<LinhaExport>((de, ate) =>
        supabase.rpc('exportar_motoristas').range(de, ate),
      )
      const linhas = dados.map((d) => ({
        ...d,
        inativo_desde: formatarData(d.inativo_desde),
        ultima_alteracao_em: formatarDataHora(d.atualizado_em),
        realizou_rotas: d.realizou_rotas == null ? '' : d.realizou_rotas ? 'SIM' : 'NÃO',
        ultima_rota: formatarData(d.ultima_rota),
        ultima_alteracao_por: d.atualizado_por_nome ?? '',
      }))
      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      baixarCsv(`motoristas-${hoje}.csv`, linhas, [
        'codigo',
        'nome_completo',
        'cpf',
        'celular',
        'placa',
        'galpao',
        'status',
        'modal',
        'inativo_desde',
        'motivo_inativacao',
        'realizou_rotas',
        'qtd_rotas',
        'ultima_rota',
        'ultima_alteracao_em',
        'ultima_alteracao_por',
      ])
      toast(`${linhas.length} motoristas exportados.`, 'sucesso')
    } catch (e) {
      toast(`Falha ao exportar: ${mensagemErro(e)}`, 'erro')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Cartao>
      <h2 className="text-lg font-bold text-slate-900">Exportar CSV</h2>
      <p className="mt-1 text-sm text-slate-600">
        Todos os motoristas com status atual, data e autor da última alteração. Abre direto no Excel e no Google Sheets.
      </p>
      <Botao variante="secundario" className="mt-4 w-full" carregando={exportando} onClick={exportar}>
        <IconeBaixar className="h-5 w-5" /> Baixar CSV
      </Botao>
    </Cartao>
  )
}

export default function Csv() {
  return (
    <Pagina titulo="Importar e exportar">
      <Importar />
      <Exportar />
    </Pagina>
  )
}
