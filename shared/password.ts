// Password policy shared by the server (which enforces it) and the browser (which previews it).
// Length-based (NIST SP 800-63B style): a minimum length, a maximum to bound hashing cost, and a deny-list of passwords
// that appear in every breach corpus. No arbitrary composition rules.
const COMMON_PASSWORDS = new Set(
  `password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword 12345678 123456789 1234567890 12341234
  11111111 00000000 87654321 123123123 1q2w3e4r 1q2w3e4r5t 1qaz2wsx qwertyui qwerty123 qwerty1234 qwertyuiop asdfghjk asdfghjkl
  zxcvbnm1 iloveyou iloveyou1 letmein1 letmein123 welcome1 welcome123 welcome12 admin123 admin1234 administrator adminadmin
  changeme changeme1 changeme123 abc12345 abcd1234 abcdefgh trustno1 monkey123 dragon123 football1 baseball1 superman1
  sunshine1 princess1 master123 shadow123 michael1 jennifer1 starwars1 whatever1 freedom1 batman123 passpass secret123
  atlas123 atlasatlas atlas1234 atlasworkspace workspace1 workspace123 test1234 testtest testing123 qazwsxedc`
    .split(/\s+/)
    .filter(Boolean)
)

export interface PasswordContext {
  minLength?: number
  email?: string
  name?: string
}
/** Returns a human-readable problem, or null when the password is acceptable. */
export function validatePassword(password: unknown, context: PasswordContext = {}): string | null {
  const min = Math.max(8, Math.min(128, Number(context.minLength) || 8))
  if (typeof password !== 'string') return 'A password is required'
  if (password.length < min) return `Password must be at least ${min} characters`
  if (password.length > 128) return 'Password must be at most 128 characters'
  if (/^\s+$/.test(password)) return 'Password cannot be only whitespace'
  if (new Set(password).size < 4) return 'Password is too repetitive'
  const lower = password.toLowerCase()
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose a less predictable one'
  const local = String(context.email || '')
    .split('@')[0]
    .toLowerCase()
  if (local.length >= 4 && lower.includes(local)) return 'Password must not contain your email address'
  return null
}

export function passwordStrength(password: string): 'weak' | 'fair' | 'strong' {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(rx => rx.test(password)).length
  if (password.length >= 14 || (password.length >= 12 && classes >= 3)) return 'strong'
  if (password.length >= 10 && classes >= 2) return 'fair'
  return 'weak'
}
