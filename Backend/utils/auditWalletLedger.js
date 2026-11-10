import WalletTransaction from '../model/walletTransactionModel.js';

export const auditWalletLedger = async (user, session) => {
  if (!user) {
    return {
      consistent: false,
      walletBalance: null,
      ledgerBalance: null,
      transactionCount: 0,
      reason: 'The wallet owner account could not be found.',
    };
  }

  const query = WalletTransaction.find({ user: user._id })
    .select('type amount balanceBefore balanceAfter status description createdAt')
    .sort({ createdAt: 1, _id: 1 });
  if (session) query.session(session);
  const ledger = await query;
  const walletBalance = Number(user.walletBalance || 0);
  const balanceAffectingLedger = ledger.filter((entry) => {
    if (entry.status !== 'pending') return true;
    const before = Number(entry.balanceBefore);
    const after = Number(entry.balanceAfter);
    return !Number.isFinite(before) || !Number.isFinite(after) || Math.abs(before - after) > 0.01;
  });
  let reason = '';
  let previousBalance = null;

  if (balanceAffectingLedger.length === 0 && walletBalance !== 0) {
    reason = 'Wallet balance is non-zero but no ledger history exists.';
  }

  for (const entry of balanceAffectingLedger) {
    const before = Number(entry.balanceBefore);
    const after = Number(entry.balanceAfter);
    if (!Number.isFinite(before) || !Number.isFinite(after)) {
      reason = `Ledger entry ${entry._id} has an invalid balance.`;
      break;
    }
    if (entry.status === 'failed' && Math.abs(before - after) <= 0.01) continue;
    if (previousBalance !== null && Math.abs(previousBalance - before) > 0.01) {
      reason = `Ledger entry ${entry._id} does not continue from the previous recorded balance.`;
      break;
    }
    const signedAmount = entry.type === 'credit' ? Number(entry.amount) : -Number(entry.amount);
    if (!Number.isFinite(signedAmount) || Math.abs(before + signedAmount - after) > 0.01) {
      reason = `Ledger entry ${entry._id} amount does not match its recorded balance change.`;
      break;
    }
    previousBalance = after;
  }

  if (!reason && previousBalance !== null && Math.abs(previousBalance - walletBalance) > 0.01) {
    reason = 'Current wallet balance does not match the latest ledger balance.';
  }

  return {
    consistent: !reason,
    walletBalance,
    ledgerBalance: previousBalance,
    transactionCount: ledger.length,
    history: ledger.slice(-8).reverse().map((entry) => ({
      type: entry.type,
      amount: Number(entry.amount),
      balanceBefore: Number(entry.balanceBefore),
      balanceAfter: Number(entry.balanceAfter),
      status: entry.status,
      description: entry.description,
      createdAt: entry.createdAt,
    })),
    reason,
  };
};
