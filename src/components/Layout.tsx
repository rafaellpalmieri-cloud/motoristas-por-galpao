import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContagemAlertas } from '../hooks/motoristas'
import { agruparPedidos, usePendentes } from '../hooks/solicitacoes'
import { FaixaNotificacoes } from './AtivarNotificacoes'

function ItemNav({ para, icone, rotulo, selo }: { para: string; icone: string; rotulo: string; selo?: number }) {
  return (
    <NavLink
      to={para}
      end={para === '/'}
      className={({ isActive }) =>
        `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 border-t-2 text-xs font-medium ${isActive ? 'border-laranja font-semibold text-sky-700' : 'border-transparent text-slate-500'}`
      }
    >
      <span className="text-xl" aria-hidden>
        {icone}
      </span>
      {rotulo}
      {!!selo && (
        <span className="absolute right-1/2 top-1 translate-x-5 rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
          {selo > 99 ? '99+' : selo}
        </span>
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
      <header className="sticky top-0 z-20 bg-marinho">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <img src="/marca/logo-branca.png" alt="LoogiRio" className="h-7 w-auto shrink-0" />
            <div className="min-w-0 border-l border-white/20 pl-3">
              <p className="truncate text-sm font-semibold leading-tight text-white">
                Motoristas<span className="hidden sm:inline"> por Galpão</span>
              </p>
              <p className="truncate text-xs text-white/60">
                {usuario?.perfil?.nome}
                {ehAdmin ? ' · Admin' : usuario?.galpoes.length ? ` · ${usuario.galpoes.join(', ')}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NavLink
              to="/alertas"
              aria-label={alertas ? `${alertas} alertas novos` : 'Alertas'}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-white/10"
            >
              🔔
              {!!alertas && (
                <span className="absolute right-0.5 top-0.5 min-w-5 rounded-full bg-rose-600 px-1 text-center text-[11px] font-bold leading-5 text-white">
                  {alertas > 99 ? '99+' : alertas}
                </span>
              )}
            </NavLink>
            <button
              type="button"
              onClick={sair}
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-white/80 hover:bg-white/10"
            >
              Sair
            </button>
          </div>
        </div>
        {/* Faixa laranja da marca. */}
        <div className="h-1 bg-gradient-to-r from-laranja to-amarelo" aria-hidden />
      </header>

      <FaixaNotificacoes />

      <main>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl">
          <ItemNav para="/" icone="🚚" rotulo="Motoristas" />
          <ItemNav para="/alertas" icone="🔔" rotulo="Alertas" selo={alertas} />
          <ItemNav
            para="/pendencias"
            icone="📝"
            rotulo={ehAdmin ? 'Pendências' : 'Pedidos'}
            selo={pendentes ? agruparPedidos(pendentes).length : undefined}
          />
          {ehAdmin && <ItemNav para="/admin" icone="📊" rotulo="Painel" />}
          {ehAdmin && <ItemNav para="/admin/dispatchers" icone="👥" rotulo="Equipe" />}
        </div>
      </nav>
    </div>
  )
}
