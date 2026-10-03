import assert from 'node:assert/strict'
import { formatLocalizedDate, textDirection } from './localization.js'

const date = '2026-03-08'
const settings = language => ({
  localization: { defaultLanguage: language, textDirectionByLanguage: { en: 'ltr', ar: 'rtl', fa: 'rtl', he: 'rtl' } },
  workspace: { defaultTimezone: 'Pacific/Kiritimati' }
})

assert.equal(textDirection(settings('en')), 'ltr')
assert.equal(textDirection(settings('ar')), 'rtl')
assert.equal(formatLocalizedDate('', settings('ar')), '')
assert.equal(formatLocalizedDate('not-a-date', settings('fa')), 'not-a-date')
assert.equal(formatLocalizedDate(date, settings('en')), new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)), 'date-only values do not shift with the workspace timezone')
assert.notEqual(formatLocalizedDate(date, settings('ar')), date)
assert.notEqual(formatLocalizedDate(date, settings('fa')), date)
assert.notEqual(formatLocalizedDate(date, settings('he')), date)
const timestamp = '2026-03-14T00:30:00Z'
assert.equal(formatLocalizedDate(timestamp, { ...settings('en'), workspace: { defaultTimezone: 'America/Los_Angeles' } }), new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'America/Los_Angeles' }).format(new Date(timestamp)), 'timestamps use the configured workspace timezone')

console.log('Localized date formatting and RTL direction checks passed')
