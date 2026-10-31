import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { IconeCapelo, IconeDocumento, IconeEquipe, IconeGrafico, IconeMotoristas, IconeSeta, IconeSino } from '../components/Icones'
import { useContagemAlertas, useMotoristas } from '../hooks/motoristas'
import { agruparPedidos, usePendentes } from '../hooks/solicitacoes'
import { useTreinamentos } from '../hooks/treinamentos'
import { DIAS_SEM_ROTA_INICIO, diasSemRota, nuncaRodou } from '../lib/rotas'

type Icone = (p: { cheio?: boolean; className?: string }) => React.ReactNode

const fuso = 'America/Sao_Paulo'
const diaDe = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: fuso })

function saudacao() {
  const hora = Number(new Date().toLocaleString('en-US', { timeZone: fuso, hour: 'numeric', hour12: false }))
  return hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
}

function Numero({ valor, rotulo, para, destaque }: { valor?: number; rotulo: string; para: string; destaque?: boolean }) {
  return (
    <Link to={para} className="rounded-2xl bg-white p-4 active:opacity-70">
      <span className={`block text-[28px] font-bold leading-none tracking-tight ${destaque ? 'text-laranja' : 'text-slate-900'}`}>
        {valor ?? '–'}
      </span>
      <span className="mt-1.5 block text-[13px] text-slate-500">{rotulo}</span>
    </Link>
  )
}

function Aba({ para, Icone, nome, descricao }: { para: string; Icone: Icone; nome: string; descricao: string }) {
  return (
    <li>
      <Link to={para} className="flex min-h-[60px] items-center gap-3 px-4 py-2.5 active:bg-slate-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-sky-50 text-sky-600">
          <Icone className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-medium text-slate-900">{nome}</span>
          <span className="block truncate text-[13px] text-slate-500">{descricao}</span>
        </span>
        <IconeSeta className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>
    </li>
  )
}

export default function Inicio() {
  const { search } = useLocation()
  const { usuario, ehAdmin } = useAuth()
  const { data: motoristas } = useMotoristas()
  const { data: alertas } = useContagemAlertas()
  const { data: pendentes } = usePendentes()
  const { data: treinos } = useTreinamentos()

  // Links antigos (avisos já enviados) abriam a lista de motoristas em "/?filtros".
  if (search) return <Navigate to={`/motoristas${search}`} replace />

  const ativos = motoristas?.filter((m) => m.status === 'ativo')
  const nunca = ativos?.filter(nuncaRodou).length
  const semRota = ativos?.filter((m) => (diasSemRota(m) ?? -1) >= DIAS_SEM_ROTA_INICIO).length
  const pedidos = pendentes ? agruparPedidos(pendentes).length : undefined
  // Em treinamento: agendados de hoje em diante, ainda sem presença marcada.
  const hoje = diaDe(new Date())
  const emTreinamento = treinos?.filter((t) => t.status === 'agendado' && !t.presenca && diaDe(new Date(t.inicio)) >= hoje).length
  const primeiroNome = usuario?.perfil?.nome?.split(' ')[0]
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: fuso, weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="mx-auto w-full max-w-3xl animate-esmaecer px-4 pb-32 pt-5">
      <p className="text-[13px] font-medium uppercase tracking-wide text-slate-400">{data}</p>
      <h1 className="mt-0.5 text-[30px] font-bold leading-tight tracking-[-0.03em] text-slate-900">
        {saudacao()}
        {primeiroNome ? `, ${primeiroNome}` : ''}
      </h1>

      <div className="escalonar mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Numero valor={ativos?.length} rotulo="placas ativas" para="/motoristas?status=ativo" />
        <Numero valor={nunca} rotulo="ativos que nunca fizeram rota" para="/motoristas?status=ativo&rota=nunca" />
        <Numero
          valor={semRota}
          rotulo={`ativos sem rota há ${DIAS_SEM_ROTA_INICIO}+ dias`}
          para="/motoristas?status=ativo&rota=sem10"
        />
        <Numero valor={emTreinamento} rotulo="em treinamento" para="/treinamentos" />
        <Numero valor={pedidos} rotulo={ehAdmin ? 'pendências' : 'pedidos abertos'} para="/pendencias" destaque={!!pedidos} />
        <Numero valor={alertas} rotulo="alertas novos" para="/alertas" destaque={!!alertas} />
      </div>

      <h2 className="mb-2 mt-8 px-1 text-[13px] font-medium uppercase tracking-wide text-slate-500">Abas do app</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white">
        <Aba para="/motoristas" Icone={IconeMotoristas} nome="Motoristas" descricao="Lista por galpão, status, rotas e contato" />
        <Aba para="/alertas" Icone={IconeSino} nome="Alertas" descricao="Inativações, quem está sem rota e respostas" />
        <Aba
          para="/pendencias"
          Icone={IconeDocumento}
          nome={ehAdmin ? 'Pendências' : 'Pedidos'}
          descricao={ehAdmin ? 'Aprovar ou recusar inativações e reativações' : 'Seus pedidos de inativação e reativação'}
        />
        <Aba para="/treinamentos" Icone={IconeCapelo} nome="Treinos" descricao="Agenda dos galpões e presença" />
        {ehAdmin && <Aba para="/admin" Icone={IconeGrafico} nome="Painel" descricao="Números por galpão, relatório e CSV" />}
        {ehAdmin && <Aba para="/admin/dispatchers" Icone={IconeEquipe} nome="Equipe" descricao="Usuários, galpões e acessos" />}
      </ul>
    </div>
  )
}
