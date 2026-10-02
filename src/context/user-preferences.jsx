import { createContext, useContext } from 'react'

const UserPreferencesContext = createContext(null)

export function UserPreferencesProvider({ value, children }) {
  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>
}

export function useUserPreferences() {
  const preferences = useContext(UserPreferencesContext)
  if (!preferences) throw new Error('User preference components must be rendered inside UserPreferencesProvider')
  return preferences
}
