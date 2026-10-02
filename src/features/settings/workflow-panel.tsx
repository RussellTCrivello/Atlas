// Settings > Workflow: statuses and transitions.
import { useState } from 'react'
import { slug } from '../../lib/format'
import { AdvancedTextListSetting, AdvancedToggleSetting, SettingInput } from './fields'
import { Icon } from '../../ui/icons'

export function AdvancedWorkflowAdmin({ form, patch, canAdmin }) {
  const workflow = form.workflows?.task || {}
  const states = workflow.states || []
  const transitions = workflow.transitions || []
  const [newState, setNewState] = useState('')
  const setWorkflow = next => patch('workflows.task', next)
  const updateStates = nextStates =>
    setWorkflow({
      ...workflow,
      states: nextStates,
      transitions: transitions.filter(
        t => nextStates.some(s => s.label === t.from) && nextStates.some(s => s.label === t.to)
      )
    })
  const updateState = (index, row) => {
    // The state's id never changes when it is renamed: tasks are matched to their state by id, so a rename carries them along.
    const previous = states[index]
    const nextStates = states.map((state, i) => (i === index ? { ...state, ...row } : state))
    const renamed = row.label !== undefined && row.label !== previous.label
    const nextTransitions = (
      renamed
        ? transitions.map(t => ({
            ...t,
            from: t.from === previous.label ? row.label : t.from,
            to: t.to === previous.label ? row.label : t.to
          }))
        : transitions
    ).filter(t => nextStates.some(s => s.label === t.from) && nextStates.some(s => s.label === t.to))
    setWorkflow({ ...workflow, states: nextStates, transitions: nextTransitions })
  }
  const moveState = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= states.length) return
    const next = [...states]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateStates(next)
  }
  const addState = () => {
    if (!newState.trim()) return
    updateStates([...states, { id: slug(newState), label: newState.trim(), color: 'blue', terminal: false }])
    setNewState('')
  }
  const addTransition = () =>
    states.length > 1 &&
    setWorkflow({
      ...workflow,
      transitions: [
        ...transitions,
        { from: states[0].label, to: states[1].label, permission: 'writeTasks', approvalRequired: false }
      ]
    })
  const updateTransition = (index, row) =>
    setWorkflow({
      ...workflow,
      transitions: transitions.map((transition, i) => (i === index ? { ...transition, ...row } : transition))
    })
  return (
    <div className="workflow-admin advanced-workflow-admin">
      <div className="settings-fields compact-fields">
        <SettingInput
          path="workflows.task.name"
          disabled={!canAdmin}
          label="Workflow name"
          value={workflow.name || ''}
          onChange={v => patch('workflows.task.name', v)}
        />
        <AdvancedToggleSetting
          path="workflows.task.enforceTransitions"
          disabled={!canAdmin}
          label="Enforce transitions"
          checked={Boolean(workflow.enforceTransitions)}
          onChange={v => patch('workflows.task.enforceTransitions', v)}
          description="When on, a task can only move along the transitions listed below (and only by people with the listed permission). When off, any status can be chosen."
        />
        <AdvancedTextListSetting
          path="workflows.task.approvalSteps"
          disabled={!canAdmin}
          label="Approval steps"
          value={workflow.approvalSteps || []}
          onChange={rows => patch('workflows.task.approvalSteps', rows)}
        />
        <AdvancedTextListSetting
          path="workflows.task.automatedActions"
          disabled={!canAdmin}
          label="Automated actions"
          value={workflow.automatedActions || []}
          onChange={rows => patch('workflows.task.automatedActions', rows)}
        />
      </div>
      <div className="workflow-state-table">
        {states.map((state, index) => (
          <div className="workflow-state-row" key={state.id || index}>
            <span className="drag-handle">{index + 1}</span>
            <input
              disabled={!canAdmin}
              value={state.label || ''}
              onChange={e => updateState(index, { label: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={state.color || 'blue'}
              onChange={e => updateState(index, { color: e.target.value })}
            >
              {['blue', 'purple', 'orange', 'green', 'pink', 'teal'].map(color => (
                <option key={color}>{color}</option>
              ))}
            </select>
            <label className="switch-inline">
              <input
                disabled={!canAdmin}
                type="checkbox"
                checked={Boolean(state.terminal)}
                onChange={e => updateState(index, { terminal: e.target.checked })}
              />{' '}
              Terminal
            </label>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === 0}
              onClick={() => moveState(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === states.length - 1}
              onClick={() => moveState(index, 1)}
            >
              ↓
            </button>
            <button
              aria-label="Delete"
              type="button"
              className="icon-button subtle danger-icon"
              disabled={!canAdmin || states.length <= 2}
              onClick={() => updateStates(states.filter((_, i) => i !== index))}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={newState}
          onChange={e => setNewState(e.target.value)}
          placeholder="New workflow state"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={addState}>
          Add state
        </button>
      </div>
      <div className="workflow-preview">
        {states.map((state, index) => (
          <span key={state.id || state.label}>
            {state.label}
            {index < states.length - 1 && <Icon name="arrow" size={12} />}
          </span>
        ))}
      </div>
      <div className="section-subhead">
        <h3>Transitions and approvals</h3>
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || states.length < 2}
          onClick={addTransition}
        >
          Add transition
        </button>
      </div>
      <div className="transition-list">
        {transitions.map((transition, index) => (
          <div className="transition-row" key={`${transition.from}-${transition.to}-${index}`}>
            <select
              disabled={!canAdmin}
              value={transition.from || ''}
              onChange={e => updateTransition(index, { from: e.target.value })}
            >
              {states.map(state => (
                <option key={state.id || state.label}>{state.label}</option>
              ))}
            </select>
            <Icon name="arrow" size={13} />
            <select
              disabled={!canAdmin}
              value={transition.to || ''}
              onChange={e => updateTransition(index, { to: e.target.value })}
            >
              {states.map(state => (
                <option key={state.id || state.label}>{state.label}</option>
              ))}
            </select>
            <input
              disabled={!canAdmin}
              value={transition.permission || ''}
              onChange={e => updateTransition(index, { permission: e.target.value })}
              placeholder="permission"
            />
            <label className="switch-inline">
              <input
                disabled={!canAdmin}
                type="checkbox"
                checked={Boolean(transition.approvalRequired)}
                onChange={e => updateTransition(index, { approvalRequired: e.target.checked })}
              />{' '}
              Approval
            </label>
            <button
              aria-label="Delete"
              type="button"
              className="icon-button subtle danger-icon"
              disabled={!canAdmin}
              onClick={() => setWorkflow({ ...workflow, transitions: transitions.filter((_, i) => i !== index) })}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
