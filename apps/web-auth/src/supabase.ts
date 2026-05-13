import { createClient } from '@supabase/supabase-js'

// ローカルモード判定
export const isLocalMode = import.meta.env.VITE_AUTH_MODE === 'local'
export const localAuthServerUrl = import.meta.env.VITE_LOCAL_AUTH_SERVER || 'http://localhost:3001'

// Supabase 設定
export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

if (!isLocalMode && (!supabaseUrl || !supabaseAnonKey)) {
  console.warn(
    'Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, or use VITE_AUTH_MODE=local'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
