import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContagemAlertas } from '../hooks/motoristas'
import { agruparPedidos, usePendentes } from '../hooks/solicitacoes'
import { FaixaNotificacoes } from './AtivarNotificacoes'
import { IconeDocumento, IconeEquipe, IconeGrafico, IconeMotoristas, IconeSair, IconeSino } from './Icones'

type Icone = (p: { cheio?: boolean; className?: string }) => React.ReactNode

function ItemNav({ para, Icone, rotulo, selo }: { para: string; Icone: Icone; rotulo: string; selo?: number }) {
  return (
    <NavLink
      to={para}
      end={para === '/' || para === '/admin'}
      className={({ isActive }) =>
        `relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium tracking-tight ${isActive ? 'text-sky-600' : 'text-slate-400'}`
      }
    >
      {({ isActive }) => (
        <>
          <Icone cheio={isActive} className="h-[26px] w-[26px]" />
          {rotulo}
          {!!selo && (
            <span className="absolute left-1/2 top-1 ml-2 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
              {selo > 99 ? '99+' : selo}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export function Layout() {
  const { usuario, ehAdmin, sair } = useAuth()
  const { data: alertas } = useContagemAlertas()
  const { data: pendentes } = usePendentes()

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="vidro sticky top-0 z-20 border-b border-black/10">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/marca/simbolo-loogirio.png" alt="LoogiRio" className="h-8 w-auto shrink-0" />
            <div className="min-w-0">
            <p className="text-[15px] font-semibold tracking-tight text-slate-900">Motoristas por Galpão</p>
            <p className="truncate text-[12px] text-slate-500">
              {usuario?.perfil?.nome}
              {ehAdmin ? ' · Admin' : usuario?.galpoes.length ? ` · ${usuario.galpoes.join(', ')}` : ''}
            </p>
            </div>
          </div>
          <div className="flex items-center">
            <NavLink
              to="/alertas"
              aria-label={alertas ? `${alertas} alertas novos` : 'Alertas'}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-sky-600 active:opacity-60"
            >
              <IconeSino className="h-6 w-6" />
              {!!alertas && (
                <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-rose-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
                  {alertas > 99 ? '99+' : alertas}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={sair}
              aria-label="Sair"
              className="flex min-h-11 items-center gap-1 rounded-full px-2 text-[15px] text-sky-600 active:opacity-60"
            >
              <IconeSair className="h-5 w-5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      <FaixaNotificacoes />

      <main>
        <Outlet />
      </main>

      <nav className="vidro fixed inset-x-0 bottom-0 z-20 border-t border-black/10 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl">
          <ItemNav para="/" Icone={IconeMotoristas} rotulo="Motoristas" />
          <ItemNav para="/alertas" Icone={IconeSino} rotulo="Alertas" selo={alertas} />
          <ItemNav
            para="/pendencias"
            Icone={IconeDocumento}
            rotulo={ehAdmin ? 'Pendências' : 'Pedidos'}
            selo={pendentes ? agruparPedidos(pendentes).length : undefined}
          />
          {ehAdmin && <ItemNav para="/admin" Icone={IconeGrafico} rotulo="Painel" />}
          {ehAdmin && <ItemNav para="/admin/dispatchers" Icone={IconeEquipe} rotulo="Equipe" />}
        </div>
      </nav>
    </div>
  )
}
