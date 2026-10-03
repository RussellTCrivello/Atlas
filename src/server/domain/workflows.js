export function createWorkflowService({ getStore, defaultTaskStates }) {
  function taskWorkflowDefinitions() {
    const configured = getStore()?.settings?.workflows?.task?.states
    return Array.isArray(configured) && configured.length ? configured : defaultTaskStates
  }

  function taskWorkflowStates() {
    return taskWorkflowDefinitions().map(state => state.label || state.name || String(state)).filter(Boolean)
  }

  function terminalTaskStates() {
    return taskWorkflowDefinitions().filter(state => state.terminal).map(state => state.label || state.name || String(state)).filter(Boolean)
  }

  function isDone(task) { return terminalTaskStates().includes(task?.status) }

  return { taskWorkflowDefinitions, taskWorkflowStates, terminalTaskStates, isDone }
}
