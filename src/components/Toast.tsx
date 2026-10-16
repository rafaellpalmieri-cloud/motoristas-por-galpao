import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tipo = 'sucesso' | 'erro' | 'info'
interface Aviso {
  id: number
  tipo: Tipo
  texto: string
}

const Contexto = createContext<(texto: string, tipo?: Tipo) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])

  const mostrar = useCallback((texto: string, tipo: Tipo = 'info') => {
    const id = Date.now() + Math.random()
    setAvisos((a) => [...a, { id, tipo, texto }])
    setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), tipo === 'erro' ? 6000 : 3500)
  }, [])

  const cores: Record<Tipo, string> = {
    sucesso: 'bg-emerald-700',
    erro: 'bg-rose-700',
    info: 'bg-slate-800',
  }

  return (
    <Contexto.Provider value={mostrar}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4">
        {avisos.map((a) => (
          <div key={a.id} className={`pointer-events-auto w-full max-w-md rounded-xl px-4 py-3 text-white shadow-lg ${cores[a.tipo]}`}>
            {a.texto}
          </div>
        ))}
      </div>
    </Contexto.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(Contexto)
}
