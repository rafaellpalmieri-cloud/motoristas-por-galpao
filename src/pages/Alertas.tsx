import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Carregando, EstadoErro, EstadoVazio, Pagina, SeloPlanilha } from '../components/ui'
import { useAlertas, useMarcarAlertasVistos } from '../hooks/motoristas'
import { formatarDataHora, tempoRelativo } from '../lib/datas'
import { mensagemErro } from '../lib/erros'

/** Inativações dos últimos 30 dias nos galpões do usuário. */
export default function Alertas() {
  const { usuario, session } = useAuth()
  const { data, isPending, error, refetch } = useAlertas()
  const marcar = useMarcarAlertasVistos()

  // Guarda o "visto até" de quando a tela abriu, para destacar o que é novo
  // mesmo depois de marcar tudo como visto.
  const [vistosAte] = useState(usuario?.perfil?.alertas_vistos_em)
  const marcou = useRef(false)
  const { mutate } = marcar
  useEffect(() => {
    if (data && !marcou.current) {
      marcou.current = true
      mutate()
    }
  }, [data, mutate])

  return (
    <Pagina titulo="Alertas">
      <p className="mb-4 text-slate-600">Motoristas inativados nos últimos 30 dias, no app ou na planilha interna.</p>
      {isPending ? (
        <Carregando texto="Carregando alertas…" />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : data.length === 0 ? (
        <EstadoVazio titulo="Nenhuma inativação recente" />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((a) => {
            const novo = !!vistosAte && a.alterado_em > vistosAte && a.alterado_por !== session?.user.id
            return (
              <li key={a.id}>
                <Link
                  to={`/motoristas/${a.motorista_id}`}
                  className={`block rounded-2xl border p-4 ${novo ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      {a.motoristas?.nome_completo ?? a.motoristas?.codigo ?? 'Motorista'}
                      {a.motoristas?.placa ? <span className="font-normal text-slate-500"> · {a.motoristas.placa}</span> : null}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      {a.origem === 'planilha' && <SeloPlanilha />}
                      {novo && (
                        <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">Novo</span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-rose-700">
                    Inativado{a.motivo ? ` · ${a.motivo}` : ''}
                    {a.galpao ? ` · ${a.galpao}` : ''}
                  </p>
                  {a.observacao && <p className="mt-1 text-sm text-slate-600">“{a.observacao}”</p>}
                  <p className="mt-2 text-sm text-slate-500" title={formatarDataHora(a.alterado_em)}>
                    {a.alterado_por_nome ?? 'Usuário removido'} · {tempoRelativo(a.alterado_em)}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Pagina>
  )
}
