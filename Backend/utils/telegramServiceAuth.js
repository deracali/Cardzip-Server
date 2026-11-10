import { createHmac, timingSafeEqual } from 'node:crypto';

export const getTelegramServiceCredential = () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  return token
    ? createHmac('sha256', token).update('cardzip-telegram-backend-auth-v1').digest('hex')
    : '';
};

export const isAuthorizedTelegramService = (receivedCredential) => {
  const expected = getTelegramServiceCredential();
  const received = String(receivedCredential || '');
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
};
