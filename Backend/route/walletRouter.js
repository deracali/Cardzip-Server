import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import {
  getUserWallet,
  getWalletHistory,
  getMyWithdrawalRequests,
  withdrawWallet,
} from '../controller/walletController.js';

const walletRouter = express.Router();

walletRouter.get('/balance', authenticateUser, getUserWallet);
walletRouter.get('/history', authenticateUser, getWalletHistory);
walletRouter.get('/withdrawals', authenticateUser, getMyWithdrawalRequests);
walletRouter.post('/withdraw', authenticateUser, withdrawWallet);

export default walletRouter;
