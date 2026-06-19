/**
 * Agentic MAS – view of agent personas and architecture.
 */

import React from 'react';
import { agentPersonas } from '../agents';

const AgentArchitectureView: React.FC = () => {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Agentic Enterprise Architecture</h1>
        <p className="text-slate-600 mt-2 text-sm max-w-2xl">
          Autonomous agents collaborate to execute, monitor, and optimize cross-functional processes. The Orchestrator routes your requests to specialized agents and tools; tax and accounting use deterministic APIs only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {agentPersonas.map((p) => (
          <div
            key={p.id}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl opacity-80">{(p.id === 'operations' && '⚙️') || (p.id === 'sales' && '📈') || (p.id === 'hr' && '👥') || (p.id === 'procurement' && '🛒') || (p.id === 'expense' && '🧾') || (p.id === 'finance' && '📒') || (p.id === 'tax' && '🇮🇳') || (p.id === 'compliance' && '📋') || '🤖'}</span>
              <h2 className="font-bold text-slate-900 uppercase tracking-tight">{p.name}</h2>
            </div>
            <p className="text-slate-600 text-xs leading-relaxed">{p.description}</p>
            <p className="text-slate-500 text-[11px] mt-2 font-medium">{p.responsibilities}</p>
          </div>
        ))}
      </div>

      <div className="bg-slate-100 border border-slate-200 rounded-xl p-5 text-xs text-slate-700">
        <p className="font-bold uppercase tracking-wider text-slate-900 mb-2">Design principles</p>
        <ul className="list-disc list-inside space-y-1">
          <li><strong>Deterministic tools:</strong> Tax and accounting are computed via APIs (e.g. Avalara/Vertex), not by the LLM.</li>
          <li><strong>Human-in-the-loop:</strong> Financial transfers and final approvals require human authorization.</li>
          <li><strong>RBAC:</strong> Each agent can only call tools it is allowed to use.</li>
          <li><strong>Auditability:</strong> Every run produces an audit trail (Chain-of-Thought).</li>
        </ul>
        <p className="mt-3 text-slate-500">See <code className="bg-slate-200 px-1 rounded">AGENTIC_ARCHITECTURE.md</code> for full documentation.</p>
      </div>
    </div>
  );
};

export default AgentArchitectureView;
