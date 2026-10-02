// Settings > Localization: languages, translation manager, interface registry, settings import/export.
import { useState, useEffect } from 'react'
import { slug } from '../../lib/format'
import { api } from '../../lib/api'
import { downloadBlob } from '../../lib/export'
import { textDirection } from '../../lib/i18n'
import { Icon } from '../../ui/icons'
import { AdvancedJsonConfigEditor } from './fields'

export function AdvancedI18nIntegrationAdmin({ form, patch, canAdmin }) {
  const localization = form.localization || {}
  const interfaces = localization.interfaces || {}
  const translations = localization.translations || {}
  const activeLanguages = localization.activeLanguages || []
  const [draft, setDraft] = useState({ namespace: '', label: '', version: '1.0.0', owner: '', route: '' })
  const add = () => {
    const namespace = slug(draft.namespace).replaceAll('-', '_')
    if (!namespace) return
    patch('localization.interfaces', {
      ...interfaces,
      [namespace]: {
        namespace,
        label: draft.label || namespace,
        version: draft.version || '1.0.0',
        owner: draft.owner || 'custom',
        route: draft.route || '',
        status: 'active',
        registeredAt: new Date().toISOString(),
        keys: []
      }
    })
    setDraft({ namespace: '', label: '', version: '1.0.0', owner: '', route: '' })
  }
  const updateInterface = (namespace, row) =>
    patch('localization.interfaces', { ...interfaces, [namespace]: { ...(interfaces[namespace] || {}), ...row } })
  // Runtime missing-key reports are diagnostics held in server memory (never saved with settings).
  const [missing, setMissing] = useState([])
  useEffect(() => {
    api
      .get('/api/i18n/missing')
      .then(result => setMissing(result.keys || []))
      .catch(() => {})
  }, [])
  const catalogKeyCount = (Object.values(translations) as any[]).reduce((set: Set<string>, catalog) => {
    Object.keys(catalog || {}).forEach(key => set.add(key))
    return set
  }, new Set<string>()).size
  const sample =
    "window.AtlasI18n.t('billing.invoice_due', 'Invoice {number} is due', { number: 'INV-42' })\nwindow.AtlasI18n.registerInterface('billing', { en: { 'billing.invoice_due': 'Invoice {number} is due' }, ar: { 'billing.invoice_due': 'الفاتورة {number} مستحقة' } }, { label: 'Billing' })"
  return (
    <div className="i18n-integration-admin">
      <div className="config-stat-grid i18n-stat-grid">
        <div>
          <strong>{catalogKeyCount}</strong>
          <span>catalog keys</span>
        </div>
        <div>
          <strong>{activeLanguages.length}</strong>
          <span>active languages</span>
        </div>
        <div>
          <strong>{Object.keys(interfaces).length}</strong>
          <span>registered interfaces</span>
        </div>
        <div>
          <strong>{missing.length}</strong>
          <span>missing translations</span>
        </div>
      </div>
      <div className="settings-note">
        <Icon name="spark" size={15} />
        <span>Expose AtlasI18n to extensions, dynamic screens, and embedded widgets.</span>
      </div>
      <div className="interface-registry-list">
        {(Object.entries(interfaces) as [string, any][]).map(([namespace, meta]) => (
          <div className="interface-registry-row" key={namespace}>
            <code>{namespace}</code>
            <input
              disabled={!canAdmin}
              value={meta.label || ''}
              onChange={e => updateInterface(namespace, { label: e.target.value })}
              placeholder="Label"
            />
            <input
              disabled={!canAdmin}
              value={meta.version || ''}
              onChange={e => updateInterface(namespace, { version: e.target.value })}
              placeholder="Version"
            />
            <input
              disabled={!canAdmin}
              value={meta.owner || ''}
              onChange={e => updateInterface(namespace, { owner: e.target.value })}
              placeholder="Owner"
            />
            <input
              disabled={!canAdmin}
              value={meta.route || ''}
              onChange={e => updateInterface(namespace, { route: e.target.value })}
              placeholder="Route"
            />
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.namespace}
          onChange={e => setDraft({ ...draft, namespace: e.target.value })}
          placeholder="Namespace"
        />
        <input
          disabled={!canAdmin}
          value={draft.label}
          onChange={e => setDraft({ ...draft, label: e.target.value })}
          placeholder="Label"
        />
        <input
          disabled={!canAdmin}
          value={draft.version}
          onChange={e => setDraft({ ...draft, version: e.target.value })}
          placeholder="Version"
        />
        <input
          disabled={!canAdmin}
          value={draft.owner}
          onChange={e => setDraft({ ...draft, owner: e.target.value })}
          placeholder="Owner"
        />
        <input
          disabled={!canAdmin}
          value={draft.route}
          onChange={e => setDraft({ ...draft, route: e.target.value })}
          placeholder="Route"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add namespace
        </button>
      </div>
      <div className="developer-i18n-snippet">
        <div>
          <strong>Developer integration</strong>
          <span>Use the global engine in any frontend interface.</span>
        </div>
        <pre data-no-i18n>{sample}</pre>
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedJsonConfigEditor
          disabled
          label="Missing key log (collected while people use the app; kept in server memory)"
          value={missing}
          onChange={() => {}}
        />
        <AdvancedJsonConfigEditor
          path="localization.translationMemory"
          disabled={!canAdmin}
          label="Translation memory"
          value={localization.translationMemory || []}
          onChange={v => patch('localization.translationMemory', Array.isArray(v) ? v : [])}
        />
        <AdvancedJsonConfigEditor
          path="localization.keyPolicy"
          disabled={!canAdmin}
          label="Key policy"
          value={localization.keyPolicy || {}}
          onChange={v => patch('localization.keyPolicy', v)}
        />
        <AdvancedJsonConfigEditor
          path="localization.runtime"
          disabled={!canAdmin}
          label="Runtime controls"
          value={localization.runtime || {}}
          onChange={v => patch('localization.runtime', v)}
        />
      </div>
    </div>
  )
}

export function TranslationManager({ form, patch, canAdmin }) {
  const [language, setLanguage] = useState(form.localization?.defaultLanguage || 'en')
  const [query, setQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [missingServer, setMissingServer] = useState(null)
  const active = form.localization?.activeLanguages || ['en']
  const fallback = form.localization?.fallbackLanguage || 'en'
  const translations = form.localization?.translations || {}
  const approval = form.localization?.approvalWorkflow?.statusByKey || {}
  const keys = [...new Set(Object.values(translations).flatMap(catalog => Object.keys(catalog || {})))].sort()
  const visible = keys.filter(
    key =>
      key.toLowerCase().includes(query.toLowerCase()) ||
      String(translations?.[language]?.[key] || '')
        .toLowerCase()
        .includes(query.toLowerCase())
  )
  const setTranslation = (key, value) =>
    patch('localization.translations', {
      ...translations,
      [language]: { ...(translations[language] || {}), [key]: value }
    })
  const addKey = () => {
    if (!newKey.trim()) return
    setTranslation(newKey.trim(), translations?.[language]?.[newKey.trim()] || '')
    patch(`localization.approvalWorkflow.statusByKey.${newKey.trim()}`, 'draft')
    setNewKey('')
  }
  const exportLanguage = () =>
    downloadBlob(
      new Blob([JSON.stringify(translations[language] || {}, null, 2)], { type: 'application/json' }),
      `atlas-${language}-translations.json`
    )
  const importLanguage = () => {
    try {
      const parsed = JSON.parse(importText)
      patch('localization.translations', {
        ...translations,
        [language]: { ...(translations[language] || {}), ...parsed }
      })
      setImportText('')
      setImportError('')
    } catch {
      setImportError('Invalid translation JSON.')
    }
  }
  const scanMissing = async () => {
    try {
      setMissingServer(await api.get('/api/settings/translations/missing'))
    } catch {
      setMissingServer({ error: 'Unable to scan saved settings. Save first, then scan again.' })
    }
  }
  const missing = keys.filter(key => !translations?.[language]?.[key]).length
  return (
    <div className="translation-manager">
      <div className="admin-toolbar">
        <label>
          Language
          <select disabled={!canAdmin} value={language} onChange={e => setLanguage(e.target.value)}>
            {active.map(code => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="settings.projects.create_button" />
        </label>
        <button type="button" className="secondary-button" onClick={exportLanguage}>
          Export JSON
        </button>
        <button type="button" className="secondary-button" onClick={scanMissing}>
          Scan saved missing keys
        </button>
      </div>
      <div className="settings-note">
        <Icon name="warning" size={15} />
        <span>
          {missing} missing keys for {language}; fallback language is {fallback}. Approval workflow is{' '}
          {form.localization?.approvalWorkflow?.enabled ? 'enabled' : 'disabled'}.
        </span>
      </div>
      {missingServer && (
        <div className="settings-note">
          <Icon name={missingServer.error ? 'warning' : 'check'} size={15} />
          <span>
            {missingServer.error ||
              `${missingServer.totalMissing || 0} missing saved translations across ${Object.keys(missingServer.byLanguage || {}).length} language(s).`}
          </span>
        </div>
      )}
      <div className="translation-import">
        <textarea
          disabled={!canAdmin}
          value={importText}
          onChange={e => setImportText(e.target.value)}
          rows={3}
          placeholder="Paste translation JSON for selected language"
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || !importText.trim()}
          onClick={importLanguage}
        >
          Import language JSON
        </button>
      </div>
      {importError && (
        <div className="form-error">
          <Icon name="warning" size={15} />
          {importError}
        </div>
      )}
      <div className="translation-add">
        <input
          disabled={!canAdmin}
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="translation.key"
        />
        <button type="button" className="secondary-button" onClick={addKey} disabled={!canAdmin}>
          Add key
        </button>
      </div>
      <div className="translation-list advanced-translation-list">
        {visible.slice(0, 160).map(key => (
          <div className="translation-row" key={key}>
            <code>{key}</code>
            <small>{translations?.[fallback]?.[key] || 'No fallback'}</small>
            <input
              disabled={!canAdmin}
              dir={textDirection({
                localization: {
                  defaultLanguage: language,
                  textDirectionByLanguage: form.localization?.textDirectionByLanguage
                }
              })}
              value={translations?.[language]?.[key] || ''}
              onChange={e => setTranslation(key, e.target.value)}
              placeholder="Missing translation"
            />
            <select
              disabled={!canAdmin}
              value={approval[key] || 'approved'}
              onChange={e => patch(`localization.approvalWorkflow.statusByKey.${key}`, e.target.value)}
            >
              <option>approved</option>
              <option>draft</option>
              <option>review</option>
              <option>rejected</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function SettingsImportExport({ form, canAdmin, updateSettings, setForm }) {
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  const exportSettings = () =>
    downloadBlob(new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' }), 'atlas-settings-export.json')
  const importSettings = async () => {
    try {
      const parsed = JSON.parse(json)
      const settings = parsed.settings || parsed
      setForm(settings)
      if (canAdmin) await updateSettings(settings)
      setError('')
    } catch {
      setError('Invalid settings JSON.')
    }
  }
  return (
    <div className="settings-fields">
      <div className="admin-toolbar">
        <button type="button" className="secondary-button" onClick={exportSettings}>
          Export settings JSON
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || !json.trim()}
          onClick={importSettings}
        >
          Import settings JSON
        </button>
      </div>
      <label>
        Import JSON
        <textarea
          disabled={!canAdmin}
          value={json}
          onChange={e => setJson(e.target.value)}
          rows={5}
          placeholder='{"workspace":{"name":"..."}}'
        />
      </label>
      {error && (
        <div className="form-error">
          <Icon name="warning" size={15} />
          {error}
        </div>
      )}
    </div>
  )
}

export function advancedMissingTranslations(form) {
  const translations = form.localization?.translations || {}
  const keys = [...new Set(Object.values(translations).flatMap(catalog => Object.keys(catalog || {})))]
  return (form.localization?.activeLanguages || []).reduce(
    (sum, language) => sum + keys.filter(key => !translations?.[language]?.[key]).length,
    0
  )
}

export function AdvancedLanguagePackagesAdmin({ form, patch, canAdmin }) {
  const packages = form.localization?.languagePackages || []
  const [draft, setDraft] = useState({ code: '', name: '', direction: 'ltr' })
  const commit = rows => {
    patch('localization.languagePackages', rows)
    patch(
      'localization.activeLanguages',
      rows.filter(row => row.enabled !== false).map(row => row.code)
    )
  }
  const updatePackage = (index, patchRow) =>
    commit(packages.map((row, i) => (i === index ? { ...row, ...patchRow } : row)))
  const add = () => {
    const code = draft.code.trim().toLowerCase()
    if (!code || packages.some(row => row.code === code)) return
    commit([
      ...packages,
      { code, name: draft.name || code, direction: draft.direction, enabled: true, version: '1.0.0', status: 'draft' }
    ])
    patch(`localization.textDirectionByLanguage.${code}`, draft.direction)
    patch('localization.translations', { ...(form.localization?.translations || {}), [code]: {} })
    setDraft({ code: '', name: '', direction: 'ltr' })
  }
  return (
    <div className="language-package-admin">
      <div className="language-package-list">
        {packages.map((language, index) => (
          <div className="language-package-row" key={language.code}>
            <label className="switch-inline">
              <input
                disabled={!canAdmin || language.code === 'en'}
                type="checkbox"
                checked={language.enabled !== false}
                onChange={e => updatePackage(index, { enabled: e.target.checked })}
              />
              {language.code}
            </label>
            <input
              disabled={!canAdmin}
              value={language.name || ''}
              onChange={e => updatePackage(index, { name: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={language.direction || 'ltr'}
              onChange={e => {
                updatePackage(index, { direction: e.target.value })
                patch(`localization.textDirectionByLanguage.${language.code}`, e.target.value)
              }}
            >
              <option value="ltr">LTR</option>
              <option value="rtl">RTL</option>
            </select>
            <input
              disabled={!canAdmin}
              value={language.version || '1.0.0'}
              onChange={e => updatePackage(index, { version: e.target.value })}
              aria-label={`${language.code} version`}
            />
            <select
              disabled={!canAdmin}
              value={language.status || 'approved'}
              onChange={e => updatePackage(index, { status: e.target.value })}
            >
              <option>approved</option>
              <option>draft</option>
              <option>review</option>
            </select>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.code}
          onChange={e => setDraft({ ...draft, code: e.target.value })}
          placeholder="locale code"
        />
        <input
          disabled={!canAdmin}
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Language name"
        />
        <select
          disabled={!canAdmin}
          value={draft.direction}
          onChange={e => setDraft({ ...draft, direction: e.target.value })}
        >
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add package
        </button>
      </div>
    </div>
  )
}
