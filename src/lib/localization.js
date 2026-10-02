import { RTL_LANGUAGES } from './constants.js'

export function textDirection(settings) {
  const language = settings?.localization?.defaultLanguage || settings?.language || 'en'
  return settings?.localization?.textDirectionByLanguage?.[language] || (RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr')
}
