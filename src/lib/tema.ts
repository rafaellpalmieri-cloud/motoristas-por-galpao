import { useSyncExternalStore } from 'react'

export type Tema = 'claro' | 'escuro'

const CHAVE = 'tema'
const COR_BARRA: Record<Tema, string> = { claro: '#f9f9f9', escuro: '#1c1c1e' }
const ouvintes = new Set<() => void>()

/** Preferência salva; sem preferência, segue o celular/computador. */
function temaAtual(): Tema {
  try {
    const salvo = localStorage.getItem(CHAVE)
    if (salvo === 'claro' || salvo === 'escuro') return salvo
  } catch {
    /* sem armazenamento */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
}

function aplicar(tema: Tema) {
  document.documentElement.dataset.tema = tema
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COR_BARRA[tema])
}

export function iniciarTema() {
  aplicar(temaAtual())
  // Sem escolha manual, acompanha a troca de tema do sistema.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    aplicar(temaAtual())
    ouvintes.forEach((f) => f())
  })
}

export function trocarTema() {
  const novo: Tema = temaAtual() === 'escuro' ? 'claro' : 'escuro'
  try {
    localStorage.setItem(CHAVE, novo)
  } catch {
    /* só vale nesta visita */
  }
  aplicar(novo)
  ouvintes.forEach((f) => f())
}

export function useTema(): Tema {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f)
      return () => ouvintes.delete(f)
    },
    temaAtual,
    () => 'claro',
  )
}
