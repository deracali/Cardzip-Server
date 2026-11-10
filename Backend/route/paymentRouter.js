import express from 'express';
import authenticateUser from '../middleware/authenticateUser.js';
import {
  downloadPurchasedDigitalProductFile,
  getMyDigitalProductPayments,
  initializePaystackPayment,
  verifyPaystackPayment,
} from '../controller/paymentController.js';

const paymentRouter = express.Router();

paymentRouter.post('/paystack/initialize', authenticateUser, initializePaystackPayment);
paymentRouter.post('/paystack/verify', authenticateUser, verifyPaystackPayment);
paymentRouter.get('/digital-products/:productId', authenticateUser, getMyDigitalProductPayments);
paymentRouter.get('/digital-products/:productId/download/:fileType/:documentIndex', authenticateUser, downloadPurchasedDigitalProductFile);
paymentRouter.post('/digital-products/:productId/download/:fileType/:documentIndex', authenticateUser, downloadPurchasedDigitalProductFile);

export default paymentRouter;
