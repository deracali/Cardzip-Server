import express from 'express';
import {
  getTelegramBillOptions,
  getTelegramLinkedAccount,
  initializeTelegramBillPayment,
  requestTelegramAccountLinkCode,
  requestTelegramSignupCode,
  verifyTelegramAccountLinkCode,
  verifyTelegramSignupCode,
} from '../controller/telegramController.js';

const telegramRouter = express.Router();

telegramRouter.post('/link/request-code', requestTelegramAccountLinkCode);
telegramRouter.post('/link/verify-code', verifyTelegramAccountLinkCode);
telegramRouter.post('/signup/request-code', requestTelegramSignupCode);
telegramRouter.post('/signup/verify-code', verifyTelegramSignupCode);
telegramRouter.get('/account', getTelegramLinkedAccount);
telegramRouter.get('/bills/options', getTelegramBillOptions);
telegramRouter.post('/bills/initialize', initializeTelegramBillPayment);

export default telegramRouter;
