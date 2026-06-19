import React from 'react';

interface ReconcileViewProps {
  reconcileResult: { newInStripe: number; missingInStore: number; matched: number } | null;
  onMerge: () => void;
  onClose: () => void;
}

const ReconcileView: React.FC<ReconcileViewProps> = ({ reconcileResult, onMerge, onClose }) => {
  if (!reconcileResult) return null;

  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-lg max-w-md mx-auto">
      <h4 className="font-black text-slate-900 uppercase text-sm mb-4">Reconcile Result</h4>
      <div className="space-y-2 text-sm">
        <p><span className="font-bold text-emerald-600">Matched:</span> {reconcileResult.matched} transactions</p>
        <p><span className="font-bold text-amber-600">New in Stripe:</span> {reconcileResult.newInStripe} (not in store)</p>
        <p><span className="font-bold text-rose-600">Missing in store:</span> {reconcileResult.missingInStore}</p>
      </div>
      <button onClick={onMerge} className="mt-4 w-full bg-slate-900 text-white py-3 rounded-xl font-black text-xs uppercase">
        Fetch &amp; Merge New Data
      </button>
      <button onClick={onClose} className="mt-2 w-full border border-slate-200 py-2 rounded-xl text-xs font-bold text-slate-600">
        Close
      </button>
    </div>
  );
};

export default ReconcileView;
