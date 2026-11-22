export const COUNTRY_CODES = [
  {code: '+880', label: 'BD (+880)', placeholder: '1618859938'},
  {code: '+1', label: 'US/CA (+1)', placeholder: '4155552671'},
  {code: '+91', label: 'IN (+91)', placeholder: '9876543210'},
  {code: '+44', label: 'UK (+44)', placeholder: '7911123456'},
  {code: '+39', label: 'IT (+39)', placeholder: '3534168971'},
  {code: '+971', label: 'UAE (+971)', placeholder: '501234567'},
  {code: '+966', label: 'SA (+966)', placeholder: '501234567'},
  {code: '+60', label: 'MY (+60)', placeholder: '123456789'},
  {code: '+65', label: 'SG (+65)', placeholder: '91234567'},
  {code: '+92', label: 'PK (+92)', placeholder: '3001234567'},
];

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'fake.com',
  'invalid.com',
  'localhost',
  'asdf.com',
  'abc.com',
  'xyz.com',
  'mailinator.com',
  'tempmail.com',
  'temp-mail.org',
  '10minutemail.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'yopmail.com',
  'yopmail.fr',
  'sharklasers.com',
  'trashmail.com',
  'maildrop.cc',
  'dispostable.com',
  'getnada.com',
  'mohmal.com',
  'throwawaymail.com',
  'fakeinbox.com',
  'mintemail.com',
  'mytemp.email',
  'burnermail.io',
]);

export function validateRealEmail(input: string): {valid: true; email: string} | {valid: false; error: string} {
  const cleaned = input.trim().toLowerCase();
  if (!cleaned || cleaned.length > 120) {
    return {valid: false, error: 'Please enter a valid Gmail or email address.'};
  }
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
    return {valid: false, error: 'Enter a valid email format (for example, yourname@gmail.com).'};
  }
  const [local, domain] = cleaned.split('@');
  if (!local || local.length < 2 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return {valid: false, error: 'Enter a real Gmail or email address.'};
  }
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      error: 'Temporary or fake email domains are not allowed. Please use a real Gmail or email address.',
    };
  }
  return {valid: true, email: cleaned};
}

function hasFakeDigitPattern(digits: string): boolean {
  // Reject all identical digits like 0000000000 or 1111111111
  if (/^(\d)\1+$/.test(digits)) return true;
  // Reject trivial ascending/descending sequences
  const seq = '01234567890123456789';
  const rev = '98765432109876543210';
  const tail = digits.slice(-8);
  if (tail.length >= 8 && (seq.includes(tail) || rev.includes(tail))) return true;
  return false;
}

/**
 * Normalize a phone number cleanly to canonical E.164 format.
 * Handles country code + local input (including BD local 01XXXXXXXXX -> +8801XXXXXXXXX).
 */
export function normalizeToE164(rawInput: string, countryCode = '+880'): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const hasPlus = trimmed.startsWith('+');
  const digitsOnly = trimmed.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;

  let fullDigits = digitsOnly;
  if (hasPlus) {
    // Handle mistaken +88001... -> +8801...
    if (fullDigits.startsWith('88001') && fullDigits.length === 14) {
      fullDigits = '880' + fullDigits.slice(4);
    }
  } else if (fullDigits.startsWith('00')) {
    fullDigits = fullDigits.slice(2);
  } else if (countryCode === '+880' && /^01[3-9]\d{8}$/.test(fullDigits)) {
    fullDigits = '880' + fullDigits.slice(1);
  } else if (countryCode === '+880' && /^1[3-9]\d{8}$/.test(fullDigits)) {
    fullDigits = '880' + fullDigits;
  } else {
    const ccDigits = countryCode.replace(/[^\d]/g, '');
    if (ccDigits && !fullDigits.startsWith(ccDigits)) {
      const stripped = fullDigits.replace(/^0+/, '');
      fullDigits = `${ccDigits}${stripped}`;
    }
  }

  if (fullDigits.length < 8 || fullDigits.length > 15) return null;
  return `+${fullDigits}`;
}

export function validateRealPhone(
  rawInput: string,
  countryCode = '+880',
): {valid: true; phone: string} | {valid: false; error: string} {
  const e164 = normalizeToE164(rawInput, countryCode);
  if (!e164) {
    return {
      valid: false,
      error: 'Enter a valid real phone number with country code (for example, +8801618859938).',
    };
  }
  const digits = e164.slice(1);
  if (hasFakeDigitPattern(digits)) {
    return {
      valid: false,
      error: 'Fake or repeated phone numbers are not allowed. Please enter your real mobile number.',
    };
  }
  // Bangladesh mobile operator validation: +8801[3-9]XXXXXXXX (13 digits total)
  if (digits.startsWith('880') && !/^8801[3-9]\d{8}$/.test(digits)) {
    return {
      valid: false,
      error: 'Enter a valid 11-digit Bangladesh mobile number (e.g., 01618859938 or +8801618859938).',
    };
  }
  return {valid: true, phone: e164};
}

/**
 * Generates candidate phone representations for reliable login matching
 * across E.164 (+8801618859938), local BD (01618859938), and legacy (+01618859938).
 */
export function buildPhoneLookupCandidates(rawInput: string): string[] {
  const trimmed = rawInput.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 16) return [];

  const set = new Set<string>();
  set.add(`+${digits}`);
  if (/^01[3-9]\d{8}$/.test(digits)) {
    set.add(`+880${digits.slice(1)}`);
  }
  if (/^8801[3-9]\d{8}$/.test(digits)) {
    set.add(`+0${digits.slice(3)}`);
    set.add(`+${digits.slice(3)}`);
  }
  if (/^1[3-9]\d{8}$/.test(digits)) {
    set.add(`+880${digits}`);
    set.add(`+0${digits}`);
  }
  return Array.from(set);
}
