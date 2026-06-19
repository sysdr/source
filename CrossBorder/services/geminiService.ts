
import { GoogleGenAI, Type } from "@google/genai";

// Initialize the Google GenAI client using the API key from environment variables.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/** Orchestrator routing: which agents to use and optional tool(s) to call. */
export interface OrchestratorRouteResult {
  selectedAgents: string[];
  intent: string;
  suggestedReply?: string;
  /** Single tool (backward compatible). */
  toolToCall?: { toolId: string; params?: Record<string, unknown> };
  /** Multi-tool: run these in order. */
  toolCalls?: { toolId: string; params?: Record<string, unknown> }[];
  /** When true, after tools run a specialist agent (e.g. compliance) for deeper reply. */
  invokeSpecialist?: boolean;
  specialistAgent?: string;
}

export const getOrchestratorRoute = async (
  userMessage: string,
  orgContextLine: string,
  recentTurns?: { role: string; content: string }[]
): Promise<OrchestratorRouteResult> => {
  try {
    const history = recentTurns?.length
      ? recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n') + '\nuser: ' + userMessage
      : userMessage;
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Org context: ${orgContextLine}\n\nCurrent exchange:\n${history}`,
      config: {
        systemInstruction: `You are the CEO Orchestrator of an Agentic Enterprise. You route user requests to specialized agents and optionally request a tool call.
Available agents: operations (sync, capacity), sales (revenue, deals), hr (employees, payroll), procurement (POs, vendors), expense (receipts, invoices), finance (ledger, reconciliation), tax (VAT/GST via API), compliance (India-US regulations, Form 5472, GST).
Available tools: read_company_profile, read_transactions, read_employees, read_revenue_data, read_payroll_runs, read_transfer_pricing, read_tax_engine, read_platform_rules, read_vault_summary, stripe_sync, fx_rate, tax_calculate, compliance_advice, analyze_invoice, add_transaction, read_pending_transactions, approve_pending_transaction.
Respond with JSON only. Select 1-3 agents. Then:
- For compliance/tax/regulatory questions use toolToCall: { "toolId": "compliance_advice", "params": { "query": "<exact user question>" } }.
- For "how many employees", "list employees", "who works here" use toolToCall: { "toolId": "read_employees", "params": {} }; select agents: ["hr"].
- For "revenue", "transactions", "sales data", "how much revenue" use toolToCall: { "toolId": "read_revenue_data", "params": {} } or read_transactions; select agents: ["sales", "finance"].
- For "sync Stripe", "fetch Stripe", "pull latest data" use toolToCall: { "toolId": "stripe_sync", "params": {} }; select agents: ["operations"].
- For invoice/receipt check use toolToCall: { "toolId": "analyze_invoice", "params": { "invoiceText": "<user pasted text>" } }.
- For "post a transaction", "add expense", "record payment", "add income", "add to ledger" use toolToCall: { "toolId": "add_transaction", "params": { "description": "<user description>", "amount": <number>, "type": "Income"|"Expense"|"Purchase", "category": "<optional category>" } }; select agents: ["finance"].
- For "pending transactions", "awaiting approval", "list pending" use toolToCall: { "toolId": "read_pending_transactions", "params": {} }; select agents: ["finance"].
- For "approve transaction", "approve pending <id>" use toolToCall: { "toolId": "approve_pending_transaction", "params": { "transactionId": "<id>" } }; select agents: ["finance"].
You may optionally set toolCalls (array of { toolId, params }) to run multiple tools in one turn. For complex compliance/tax questions set invokeSpecialist: true and specialistAgent to "compliance" or "tax" to get a deeper specialist reply after tools.
Give a brief suggestedReply only when the user asks a simple conversational question that does not need a tool.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            selectedAgents: { type: Type.ARRAY, items: { type: Type.STRING } },
            intent: { type: Type.STRING },
            suggestedReply: { type: Type.STRING },
            toolToCall: {
              type: Type.OBJECT,
              properties: {
                toolId: { type: Type.STRING },
                params: { type: Type.OBJECT }
              }
            },
            toolCalls: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  toolId: { type: Type.STRING },
                  params: { type: Type.OBJECT }
                }
              }
            },
            invokeSpecialist: { type: Type.BOOLEAN },
            specialistAgent: { type: Type.STRING }
          }
        }
      },
    });
    const text = response.text?.trim() || '{}';
    const parsed = JSON.parse(text) as OrchestratorRouteResult;
    if (!Array.isArray(parsed.selectedAgents)) parsed.selectedAgents = ['compliance'];
    if (!parsed.intent) parsed.intent = 'general';
    return parsed;
  } catch (error) {
    console.error("Orchestrator route Error:", error);
    return {
      selectedAgents: ['compliance'],
      intent: 'fallback',
      suggestedReply: "I'm having trouble routing your request. Please try again or ask about compliance (e.g. Form 5472, GST).",
    };
  }
};

export const getComplianceAdvice = async (query: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `User asks: ${query}. 
      Context: The user is an Indian founder with an Indian LLP and a US C-Corp subsidiary running a newsletter business. 
      Analyze the query regarding US (IRS/FinCEN) and Indian (CBDT/RBI/GST) regulations. Provide concise, actionable advice.`,
      config: {
        systemInstruction: "You are an expert cross-border financial consultant specializing in India-US tax treaties and compliance. Keep answers brief and professional.",
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "I'm having trouble connecting to my legal brain right now. Please try again later.";
  }
};

export const analyzeInvoice = async (invoiceText: string) => {
  // Analyze invoice for cross-border compliance using Gemini.
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze this invoice for cross-border compliance: ${invoiceText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isCompliant: { type: Type.BOOLEAN },
          missingElements: { type: Type.ARRAY, items: { type: Type.STRING } },
          suggestedRemedy: { type: Type.STRING }
        }
      }
    }
  });
  return JSON.parse(response.text || '{}');
};

/** Specialist agent invocation: one domain agent (e.g. compliance, tax) with context for deeper reply. */
export interface InvokeSpecialistInput {
  agentId: string;
  userMessage: string;
  toolContextSummary?: string;
  recentTurns?: { role: string; content: string }[];
}

export async function invokeSpecialistAgent(input: InvokeSpecialistInput): Promise<string | null> {
  const { agentId, userMessage, toolContextSummary, recentTurns } = input;
  try {
    const { getAgentPersona } = await import('../agents/personas');
    const persona = getAgentPersona(agentId as import('../agents/types').AgentId);
    const systemInstruction = persona
      ? `You are ${persona.name}. ${persona.description}. ${persona.responsibilities}. Answer the user concisely using the context provided.`
      : `You are a ${agentId} specialist. Answer the user concisely using the context provided.`;

    const contextParts = [toolContextSummary ? `Tool results summary: ${toolContextSummary}` : '', `User question: ${userMessage}`].filter(Boolean);
    const history = recentTurns?.length
      ? recentTurns.map((t) => `${t.role}: ${t.content}`).join('\n') + '\n'
      : '';
    const contents = history + contextParts.join('\n');

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents,
      config: { systemInstruction },
    });
    return response.text?.trim() ?? null;
  } catch (error) {
    console.error("Specialist agent Error:", error);
    return null;
  }
}
