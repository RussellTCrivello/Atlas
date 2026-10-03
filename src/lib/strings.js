export function initials(name = '') {
  return String(name).split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export function slug(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

export function colorFor(value = '') {
  const colors = ['purple', 'blue', 'orange', 'green', 'pink', 'teal']
  const hash = [...String(value)].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return colors[hash % colors.length]
}
