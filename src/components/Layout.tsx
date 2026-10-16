import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useContagemAlertas } from '../hooks/motoristas'

function ItemNav({ para, icone, rotulo, selo }: { para: string; icone: string; rotulo: string; selo?: number }) {
  return (
    <NavLink
      to={para}
      end={para === '/'}
      className={({ isActive }) =>
        `relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-sky-800' : 'text-slate-500'}`
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

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2">
          <div className="min-w-0">
            <p className="font-bold text-sky-800">Motoristas por Galpão</p>
            <p className="truncate text-xs text-slate-500">
              {usuario?.perfil?.nome}
              {ehAdmin ? ' · Admin' : usuario?.galpoes.length ? ` · ${usuario.galpoes.join(', ')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <NavLink
              to="/alertas"
              aria-label={alertas ? `${alertas} alertas novos` : 'Alertas'}
              className="relative flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-slate-100"
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
              className="min-h-11 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <main>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl">
          <ItemNav para="/" icone="🚚" rotulo="Motoristas" />
          <ItemNav para="/alertas" icone="🔔" rotulo="Alertas" selo={alertas} />
          {ehAdmin && <ItemNav para="/admin" icone="📊" rotulo="Painel" />}
          {ehAdmin && <ItemNav para="/admin/dispatchers" icone="👥" rotulo="Equipe" />}
          {ehAdmin && <ItemNav para="/admin/importar" icone="⬆️" rotulo="CSV" />}
        </div>
      </nav>
    </div>
  )
}
