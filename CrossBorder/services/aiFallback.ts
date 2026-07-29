/**
 * AI assistant with Gemini primary + Claude fallback (REQ-052 / REQ-043 / T-040).
 */
export interface InvoiceAnalysisResult {
  isCompliant?: boolean;
  missingElements?: string[];
  suggestedRemedy?: string;
  provider?: 'gemini' | 'claude' | 'heuristic';
}

/**
 * Heuristic fallback when both LLM providers fail — never throws.
 */
export function heuristicInvoiceAnalysis(invoiceText: string): InvoiceAnalysisResult {
  const text = invoiceText.toLowerCase();
  const missing: string[] = [];
  if (!/\bgstin\b|\bgst\b/.test(text)) missing.push('GSTIN / GST reference');
  if (!/\binvoice\s*(no|number|#)\b|\binv[-\s]?\d/i.test(invoiceText)) missing.push('Invoice number');
  if (!/\b(lut|bond|export|zero[- ]rated)\b/.test(text) && /\busd|eur|gbp|foreign\b/.test(text)) {
    missing.push('Export / LUT indication for foreign-currency supply');
  }
  if (!/\b(pan|tan)\b/.test(text) && /\btds\b|\b194[a-z]?\b/.test(text)) {
    missing.push('PAN/TAN for TDS context');
  }
  return {
    isCompliant: missing.length === 0,
    missingElements: missing,
    suggestedRemedy: missing.length
      ? `Add: ${missing.join('; ')}. Re-check against GST/TDS rules before booking.`
      : 'No obvious GST/TDS gaps detected in a quick scan. Confirm with your CA for filing.',
    provider: 'heuristic',
  };
}

export async function analyzeInvoiceWithFallback(
  invoiceText: string,
  deps?: {
    gemini?: (text: string) => Promise<InvoiceAnalysisResult>;
    claude?: (text: string) => Promise<InvoiceAnalysisResult>;
  },
): Promise<InvoiceAnalysisResult> {
  const trimmed = invoiceText.trim();
  if (!trimmed) {
    return {
      isCompliant: false,
      missingElements: ['Invoice text'],
      suggestedRemedy: 'Paste the invoice text before analyzing.',
      provider: 'heuristic',
    };
  }

  if (deps?.gemini) {
    try {
      const result = await deps.gemini(trimmed);
      return { ...result, provider: result.provider ?? 'gemini' };
    } catch {
      // fall through to Claude
    }
  } else {
    try {
      const { analyzeInvoice } = await import('./geminiService');
      const result = await analyzeInvoice(trimmed) as InvoiceAnalysisResult;
      return { ...result, provider: 'gemini' };
    } catch {
      // fall through
    }
  }

  if (deps?.claude) {
    try {
      const result = await deps.claude(trimmed);
      return { ...result, provider: result.provider ?? 'claude' };
    } catch {
      // fall through
    }
  } else {
    try {
      const claudeResult = await analyzeInvoiceViaClaude(trimmed);
      if (claudeResult) return { ...claudeResult, provider: 'claude' };
    } catch {
      // fall through
    }
  }

  return heuristicInvoiceAnalysis(trimmed);
}

async function analyzeInvoiceViaClaude(invoiceText: string): Promise<InvoiceAnalysisResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!apiKey) return null;

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `Analyze this invoice for India-US cross-border GST/TDS compliance. Reply JSON only with keys isCompliant (boolean), missingElements (string[]), suggestedRemedy (string).\n\n${invoiceText}`,
    }],
  });
  const block = msg.content.find((c) => c.type === 'text');
  if (!block || block.type !== 'text') return null;
  const match = block.text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]) as InvoiceAnalysisResult;
}
