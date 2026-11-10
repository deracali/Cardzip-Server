import express from 'express';
import { requireAdministrator, authenticateAdmin } from '../middleware/authenticateAdmin.js';
import {
  getWhatsAppInbox,
  receiveWhatsAppWebhook,
  verifyWhatsAppWebhook,
} from '../controller/whatsAppController.js';

const whatsAppRouter = express.Router();

whatsAppRouter.get('/webhook', verifyWhatsAppWebhook);
whatsAppRouter.post('/webhook', receiveWhatsAppWebhook);
whatsAppRouter.get('/inbox', authenticateAdmin, requireAdministrator, getWhatsAppInbox);

export default whatsAppRouter;
