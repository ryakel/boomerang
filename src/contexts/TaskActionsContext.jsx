import { createContext, useContext } from 'react'

const TaskActionsContext = createContext(null)

export function TaskActionsProvider({ value, children }) {
  return (
    <TaskActionsContext.Provider value={value}>
      {children}
    </TaskActionsContext.Provider>
  )
}

export function useTaskActions() {
  return useContext(TaskActionsContext)
}
