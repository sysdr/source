/**
 * Load `.env` / `.env.local` into process.env before the rest of the server starts.
 * Missing files are ignored (no throw). Existing process.env values win.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eq = trimmed.indexOf('=');
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!key) return null;
  return { key, value };
}

function loadFile(filePath: string): void {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    // Non-fatal: continue startup with whatever env is already set
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  }
}

loadFile(path.join(ROOT, '.env'));
loadFile(path.join(ROOT, '.env.local'));

// geminiService reads API_KEY; Vite injects GEMINI_API_KEY — keep both in sync
if (!process.env.API_KEY && process.env.GEMINI_API_KEY) {
  process.env.API_KEY = process.env.GEMINI_API_KEY;
}
if (!process.env.GEMINI_API_KEY && process.env.API_KEY) {
  process.env.GEMINI_API_KEY = process.env.API_KEY;
}
