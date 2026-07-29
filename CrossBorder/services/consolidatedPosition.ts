/**
 * Cross-entity consolidated financial position (REQ-001).
 */
export interface ConsolidatedPositionInput {
  parentName: string;
  subsidiaryName: string;
  /** Income / expenses / purchases in a common base currency */
  income: number;
  expenses: number;
  purchases: number;
  receivables?: number;
  payables?: number;
}

export interface ConsolidatedPosition {
  entities: string[];
  cash: number;
  receivables: number;
  payables: number;
  netAssets: number;
}

export function computeConsolidatedPosition(input: ConsolidatedPositionInput): ConsolidatedPosition {
  const parent = input.parentName.trim();
  const sub = input.subsidiaryName.trim();
  if (!parent || !sub) {
    throw new Error('Both India parent and US subsidiary names are required for consolidation');
  }
  const receivables = input.receivables ?? 0;
  const payables = input.payables ?? 0;
  const cash = input.income - input.expenses - input.purchases;
  return {
    entities: [parent, sub],
    cash,
    receivables,
    payables,
    netAssets: cash + receivables - payables,
  };
}
