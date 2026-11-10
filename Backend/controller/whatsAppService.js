import { createHmac, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';
import WhatsAppMessage from '../model/whatsAppMessageModel.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v22.0';
const graphBase = `https://graph.facebook.com/${apiVersion}`;
const getCloudApiConfig = () => ({
  token: process.env.WHATSAPP_ACCESS_TOKEN?.trim(),
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim(),
});

const normalizeWhatsAppNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) throw new Error('WhatsApp recipient number must be in international format.');
  return digits;
};

const sendWhatsAppMessage = async (recipient, payload) => {
  const { token, phoneNumberId } = getCloudApiConfig();
  if (!token || !phoneNumberId) throw new Error('WhatsApp Cloud API is not configured.');
  return axios.post(`${graphBase}/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeWhatsAppNumber(recipient),
    ...payload,
  }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
};

export const notifyGiftCardOnWhatsApp = async (giftCard) => {
  const recipient = process.env.WHATSAPP_GIFTCARD_RECIPIENT || '2349065705669';
  const templateName = process.env.WHATSAPP_GIFTCARD_TEMPLATE_NAME?.trim();
  const bodyParameters = [
    giftCard.type,
    `${giftCard.amount} ${giftCard.currency}`,
    `NGN ${Number(giftCard.ngnAmount || 0).toLocaleString('en-NG')}`,
    String(giftCard._id),
  ].map((text) => ({ type: 'text', text: String(text) }));
  const images = (giftCard.imageUrls || []).slice(0, 5);

  if (templateName && images.length) {
    for (const imageUrl of images) {
      await sendWhatsAppMessage(recipient, {
        type: 'template',
        template: {
          name: templateName,
          language: { code: process.env.WHATSAPP_GIFTCARD_TEMPLATE_LANGUAGE || 'en_US' },
          components: [
            { type: 'header', parameters: [{ type: 'image', image: { link: imageUrl } }] },
            { type: 'body', parameters: bodyParameters },
          ],
        },
      });
    }
    return;
  }

  const text = [
    'New Cardzip gift-card trade',
    `Card: ${giftCard.type}`,
    `Amount: ${giftCard.amount} ${giftCard.currency}`,
    `Estimated payout: NGN ${Number(giftCard.ngnAmount || 0).toLocaleString('en-NG')}`,
    `Trade ID: ${giftCard._id}`,
  ].join('\n');
  await sendWhatsAppMessage(recipient, { type: 'text', text: { body: text } });
  for (const imageUrl of images) {
    await sendWhatsAppMessage(recipient, { type: 'image', image: { link: imageUrl } });
  }
};

export const isValidWhatsAppSignature = (rawBody, signature) => {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || !Buffer.isBuffer(rawBody) || !signature) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
};

const uploadWhatsAppMedia = async (media) => {
  const { token } = getCloudApiConfig();
  if (!token) throw new Error('WhatsApp Cloud API is not configured.');
  const metadata = await axios.get(`${graphBase}/${encodeURIComponent(media.id)}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
  const file = await axios.get(metadata.data.url, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 10 * 1024 * 1024,
  });
  const contentType = media.mime_type || file.headers['content-type'] || 'application/octet-stream';
  const dataUri = `data:${contentType};base64,${Buffer.from(file.data).toString('base64')}`;
  const upload = await cloudinary.uploader.upload(dataUri, {
    folder: 'cardzip/whatsapp-inbox',
    resource_type: 'image',
  });
  return upload.secure_url;
};

const collectMedia = (message) => {
  const result = [];
  const image = message.image;
  if (image?.id) {
    result.push({
      providerMediaId: String(image.id),
      mimeType: String(image.mime_type || ''),
      sha256: String(image.sha256 || ''),
      filename: '',
    });
  }
  return result;
};

export const storeWhatsAppWebhookMessages = async (payload) => {
  const contacts = new Map();
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const contact of change.value?.contacts || []) {
        contacts.set(String(contact.wa_id), String(contact.profile?.name || ''));
      }
      for (const message of change.value?.messages || []) {
        const content = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '';
        const media = collectMedia(message);
        try {
          const record = await WhatsAppMessage.create({
            providerMessageId: message.id,
            waId: String(message.from || ''),
            senderName: contacts.get(String(message.from || '')) || '',
            type: String(message.type || 'unknown'),
            text: String(content),
            media,
            timestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
          });
          for (const item of media) {
            void uploadWhatsAppMedia({ id: item.providerMediaId, mime_type: item.mimeType })
              .then((url) => WhatsAppMessage.updateOne(
                { _id: record._id, 'media.providerMediaId': item.providerMediaId },
                { $set: { 'media.$.url': url, 'media.$.status': 'stored' } },
              ))
              .catch((error) => {
                console.error('Could not store incoming WhatsApp media:', error.response?.data?.error?.message || error.message);
                return WhatsAppMessage.updateOne(
                  { _id: record._id, 'media.providerMediaId': item.providerMediaId },
                  { $set: { 'media.$.status': 'failed' } },
                );
              });
          }
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
    }
  }
};
