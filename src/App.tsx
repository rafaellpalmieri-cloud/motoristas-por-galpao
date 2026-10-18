import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { RotaAdmin, RotaProtegida } from './auth/Rotas'
import { Layout } from './components/Layout'
import { Carregando, EstadoVazio } from './components/ui'
import { configuracaoAusente } from './lib/supabase'
import Alertas from './pages/Alertas'
import EsqueciSenha from './pages/EsqueciSenha'
import Login from './pages/Login'
import MotoristaDetalhe from './pages/MotoristaDetalhe'
import Pendencias from './pages/Pendencias'
import Motoristas from './pages/Motoristas'
import RedefinirSenha from './pages/RedefinirSenha'
import TrocarSenha from './pages/TrocarSenha'

// Telas de admin carregam sob demanda (dispatcher não baixa esse código).
const Painel = lazy(() => import('./pages/admin/Painel'))
const Dispatchers = lazy(() => import('./pages/admin/Dispatchers'))
const Csv = lazy(() => import('./pages/admin/Csv'))

function NaoEncontrada() {
  return (
    <EstadoVazio titulo="Página não encontrada">
      <Link to="/" className="font-semibold text-sky-800">
        Voltar para o início
      </Link>
    </EstadoVazio>
  )
}

export default function App() {
  if (configuracaoAusente) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">Configuração ausente</h1>
        <p className="mt-2 text-slate-700">
          Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env.local</code> (ou nas
          variáveis de ambiente da hospedagem) e reinicie.
        </p>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<Carregando />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/esqueci-senha" element={<EsqueciSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route element={<RotaProtegida />}>
            <Route path="/trocar-senha" element={<TrocarSenha />} />
            <Route element={<Layout />}>
              <Route index element={<Motoristas />} />
              <Route path="/motoristas/:id" element={<MotoristaDetalhe />} />
              <Route path="/alertas" element={<Alertas />} />
              <Route path="/pendencias" element={<Pendencias />} />
              <Route element={<RotaAdmin />}>
                <Route path="/admin" element={<Painel />} />
                <Route path="/admin/dispatchers" element={<Dispatchers />} />
                <Route path="/admin/importar" element={<Csv />} />
              </Route>
              <Route path="*" element={<NaoEncontrada />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
