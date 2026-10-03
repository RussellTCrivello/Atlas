// The signed-in user, the effective settings and the toast function, available to every screen.
import React from 'react'
import { defaultSettings } from '../lib/settings'

export const AppContext = React.createContext<{ user: any; settings: any; notify: (toast: any) => void }>({
  user: null,
  settings: defaultSettings,
  notify: () => {}
})

export const useApp = () => React.useContext(AppContext)
