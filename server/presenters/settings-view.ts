// What each audience may see of the settings document. Administrators receive the whole tree (minus the bulky runtime
// missing-key log, which has its own endpoint); everyone else receives only what is needed to render screens. Security,
// audit, integration and storage settings and the role/permission registry never leave the server for non-administrators.
import { withLegacySettings } from '../../shared/settings'

/** Top-level settings branches every signed-in user needs to render the UI. */
const MEMBER_BRANCHES = [
  'workspace',
  'interface',
  'modules',
  'workflows',
  'customFields',
  'exports',
  'reports'
] as const
const MEMBER_LOCALIZATION = [
  'activeLanguages',
  'defaultLanguage',
  'fallbackLanguage',
  'userLanguagePreference',
  'textDirectionByLanguage',
  'dateFormats',
  'numberFormats',
  'currencyFormats',
  'timezoneFormats',
  'translations',
  'languagePackages',
  'runtime'
] as const

export function settingsForClient(settings: any, admin: boolean): any {
  if (admin) {
    const copy = structuredClone(settings)
    if (copy.localization) {
      copy.localization.missingKeys = []
      copy.localization.missingKeyCount = settings.localization?.missingKeys?.length || 0
    }
    return copy
  }
  const out: any = {}
  for (const branch of MEMBER_BRANCHES)
    if (settings[branch] !== undefined) out[branch] = structuredClone(settings[branch])
  if (out.workspace) out.workspace = { ...out.workspace, organization: undefined }
  out.localization = {}
  for (const key of MEMBER_LOCALIZATION)
    if (settings.localization?.[key] !== undefined) out.localization[key] = structuredClone(settings.localization[key])
  return withLegacySettings(out)
}
