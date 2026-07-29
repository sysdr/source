import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ENC_PREFIX = 'enc:v1:';

type UnknownRecord = Record<string, unknown>;

function getEncryptionKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY || '';
  if (!raw) return Buffer.alloc(0);
  return createHash('sha256').update(raw, 'utf8').digest();
}

function canEncrypt(): boolean {
  return getEncryptionKey().length === 32;
}

function encodePart(v: Buffer): string {
  return v.toString('base64url');
}

function decodePart(v: string): Buffer {
  return Buffer.from(v, 'base64url');
}

export function isEncryptedString(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENC_PREFIX);
}

export function encryptString(value: string): string {
  if (!value || !canEncrypt()) return value;
  if (value.startsWith(ENC_PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${encodePart(iv)}:${encodePart(encrypted)}:${encodePart(tag)}`;
}

export function decryptString(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX) || !canEncrypt()) return value;
  const payload = value.slice(ENC_PREFIX.length);
  const [ivRaw, encryptedRaw, tagRaw] = payload.split(':');
  if (!ivRaw || !encryptedRaw || !tagRaw) return value;
  try {
    const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), decodePart(ivRaw));
    decipher.setAuthTag(decodePart(tagRaw));
    const decrypted = Buffer.concat([decipher.update(decodePart(encryptedRaw)), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return value;
  }
}

export function maskValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(Math.max(1, trimmed.length));
  const visible = trimmed.slice(-4);
  return `${'*'.repeat(Math.max(4, trimmed.length - 4))}${visible}`;
}

function mapObject(input: unknown, mapper: (key: string, value: unknown) => unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => mapObject(v, mapper));
  if (!input || typeof input !== 'object') return input;
  const obj = input as UnknownRecord;
  const out: UnknownRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    const mapped = mapObject(value, mapper);
    out[key] = mapper(key, mapped);
  }
  return out;
}

const EMPLOYEE_PII_KEYS = new Set([
  'panNumber',
  'aadhaarNumber',
  'uan',
  'esiNumber',
  'bankAccountNumber',
  'bankIFSC',
]);

const PROFILE_PII_KEYS = new Set([
  'taxId',
  'pan',
  'tan',
  'llpin',
  'ein',
]);

export function encryptEmployeePII<T>(employee: T): T {
  return mapObject(employee, (key, value) => (
    EMPLOYEE_PII_KEYS.has(key) && typeof value === 'string' ? encryptString(value) : value
  )) as T;
}

export function decryptEmployeePII<T>(employee: T): T {
  return mapObject(employee, (key, value) => (
    EMPLOYEE_PII_KEYS.has(key) && typeof value === 'string' ? decryptString(value) : value
  )) as T;
}

export function maskEmployeePII<T>(employee: T): T {
  return mapObject(employee, (key, value) => {
    if (!EMPLOYEE_PII_KEYS.has(key) || typeof value !== 'string') return value;
    const plain = decryptString(value);
    return maskValue(plain);
  }) as T;
}

export function encryptOrgProfilePII<T>(profile: T): T {
  return mapObject(profile, (key, value) => (
    PROFILE_PII_KEYS.has(key) && typeof value === 'string' ? encryptString(value) : value
  )) as T;
}

export function decryptOrgProfilePII<T>(profile: T): T {
  return mapObject(profile, (key, value) => (
    PROFILE_PII_KEYS.has(key) && typeof value === 'string' ? decryptString(value) : value
  )) as T;
}

function countPlaintextKeys(input: unknown, keys: Set<string>): number {
  let count = 0;
  if (Array.isArray(input)) {
    for (const item of input) count += countPlaintextKeys(item, keys);
    return count;
  }
  if (!input || typeof input !== 'object') return 0;
  for (const [key, value] of Object.entries(input as UnknownRecord)) {
    if (keys.has(key) && typeof value === 'string' && value.trim() && !isEncryptedString(value)) {
      count += 1;
    } else {
      count += countPlaintextKeys(value, keys);
    }
  }
  return count;
}

export function countPlaintextEmployeePiiFields(employee: unknown): number {
  return countPlaintextKeys(employee, EMPLOYEE_PII_KEYS);
}

export function countPlaintextProfilePiiFields(profile: unknown): number {
  return countPlaintextKeys(profile, PROFILE_PII_KEYS);
}

export function encryptionEnabled(): boolean {
  return canEncrypt();
}

