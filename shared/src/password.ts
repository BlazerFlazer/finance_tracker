import { PASSWORD_MAX, PASSWORD_MIN } from './constants';

/**
 * Password policy + strength estimator, shared by the sign-up form (live feedback) and the API (enforcement).
 * The strength meter is an estimate: entropy of the character pool, minus penalties for patterns and common words.
 */

export type PasswordIssueCode =
  | 'too_short'
  | 'too_long'
  | 'no_upper'
  | 'no_lower'
  | 'no_digit'
  | 'no_special'
  | 'banned_word'
  | 'too_common'
  | 'contains_username'
  | 'contains_email'
  | 'repeated'
  | 'sequence';

export const STRENGTH_LABELS = ['weak', 'fair', 'good', 'strong', 'very_strong'] as const;
export type StrengthLabel = (typeof STRENGTH_LABELS)[number];

export interface PasswordContext {
  email?: string;
  username?: string;
}

export interface PasswordReport {
  ok: boolean;
  issues: PasswordIssueCode[];
  requirements: { length: boolean; upper: boolean; lower: boolean; digit: boolean; special: boolean };
  score: 0 | 1 | 2 | 3 | 4;
  label: StrengthLabel;
  entropyBits: number;
}

/** Substrings that are never allowed anywhere inside a password (checked after de-leetspeak). */
const BANNED_SUBSTRINGS = [
  '123456', 'password', 'qwerty', 'qwertz', 'azerty', 'letmein', 'iloveyou', 'fintrack',
  'abcdef', '111111', '000000', 'йцукен', 'пароль',
];

/** Frequently used passwords (normalised). Whole-password match => rejected. */
const COMMON_PASSWORDS = new Set(
  `123456 12345678 123456789 12345 1234567 1234567890 qwerty qwerty123 qwertyuiop password password1 password123 passw0rd
  111111 123123 abc123 letmein welcome admin admin123 login iloveyou monkey dragon master sunshine princess football baseball
  shadow superman batman trustno1 starwars freedom whatever hello123 charlie michael jordan jennifer hunter buster soccer harley
  ranger daniel george computer michelle jessica pepper zxcvbnm asdfgh asdfghjkl 1q2w3e4r 1q2w3e 1qaz2wsx qazwsx q1w2e3r4 zaq12wsx
  654321 666666 121212 112233 555555 7777777 123321 000000 987654321 696969 mustang killer secret summer winter spring autumn
  flower cookie cheese ginger tigger internet changeme letmein1 welcome1 monkey123 dragon123 master123 football1 baseball1
  qwe123 qweasd 123qwe 1234qwer 12345qwert zxcvbn qazwsxedc 1234abcd abcd1234 abcdefg abcdefgh a1b2c3 p@ssw0rd p@ssword
  password! password1! passw0rd1 iloveyou1 sunshine1 princess1 ashley nicole chelsea biteme matthew yankees dallas austin
  thunder taylor matrix access blink182 metallica pokemon naruto minecraft fortnite roblox liverpool arsenal chelsea1
  barcelona realmadrid juventus ronaldo messi123 cristiano lakers celtic eagles falcons
  йцукенгшщзх пароль123 привет123 москва123 qwertyui 1qazxsw2 qwerty12 qwerty1 1234567a a1234567 a123456 aa123456 asd123
  parol123 salom123 parol1234 uzbekistan1 toshkent1 samarqand`
    .split(/\s+/)
    .filter(Boolean),
);

const LEET: Record<string, string> = { '@': 'a', '4': 'a', '0': 'o', '1': 'l', '!': 'i', '3': 'e', $: 's', '5': 's', '7': 't', '+': 't', '8': 'b' };

function deLeet(s: string): string {
  return s
    .toLowerCase()
    .split('')
    .map((c) => LEET[c] ?? c)
    .join('');
}

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'йцукенгшщзх', 'фывапролджэ', 'ячсмитьбю'];

function hasSequence(s: string, len = 5): boolean {
  const lower = s.toLowerCase();
  for (let i = 0; i + len <= lower.length; i++) {
    const chunk = lower.slice(i, i + len);
    let asc = true;
    let desc = true;
    for (let j = 1; j < chunk.length; j++) {
      const diff = chunk.charCodeAt(j) - chunk.charCodeAt(j - 1);
      if (diff !== 1) asc = false;
      if (diff !== -1) desc = false;
    }
    if (asc || desc) return true;
    for (const row of KEYBOARD_ROWS) {
      const rev = [...row].reverse().join('');
      if (row.includes(chunk) || rev.includes(chunk)) return true;
    }
  }
  return false;
}

