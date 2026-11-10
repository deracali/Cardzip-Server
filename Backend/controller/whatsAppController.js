import WhatsAppMessage from '../model/whatsAppMessageModel.js';
import { isValidWhatsAppSignature, storeWhatsAppWebhookMessages } from './whatsAppService.js';
import { createPaginationMetadata, parsePagination } from '../utils/pagination.js';

export const verifyWhatsAppWebhook = (req, res) => {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!verifyToken) return res.sendStatus(503);
  if (
    req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === verifyToken &&
    req.query['hub.challenge']
  ) {
    return res.status(200).type('text/plain').send(req.query['hub.challenge']);
  }
  return res.sendStatus(403);
};

export const receiveWhatsAppWebhook = async (req, res) => {
  if (!isValidWhatsAppSignature(req.rawBody, req.headers['x-hub-signature-256'])) {
    return res.status(401).json({ success: false, message: 'Invalid WhatsApp webhook signature.' });
  }
  try {
    await storeWhatsAppWebhookMessages(req.body);
    return res.sendStatus(200);
  } catch (error) {
    console.error('Could not persist WhatsApp webhook message:', error.message);
    return res.status(500).json({ success: false, message: 'Could not save the WhatsApp message.' });
  }
};

export const getWhatsAppInbox = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, 20, 50);
    const [messages, totalItems] = await Promise.all([
      WhatsAppMessage.find().sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
      WhatsAppMessage.countDocuments(),
    ]);
    return res.json({
      success: true,
      data: messages,
      pagination: createPaginationMetadata(totalItems, page, limit),
    });
  } catch (error) {
    console.error('Get WhatsApp inbox error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not load the WhatsApp inbox.' });
  }
};
