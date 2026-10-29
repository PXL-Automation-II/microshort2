import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

// Two states, not three (DESIGN.md §5): a visitor who never touched the
// toggle follows the OS; the first press stores an explicit light or dark and
// the app never goes back to "system" by itself. public/theme-boot.js applies
// the stored value before paint and must stay in sync with STORAGE_KEY.
export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'microshort.theme'

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function storedTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

type ThemeState = { theme: Theme; setTheme: (t: Theme) => void; toggleTheme: () => void }
const ThemeContext = createContext<ThemeState>({ theme: 'light', setTheme: () => null, toggleTheme: () => null })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<Theme | null>(storedTheme)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystem(systemTheme())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const theme = explicit ?? system

  useEffect(() => {
    const root = document.documentElement
    if (explicit) root.setAttribute('data-theme', explicit)
    else root.removeAttribute('data-theme')
    root.classList.toggle('dark', theme === 'dark')
  }, [explicit, theme])

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* private mode */
    }
    setExplicit(t)
  }

  return <ThemeContext.Provider value={{ theme, setTheme, toggleTheme: () => setTheme(theme === 'dark' ? 'light' : 'dark') }}>{children}</ThemeContext.Provider>
}

export const useTheme = () => useContext(ThemeContext)
