import React, { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon.jsx'
import { Avatar, RoleBadge } from '../components/common.jsx'
import { AVATAR_COLORS } from '../lib/constants.js'
import { t } from '../lib/workspace.js'

export function ProfilePage({ user, person, settings, onSave, isAdministrator = false, onManageUsers }) {
  const [name, setName] = useState(user?.name || '')
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS.includes(user?.avatarColor) ? user.avatarColor : 'purple')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setName(user?.name || '')
    setAvatarColor(AVATAR_COLORS.includes(user?.avatarColor) ? user.avatarColor : 'purple')
    setError('')
  }, [user?.id, user?.name, user?.avatarColor])

  const dirty = useMemo(() => name.trim() !== (user?.name || '') || avatarColor !== (user?.avatarColor || 'purple'), [name, user?.name, user?.avatarColor, avatarColor])
  const submit = async event => {
    event.preventDefault()
    setError('')
    setSaving(true)
    try {
      const next = await onSave({ name: name.trim(), avatarColor })
      setName(next?.name || name.trim())
      setAvatarColor(next?.avatarColor || avatarColor)
    } catch (saveError) {
      setError(saveError.message || t(settings, 'profile.save_failed', 'Your profile could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return <div className="page-content profile-page">
    <div className="profile-hero">
      <div className="profile-hero-person">
        <Avatar name={user?.name} color={user?.avatarColor}/>
        <div>
          <span className="eyebrow"><span className="eyebrow-dot"/>{t(settings, 'profile.personal_account', 'Personal account')}</span>
          <h2>{t(settings, 'profile.title', 'My profile')}</h2>
          <p>{t(settings, 'profile.subtitle', 'Manage your display name and the workspace identity linked to your account.')}</p>
        </div>
      </div>
      {isAdministrator && <button type="button" className="secondary-button" onClick={onManageUsers}>
        <Icon name="people" size={15}/>{t(settings, 'profile.manage_users', 'Manage users')}
      </button>}
    </div>

    <div className="profile-layout">
      <section className="panel profile-edit-card">
        <div className="section-head">
          <div><h2>{t(settings, 'profile.personal_details', 'Personal details')}</h2><p>{t(settings, 'profile.edit_hint', 'Your display name is also used on your linked workspace person record.')}</p></div>
        </div>
        <form className="profile-edit-form" onSubmit={submit}>
          <div className="profile-preview-row">
            <Avatar name={name || user?.name} color={avatarColor}/>
            <div>{name.trim() ? <strong data-no-i18n>{name.trim()}</strong> : <strong>{t(settings, 'profile.your_name', 'Your name')}</strong>}<small data-no-i18n>{user?.email || ''}</small></div>
          </div>
          <label>{t(settings, 'profile.display_name', 'Display name')}
            <input value={name} onChange={event => setName(event.target.value)} maxLength={120} required autoComplete="name"/>
          </label>
          <fieldset className="avatar-color-fieldset">
            <legend>{t(settings, 'profile.avatar_color', 'Avatar color')}</legend>
            <div className="avatar-color-options">
              {AVATAR_COLORS.map(color => <button
                type="button"
                key={color}
                className={`avatar-color-option avatar-color-${color} ${avatarColor === color ? 'selected' : ''}`}
                aria-label={`${t(settings, 'profile.avatar_color', 'Avatar color')}: ${t(settings, `color.${color}`, color)}`}
                aria-pressed={avatarColor === color}
                title={t(settings, `color.${color}`, color)}
                onClick={() => setAvatarColor(color)}
              />)}
            </div>
          </fieldset>
          {error && <div className="form-error"><Icon name="warning" size={15}/>{error}</div>}
          <div className="profile-form-actions">
            <button type="submit" className="primary-button" disabled={saving || !dirty || !name.trim()}>
              <Icon name={saving ? 'clock' : 'check'} size={15}/>{saving ? t(settings, 'profile.saving', 'Saving…') : t(settings, 'profile.save', 'Save profile')}
            </button>
          </div>
        </form>
      </section>

      <section className="panel profile-account-card">
        <div className="section-head"><div><h2>{t(settings, 'profile.account_access', 'Account access')}</h2><p>{t(settings, 'profile.account_access_hint', 'Identity and role information for this local workspace account.')}</p></div></div>
        <dl className="profile-account-details">
          <div><dt>{t(settings, 'profile.email', 'Email address')}</dt><dd data-no-i18n>{user?.email || '—'}</dd></div>
          <div><dt>{t(settings, 'profile.role', 'Access role')}</dt><dd><RoleBadge role={user?.role || 'Viewer'}/></dd></div>
          <div><dt>{t(settings, 'profile.team', 'Team')}</dt><dd>{person?.team ? <span data-no-i18n>{person.team}</span> : t(settings, 'profile.not_linked', 'Not linked')}</dd></div>
        </dl>
        <div className="profile-note"><Icon name="warning" size={15}/><span>{t(settings, 'profile.admin_managed_fields', 'Email address, password, and role are managed by a workspace administrator.')}</span></div>
        <div className="profile-language-note"><Icon name="globe" size={15}/><span>{t(settings, 'profile.language_hint', 'Use the language control in the top bar to set your personal interface language. It does not change the workspace default.')}</span></div>
      </section>
    </div>
  </div>
}
