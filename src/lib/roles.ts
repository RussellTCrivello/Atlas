// Role registry helper.
export function roleDefinitions(settings) {
  return settings?.permissions?.roles || {}
}
