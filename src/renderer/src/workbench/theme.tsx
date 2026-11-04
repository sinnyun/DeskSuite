import { useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ThemeMode } from './types'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { z } from 'zod'

interface ThemeState {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
  systemDark: boolean
  setSystemDark: (isDark: boolean) => void
}

const STORAGE_KEY = 'desksuite.theme.mode'
export const themeStore = createStore<ThemeState>((set, get) => ({
  mode: (() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === null) return 'light'
      const parsed = z.enum(['light', 'dark', 'system']).safeParse(saved)
      if (parsed.success) return parsed.data
      console.warn('[workbench] Invalid theme preference; using light theme')
      return 'light'
    } catch (error) {
      console.warn('[workbench] Could not restore theme preference', error)
      return 'light'
    }
  })(),
  systemDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  setMode: (mode) => {
    set({ mode })
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* Session theme remains active. */ }
  },
  setSystemDark: (systemDark) => set({ systemDark })
}))

export function ThemeProvider({ children }: { children: ReactNode }): ReactElement {
  const mode = useStore(themeStore, (state) => state.mode)
  const systemDark = useStore(themeStore, (state) => state.systemDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent): void => themeStore.getState().setSystemDark(event.matches)
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [])

  const isDark = mode === 'dark' || (mode === 'system' && systemDark)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [mode, isDark])

  return (
    <>{children}</>
  )
}

export function useTheme(): { mode: ThemeMode; isDark: boolean; setMode: (mode: ThemeMode) => void; toggleTheme: () => void } {
  const mode = useStore(themeStore, (state) => state.mode)
  const systemDark = useStore(themeStore, (state) => state.systemDark)
  return {
    mode,
    isDark: mode === 'dark' || (mode === 'system' && systemDark),
    setMode: themeStore.getState().setMode,
    toggleTheme: () => themeStore.getState().setMode(themeStore.getState().mode === 'dark' ? 'light' : 'dark')
  }
}
