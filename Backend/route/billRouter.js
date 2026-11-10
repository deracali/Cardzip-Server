import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import { authenticateAdmin, requireAdminPermission } from '../middleware/authenticateAdmin.js';
import requireFeatureEnabled from '../middleware/requireFeatureEnabled.js';
import {
  getAdminBillPaymentHistory,
  getBillPaymentHistory,
  initializeBillPaystackPayment,
  payBillWithWallet,
  verifyBillPaystackPayment,
} from '../controller/billController.js';

const billRouter = express.Router();

billRouter.get('/history', authenticateUser, getBillPaymentHistory);
billRouter.get('/admin/history', authenticateAdmin, requireAdminPermission('Bill Payments'), getAdminBillPaymentHistory);
billRouter.post('/pay', requireFeatureEnabled('vtpassBillsEnabled'), authenticateUser, payBillWithWallet);
billRouter.post('/paystack/initialize', requireFeatureEnabled('vtpassBillsEnabled'), authenticateUser, initializeBillPaystackPayment);
billRouter.post('/paystack/verify', authenticateUser, verifyBillPaystackPayment);

export default billRouter;