function hasRepeats(s: string, run = 4): boolean {
  return new RegExp(`(.)\\1{${run - 1},}`, 'u').test(s);
}

const SPECIAL_RE = /[^\p{L}\p{N}\s]|_/u;

function poolSize(pw: string): number {
  let pool = 0;
  if (/\p{Ll}/u.test(pw)) pool += 26;
  if (/\p{Lu}/u.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^\p{L}\p{N}]/u.test(pw)) pool += 33;
  if (/[^\x00-\x7f]/.test(pw)) pool += 40;
  return Math.max(pool, 1);
}

export function estimateEntropyBits(pw: string): number {
  if (!pw) return 0;
  const bitsPerChar = Math.log2(poolSize(pw));
  let bits = pw.length * bitsPerChar;
  const norm = deLeet(pw);
  // uniqueness: long passwords made of few distinct characters are weak
  const unique = new Set(pw).size;
  bits = Math.min(bits, unique * bitsPerChar * 1.8);
  if (hasRepeats(pw, 3)) bits -= 8;
  if (hasSequence(pw, 4)) bits -= 10;
  for (const word of BANNED_SUBSTRINGS) if (norm.includes(word)) bits -= word.length * bitsPerChar * 0.8 + 6;
  // common words (letters only) found inside
  for (const common of COMMON_PASSWORDS) if (common.length >= 6 && norm.includes(common)) bits -= common.length * bitsPerChar * 0.6;
  return Math.max(0, Math.round(bits * 10) / 10);
}

function labelFor(bits: number, blocked: boolean): { score: 0 | 1 | 2 | 3 | 4; label: StrengthLabel } {
  if (blocked || bits < 40) return { score: 0, label: 'weak' };
  if (bits < 58) return { score: 1, label: 'fair' };
  if (bits < 75) return { score: 2, label: 'good' };
  if (bits < 100) return { score: 3, label: 'strong' };
  return { score: 4, label: 'very_strong' };
}

export function checkPassword(pw: string, ctx: PasswordContext = {}): PasswordReport {
  const issues: PasswordIssueCode[] = [];
  const requirements = {
    length: pw.length >= PASSWORD_MIN,
    upper: /\p{Lu}/u.test(pw),
    lower: /\p{Ll}/u.test(pw),
    digit: /\d/.test(pw),
    special: SPECIAL_RE.test(pw),
  };
  if (!requirements.length) issues.push('too_short');
  if (pw.length > PASSWORD_MAX) issues.push('too_long');
  if (!requirements.upper) issues.push('no_upper');
  if (!requirements.lower) issues.push('no_lower');
  if (!requirements.digit) issues.push('no_digit');
  if (!requirements.special) issues.push('no_special');

  const lower = pw.toLowerCase();
  const norm = deLeet(pw);
  if (BANNED_SUBSTRINGS.some((w) => norm.includes(w) || lower.includes(w))) issues.push('banned_word');
  const stripped = norm.replace(/[^\p{L}\p{N}]/gu, '');
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(norm) || COMMON_PASSWORDS.has(stripped)) issues.push('too_common');

  const username = ctx.username?.trim().toLowerCase();
  if (username && username.length >= 3 && (lower.includes(username) || norm.includes(deLeet(username)))) issues.push('contains_username');
  const email = ctx.email?.trim().toLowerCase();
  if (email) {
    const local = email.split('@')[0] ?? '';
    if (lower.includes(email) || (local.length >= 3 && (lower.includes(local) || norm.includes(deLeet(local))))) issues.push('contains_email');
  }
  if (hasRepeats(pw, 5)) issues.push('repeated');
  if (hasSequence(pw, 6)) issues.push('sequence');

  const entropyBits = estimateEntropyBits(pw);
  const blocking = issues.some((i) => ['banned_word', 'too_common', 'contains_username', 'contains_email'].includes(i));
  const { score, label } = labelFor(entropyBits, blocking || issues.includes('repeated') || issues.includes('sequence'));
  return { ok: issues.length === 0, issues, requirements, score, label, entropyBits };
}
