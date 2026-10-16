import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configuracaoAusente = !url || !anonKey

// Apenas URL + chave anon (pública). A service_role NUNCA entra no frontend.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'ausente', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})
