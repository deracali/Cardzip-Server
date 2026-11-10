import axios from 'axios';
import TelegramBot from 'node-telegram-bot-api';
import { randomUUID } from 'node:crypto';
import redisClient, { isRedisConfigured, isRedisReady } from './controller/redisClient.js';
import { getTelegramServiceCredential } from './utils/telegramServiceAuth.js';

const apiBaseUrl = (process.env.CARDZIP_API_BASE_URL || 'http://localhost:5000/api').replace(/\/+$/, '');
const serviceCredential = getTelegramServiceCredential();
const instanceId = randomUUID();
const sessionKey = (chatId) => `cardzip:telegram:session:${chatId}`;
const handledKey = (chatId, messageId) => `cardzip:telegram:message:${chatId}:${messageId}`;
const telegramHeaders = { 'x-telegram-bot-secret': serviceCredential };
const localSessions = new Map();
const chatQueues = new Map();
let bot;
let lockTimer;
let pollingErrorLogged = false;
let lastTransientPollingWarningAt = 0;
let lastCommandMenuWarningAt = 0;

const billCategories = {
  '1': 'Airtime',
  '2': 'Data',
  '3': 'Electricity',
  '4': 'Pay TV',
  '5': 'WAEC PINs',
  '6': 'JAMB PINs',
};
const billServices = {
  Airtime: ['mtn', 'airtel', 'glo', '9mobile'],
  Data: ['mtn-data', 'airtel-data', 'glo-data', 'etisalat-data'],
  Electricity: ['ikeja-electric', 'eko-electric', 'abuja-electric', 'ibadan-electric', 'enugu-electric', 'kaduna-electric', 'jos-electric', 'benin-electric', 'kano-electric', 'portharcourt-electric', 'aba-electric', 'yola-electric'],
  'Pay TV': ['dstv', 'gotv', 'startimes'],
  'WAEC PINs': ['waec'],
  'JAMB PINs': ['jamb'],
};
const providerLabel = (serviceID) => serviceID.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
const telegramCommands = [
  { command: 'start', description: 'Get started with Cardzip' },
  { command: 'help', description: 'See how to use the bot' },
  { command: 'link', description: 'Link your Cardzip account' },
  { command: 'signup', description: 'Create a Cardzip account' },
  { command: 'trade', description: 'Submit a gift card for review' },
  { command: 'bill', description: 'Buy airtime or pay a bill' },
  { command: 'rates', description: 'View gift-card rates' },
  { command: 'cancel', description: 'Cancel the current request' },
];
const callBackend = (method, path, body, params) => axios({
  method,
  url: `${apiBaseUrl}${path}`,
  ...(body ? { data: body } : {}),
  ...(params ? { params } : {}),
  headers: telegramHeaders,
  timeout: 45000,
});
const isTransientPollingError = (error) => {
  let currentError = error;
  for (let depth = 0; currentError && depth < 4; depth += 1) {
    if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED/i.test(
      `${currentError.code || ''} ${currentError.message || ''}`,
    )) return true;
    currentError = currentError.cause;
  }
  return false;
};

const logTelegramConnectionWarning = (message, error, lastLoggedAt) => {
  const now = Date.now();
  if (now - lastLoggedAt() < 60_000) return;
  lastLoggedAt(now);
  console.warn(message, error.message);
};

const getSession = async (chatId) => {
  const cached = await redisClient.get(sessionKey(chatId));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {
      await redisClient.del(sessionKey(chatId));
    }
  }
  return localSessions.get(chatId) || null;
};

const saveSession = async (chatId, session) => {
  localSessions.set(chatId, session);
  await redisClient.set(sessionKey(chatId), JSON.stringify(session), { EX: 60 * 60 * 4 });
};

const clearSession = async (chatId) => {
  localSessions.delete(chatId);
  await redisClient.del(sessionKey(chatId));
};

const requestCardCatalog = async () => {
  const { data } = await axios.get(`${apiBaseUrl}/cards/get`, { timeout: 15000 });
  return Array.isArray(data?.data) ? data.data : [];
};

const getLinkedAccount = async (chatId) => {
  try {
    const { data } = await callBackend('GET', '/telegram/account', undefined, { chatId });
    return data.data;
  } catch (error) {
    if (error.response?.status === 404) return null;
    throw error;
  }
};

const requestSignupCode = async (chatId, session, name, email) => {
  await callBackend('POST', '/telegram/signup/request-code', { chatId, name, email });
  session.step = 'signupCode';
  session.data.name = name;
  session.data.email = email;
  await saveSession(chatId, session);
  await bot.sendMessage(chatId, 'If you can access this email, a six-digit code has been sent. Enter it here within 10 minutes.');
};

const requireLinkedAccount = async (chatId) => {
  const account = await getLinkedAccount(chatId);
  if (!account) {
    await bot.sendMessage(chatId, 'Connect an account first: type /link if you already have a Cardzip account, or /signup if you are new. We will send a one-time code to your email. Never send a password in Telegram.');
    return null;
  }
  return account;
};

const showCards = async (chatId, greeting = 'Choose a gift card to trade:') => {
  if (!(await requireLinkedAccount(chatId))) return;
  const cards = await requestCardCatalog();
  if (!cards.length) {
    await bot.sendMessage(chatId, 'There are no gift cards available right now. Please try again later.\n\nFor help, type /help. To pay a bill, type /bill.');
    return;
  }
  const available = cards.slice(0, 50);
  await saveSession(chatId, { step: 'card', data: { cards: available } });
  await bot.sendMessage(chatId, `${greeting}\n\n${available.map((card, index) => `${index + 1}. ${card.name}`).join('\n')}\n\nReply with a number or card name. Type /cancel to stop.\n\nOther services: /bill for airtime and bill payments, /help for instructions.`);
};

const selectCard = async (chatId, session, value) => {
  const cards = session.data.cards || await requestCardCatalog();
  const index = /^\d+$/.test(value) ? Number(value) - 1 : -1;
  const card = index >= 0
    ? cards[index]
    : cards.find((entry) => String(entry.name).toLowerCase() === value.toLowerCase());
  if (!card) {
    await bot.sendMessage(chatId, 'I could not match that card. Reply with a listed number or exact card name.');
    return;
  }
  const options = Array.isArray(card.types) ? card.types : [];
  if (!options.length) {
    await bot.sendMessage(chatId, 'That gift card has no available trade options. Choose another card.');
    return showCards(chatId);
  }
  session.data.card = card;
  session.data.options = options;
  session.step = 'option';
  const list = options.map((option, i) => {
    const label = [option.country, option.currency, option.type].filter(Boolean).join(' · ');
    return `${i + 1}. ${label || 'General'} — ₦${Number(option.rate || option.exchangeRate || 0).toLocaleString()}`;
  }).join('\n');
  await saveSession(chatId, session);
  await bot.sendMessage(chatId, `Available options for ${card.name}:\n\n${list}\n\nReply with an option number.`);
};

const selectOption = async (chatId, session, value) => {
  const options = session.data.options || [];
  const option = /^\d+$/.test(value) ? options[Number(value) - 1] : null;
  if (!option) {
    await bot.sendMessage(chatId, `Choose an option number between 1 and ${options.length}.`);
    return;
  }
  session.data.option = option;
  session.step = 'amount';
  await saveSession(chatId, session);
  await bot.sendMessage(chatId, `Enter the gift card amount in ${option.currency || 'the selected currency'}:`);
};

const submitTrade = async (chatId, session) => {
  if (!serviceSecret) throw new Error('Telegram backend submission is not configured.');
  const { card, option, amount, imageFileId, bankName, accountName, accountNumber } = session.data;
  const result = await callBackend('POST', '/gift-cards/telegram-submit', {
    submissionId: `${chatId}:${session.data.submissionId}`,
    chatId,
    catalogCardId: card._id,
    cardName: card.name,
    currency: option.currency || 'USD',
    region: option.country || '',
    cardType: option.type || '',
    amount,
    exchangeRate: Number(option.rate || option.exchangeRate),
    bankName,
    accountName,
    accountNumber,
    imageFileId,
  });
  await clearSession(chatId);
  await bot.sendMessage(chatId, `Your ${card.name} gift card trade was submitted successfully. The Cardzip team will review it.`);
  return result.data;
};

const showBillCategories = async (chatId) => {
  const account = await requireLinkedAccount(chatId);
  if (!account) return;
  await saveSession(chatId, { step: 'billCategory', data: {} });
  await bot.sendMessage(chatId, `Bill payment guide\n\nChoose a service:\n1. Airtime\n2. Data\n3. Electricity\n4. Pay TV\n5. WAEC PIN\n6. JAMB PIN\n\nReply with the number. You will review the details, tap Pay with Paystack, then Cardzip will process the bill after Paystack confirms payment. Type /cancel to stop.`);
};

const billServicePrompt = async (chatId, session) => {
  const services = billServices[session.data.category] || [];
  session.step = 'billService';
  session.data.services = services;
  await saveSession(chatId, session);
  await bot.sendMessage(chatId, `Choose a ${session.data.category} provider:\n${services.map((service, index) => `${index + 1}. ${providerLabel(service)}`).join('\n')}\n\nReply with a number.`);
};

const loadBillPlans = async (chatId, session) => {
  const { data } = await callBackend('GET', '/telegram/bills/options', undefined, {
    chatId,
    category: session.data.category,
    serviceID: session.data.serviceID,
  });
  const plans = Array.isArray(data.data) ? data.data : [];
  if (!plans.length) {
    await bot.sendMessage(chatId, 'No bill packages are available for that provider right now. Type /bill to start again later.');
    await clearSession(chatId);
    return;
  }
  session.data.plans = plans.slice(0, 30);
  session.step = 'billPlan';
  await saveSession(chatId, session);
  await bot.sendMessage(chatId, `Available ${session.data.category} packages:\n${session.data.plans.map((plan, index) => `${index + 1}. ${plan.name || plan.code} — ₦${plan.amount.toLocaleString('en-NG')}`).join('\n')}\n\nReply with a package number.`);
};

const askBillAccount = async (chatId, session) => {
  if (session.data.category === 'Airtime' || session.data.category === 'Data' || session.data.category === 'WAEC PINs') {
    session.step = 'billPhone';
    await saveSession(chatId, session);
    return bot.sendMessage(chatId, 'Enter the phone number that should receive this purchase (10–15 digits):');
  }
  session.step = 'billAccount';
  await saveSession(chatId, session);
  const label = session.data.category === 'Electricity'
    ? 'meter number'
    : session.data.category === 'Pay TV'
      ? 'smartcard number'
      : 'JAMB profile ID';
  return bot.sendMessage(chatId, `Enter the ${label}:`);
};

const startBillCheckout = async (chatId, session) => {
  const bill = {
    ...session.data.bill,
    category: session.data.category,
    serviceID: session.data.serviceID,
    serviceName: providerLabel(session.data.serviceID),
  };
  const { data } = await callBackend('POST', '/telegram/bills/initialize', { chatId, bill });
  await clearSession(chatId);
  await bot.sendMessage(
    chatId,
    `Paystack checkout is ready for ${data.data.serviceName}${data.data.packageName ? ` — ${data.data.packageName}` : ''}, ₦${Number(data.data.amount).toLocaleString('en-NG')}.\n\nTap Pay with Paystack below. Cardzip processes the bill only after Paystack confirms payment. You will receive a status message; if the provider is still processing, check Bill History in Cardzip for updates.`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: 'Pay with Paystack', url: data.data.authorizationUrl }]],
      },
    },
  );
};

const handleBillStep = async (chatId, session, text) => {
  if (session.step === 'billCategory') {
    const category = billCategories[text] || Object.values(billCategories).find((item) => item.toLowerCase() === text.toLowerCase());
    if (!category) {
      await bot.sendMessage(chatId, 'Reply with a category number from 1 to 6, or type /cancel.');
      return;
    }
    session.data.category = category;
    return billServicePrompt(chatId, session);
  }
  if (session.step === 'billService') {
    const services = session.data.services || [];
    const serviceID = /^\d+$/.test(text)
      ? services[Number(text) - 1]
      : services.find((item) => item === text.toLowerCase());
    if (!serviceID) {
      await bot.sendMessage(chatId, `Reply with a provider number from 1 to ${services.length}.`);
      return;
    }
    session.data.serviceID = serviceID;
    if (['Data', 'Pay TV', 'WAEC PINs', 'JAMB PINs'].includes(session.data.category)) {
      return loadBillPlans(chatId, session);
    }
    if (session.data.category === 'Electricity') {
      session.step = 'billMeterType';
      await saveSession(chatId, session);
      await bot.sendMessage(chatId, 'Choose meter type: reply PREPAID or POSTPAID.');
      return;
    }
    session.step = 'billAmount';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, 'Enter the airtime amount in naira (minimum ₦50):');
    return;
  }
  if (session.step === 'billPlan') {
    const plans = session.data.plans || [];
    const plan = /^\d+$/.test(text) ? plans[Number(text) - 1] : plans.find((item) => item.code === text);
    if (!plan) {
      await bot.sendMessage(chatId, `Reply with a package number from 1 to ${plans.length}.`);
      return;
    }
    session.data.bill = {
      variation_code: plan.code,
      amount: plan.amount,
      quantity: 1,
    };
    session.data.planName = plan.name || plan.code;
    if (session.data.category === 'WAEC PINs') {
      session.step = 'billQuantity';
      await saveSession(chatId, session);
      return bot.sendMessage(chatId, 'How many WAEC PINs? Reply with a number from 1 to 5.');
    }
    return askBillAccount(chatId, session);
  }
  if (session.step === 'billMeterType') {
    const type = text.toLowerCase();
    if (!['prepaid', 'postpaid'].includes(type)) {
      await bot.sendMessage(chatId, 'Reply PREPAID or POSTPAID.');
      return;
    }
    session.data.bill = { variation_code: type };
    return askBillAccount(chatId, session);
  }
  if (session.step === 'billQuantity') {
    const quantity = Number(text);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 5) {
      await bot.sendMessage(chatId, 'Enter a whole number from 1 to 5.');
      return;
    }
    session.data.bill.quantity = quantity;
    session.data.bill.amount *= quantity;
    return askBillAccount(chatId, session);
  }
  if (session.step === 'billAmount') {
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isSafeInteger(amount) || amount < 50) {
      await bot.sendMessage(chatId, 'Enter a whole-number airtime amount of at least ₦50.');
      return;
    }
    session.data.bill = { amount };
    session.step = 'billPhone';
    await saveSession(chatId, session);
    return bot.sendMessage(chatId, 'Enter the phone number that should receive the airtime (10–15 digits):');
  }
  if (session.step === 'billAccount') {
    if (text.length < 3 || text.length > 40) {
      await bot.sendMessage(chatId, 'Enter a valid account, meter, smartcard, or profile number.');
      return;
    }
    session.data.bill.billersCode = text;
    session.step = 'billPhone';
    await saveSession(chatId, session);
    return bot.sendMessage(chatId, 'Enter the contact phone number (10–15 digits):');
  }
  if (session.step === 'billPhone') {
    const phone = text.replace(/\D/g, '');
    if (phone.length < 10 || phone.length > 15) {
      await bot.sendMessage(chatId, 'Enter a valid phone number containing 10 to 15 digits.');
      return;
    }
    session.data.bill.phone = phone;
    if (['Airtime', 'Data', 'WAEC PINs'].includes(session.data.category)) {
      session.data.bill.billersCode = phone;
    }
    session.step = 'billConfirm';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, `Review your bill:\nService: ${providerLabel(session.data.serviceID)}\n${session.data.planName ? `Package: ${session.data.planName}\n` : ''}Account/phone: ${session.data.bill.billersCode}\nAmount: ₦${Number(session.data.bill.amount).toLocaleString('en-NG')}\n\nType PAY to open secure Paystack checkout, or /cancel to stop.`);
    return;
  }
  if (session.step === 'billConfirm') {
    if (!['pay', 'yes', 'confirm'].includes(text.toLowerCase())) {
      await bot.sendMessage(chatId, 'To continue, type PAY. To stop, type /cancel.');
      return;
    }
    return startBillCheckout(chatId, session);
  }
};

const handleMessage = async (message) => {
  if (!message.chat?.id || message.from?.is_bot) return;
  const chatId = String(message.chat.id);
  if (message.chat.type !== 'private') {
    await bot.sendMessage(chatId, 'For your privacy, please message Cardzip directly instead of submitting gift-card or bank details in a group.');
    return;
  }
  const messageId = String(message.message_id);
  if (!(await redisClient.setIfAbsent(handledKey(chatId, messageId), '1', 86400))) return;

  const text = String(message.text || '').trim();
  const normalized = text.toLowerCase();
  if (normalized === '/signup' || normalized === 'signup') {
    await clearSession(chatId);
    if (await getLinkedAccount(chatId)) {
      await bot.sendMessage(chatId, 'Your Telegram account is already connected to Cardzip. Type /trade to trade a gift card or /bill to pay a bill.');
      return;
    }
    await saveSession(chatId, { step: 'signupName', data: {} });
    await bot.sendMessage(chatId, 'Create or connect your Cardzip account:\n\nSend your name and email together in one message (for example: Jane Doe, jane@example.com), or send your name first and your email when I ask. Then enter the six-digit code we email you.\n\nIf the email already belongs to Cardzip, we will connect that account instead of creating a duplicate. No password is needed in Telegram.');
    return;
  }
  if (normalized === '/link' || normalized === 'link') {
    await clearSession(chatId);
    await saveSession(chatId, { step: 'linkEmail', data: {} });
    await bot.sendMessage(chatId, 'Link your Cardzip account securely:\n1. Enter the email address registered to your Cardzip account.\n2. Type the six-digit code sent to that email.\n\nThe code expires in 10 minutes. Cardzip never asks for your password here. If you do not have a Cardzip account yet, type /signup to create one.');
    return;
  }
  if (normalized === '/bill' || normalized === 'bill') {
    await showBillCategories(chatId);
    return;
  }
  if (normalized === '/start' || normalized === '/trade' || normalized === 'trade' || normalized === 'start over') {
    await clearSession(chatId);
    if (normalized === '/start') {
      await bot.sendMessage(chatId, 'Welcome to Cardzip!\n\nAlready have an account? Type /link. New here? Type /signup and follow the prompts to register or connect an account using your email and a one-time code.\n\nGift cards: type /trade, choose a card and option, enter its value, then send a clear card photo.\nBills: type /bill, follow the prompts, then type PAY and tap Pay with Paystack.\n\nType /help for the full guide or use the command menu.');
    }
    await showCards(chatId, 'Welcome to Cardzip gift-card trading. Choose a card:');
    return;
  }
  if (normalized === '/cancel') {
    await clearSession(chatId);
    await bot.sendMessage(chatId, 'Trade cancelled. Type /trade whenever you are ready.');
    return;
  }
  if (normalized === '/help' || normalized === 'help') {
    await bot.sendMessage(chatId, 'Cardzip Telegram guide:\n\n/signup — create an account or connect an existing account with your name, email, and a one-time email code. Never enter your password in Telegram.\n/link — connect an account you already have.\n/trade — choose a gift card, option, amount, upload a clear photo, and confirm payout details. The request is sent to Cardzip for review.\n/bill — choose airtime, data, electricity, TV, WAEC, or JAMB; enter the requested details; type PAY; then tap the Paystack button. Cardzip processes the bill only after Paystack confirms payment.\n/rates — view gift-card rates.\n/cancel — stop the current flow.\n\nA new Telegram account uses the same account in the Cardzip app and website. Use Forgot Password there to set your first password. If your email already had a Cardzip account, keep using its existing password.');
    return;
  }
  if (normalized === '/rates' || normalized === 'rates') {
    const cards = await requestCardCatalog();
    const list = cards.slice(0, 30).map((card) => {
      const rates = (card.types || []).map((option) =>
        `${option.country || option.currency || 'Option'}: ₦${Number(option.rate || option.exchangeRate || 0).toLocaleString()}`,
      ).join('\n');
      return `${card.name}\n${rates}`;
    }).join('\n\n');
    await bot.sendMessage(chatId, list || 'No gift-card rates are available right now.');
    return;
  }

  const session = await getSession(chatId);
  if (!session) {
    await showCards(chatId, 'Type /trade to submit a gift card.');
    return;
  }
  if (session.step === 'signupName') {
    const emailMatch = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
    if (emailMatch) {
      const email = emailMatch[0].toLowerCase();
      const name = text.replace(emailMatch[0], ' ').replace(/[,\s]+/g, ' ').trim();
      if (name.length < 2 || name.length > 80) {
        await bot.sendMessage(chatId, 'Send both your name and a valid email address (for example: Jane Doe, jane@example.com), or enter your name first and email when I ask.');
        return;
      }
      try {
        await requestSignupCode(chatId, session, name, email);
      } catch (error) {
        await bot.sendMessage(chatId, error.response?.data?.message || 'Could not request a verification code. Try again later.');
      }
      return;
    }
    const name = text.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 80) {
      await bot.sendMessage(chatId, 'Enter a name between 2 and 80 characters.');
      return;
    }
    session.data.name = name;
    session.step = 'signupEmail';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, 'Now enter the email address you want to use for Cardzip. We will send a verification code to this address.');
    return;
  }
  if (session.step === 'signupEmail') {
    const email = text.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await bot.sendMessage(chatId, 'Enter just a valid email address, such as jane@example.com.');
      return;
    }
    try {
      await requestSignupCode(chatId, session, session.data.name, email);
    } catch (error) {
      await bot.sendMessage(chatId, error.response?.data?.message || 'Could not request a verification code. Try again later.');
    }
    return;
  }
  if (session.step === 'signupCode') {
    if (!/^\d{6}$/.test(text)) {
      await bot.sendMessage(chatId, 'Enter the six-digit code from your latest email. If you are new to Cardzip, type /signup to create an account; if you already have an account, use /link.');
      return;
    }
    try {
      const { data } = await callBackend('POST', '/telegram/signup/verify-code', {
        chatId,
        email: session.data.email,
        code: text,
      });
      await clearSession(chatId);
      const accountMessage = data.data?.existingAccount
        ? 'Your existing Cardzip account is now connected. Sign into the app or website with its existing password; if you have forgotten it, use Forgot Password.'
        : 'Your Cardzip account is ready and connected. To sign in on the app or website, choose Forgot Password for this email to set your password.';
      await bot.sendMessage(chatId, `All set${data.data?.name ? `, ${data.data.name}` : ''}! ${accountMessage}\n\nType /trade to submit a gift card or /bill to pay a bill.`);
    } catch (error) {
      await bot.sendMessage(chatId, error.response?.data?.message || 'That code could not be verified. Check the latest email and try again. If you are new, type /signup to create an account; if you already have an account, type /link.');
    }
    return;
  }
  if (session.step === 'linkEmail') {
    const email = text.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await bot.sendMessage(chatId, 'Enter the valid email address registered to your Cardzip account.');
      return;
    }
    try {
      await callBackend('POST', '/telegram/link/request-code', { chatId, email });
      session.step = 'linkCode';
      session.data.email = email;
      await saveSession(chatId, session);
      await bot.sendMessage(chatId, 'If this email is registered and can be linked, a six-digit code has been sent. Enter that code here. It expires in 10 minutes.');
    } catch (error) {
      await bot.sendMessage(chatId, error.response?.data?.message || 'Could not request a verification code. Try again later.');
    }
    return;
  }
  if (session.step === 'linkCode') {
    if (!/^\d{6}$/.test(text)) {
      await bot.sendMessage(chatId, 'Enter the six-digit code from your latest email. If you do not have a Cardzip account yet, type /signup to create one.');
      return;
    }
    try {
      const { data } = await callBackend('POST', '/telegram/link/verify-code', {
        chatId,
        email: session.data.email,
        code: text,
      });
      await clearSession(chatId);
      await bot.sendMessage(chatId, `Cardzip account linked successfully${data.data?.name ? `, ${data.data.name}` : ''}. Your Telegram gift-card trades and bill purchases will now be attached to this account.`);
    } catch (error) {
      await bot.sendMessage(chatId, error.response?.data?.message || 'That code could not be verified. Check the latest email and try again. If you already have a Cardzip account, type /link; if you are new, type /signup to create one.');
    }
    return;
  }
  if (session.step.startsWith('bill')) {
    if (!text) {
      await bot.sendMessage(chatId, 'Please reply with the requested bill details, or type /cancel.');
      return;
    }
    try {
      await handleBillStep(chatId, session, text);
    } catch (error) {
      console.error('Telegram bill flow error:', error.response?.data?.message || error.message);
      await bot.sendMessage(chatId, error.response?.data?.message || 'Could not continue the bill request. Type /bill to restart.');
    }
    return;
  }
  if (session.step === 'image') {
    const photo = message.photo?.at(-1);
    if (!photo) {
      await bot.sendMessage(chatId, 'Please send a clear photo of the gift card, or type /cancel.');
      return;
    }
    session.data.imageFileId = photo.file_id;
    const account = await getLinkedAccount(chatId);
    if (account?.bankName && account?.accountName && account?.accountNumber) {
      session.data.bankName = account.bankName;
      session.data.accountName = account.accountName;
      session.data.accountNumber = account.accountNumber;
      await saveSession(chatId, session);
      try {
        await submitTrade(chatId, session);
      } catch (error) {
        console.error('Telegram gift-card submission failed:', error.response?.data?.message || error.message);
        await bot.sendMessage(chatId, 'I could not submit the trade right now. Your image and details are saved; type /trade to retry or contact Cardzip support.');
      }
      return;
    }
    session.step = 'bank';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, 'Enter the bank name for your payout. You can save your bank details to your Cardzip account so future trades can use them automatically:');
    return;
  }
  if (!text) {
    await bot.sendMessage(chatId, 'Please reply with text for this step, or send the requested image.');
    return;
  }

  if (session.step === 'card') return selectCard(chatId, session, text);
  if (session.step === 'option') return selectOption(chatId, session, text);
  if (session.step === 'amount') {
    const amount = Number(text.replace(/,/g, ''));
    const rate = Number(session.data.option?.rate || session.data.option?.exchangeRate);
    if (!Number.isFinite(amount) || amount < 1 || !Number.isFinite(rate) || rate <= 0) {
      await bot.sendMessage(chatId, 'Enter a valid amount of at least 1.');
      return;
    }
    session.data.amount = amount;
    session.data.submissionId = randomUUID();
    session.step = 'image';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, `Estimated payout: ₦${(amount * rate).toLocaleString()}. Send a clear photo of the gift card:`);
    return;
  }
  if (session.step === 'bank') {
    session.data.bankName = text.slice(0, 100);
    session.step = 'accountName';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, 'Enter the account holder name:');
    return;
  }
  if (session.step === 'accountName') {
    session.data.accountName = text.slice(0, 100);
    session.step = 'accountNumber';
    await saveSession(chatId, session);
    await bot.sendMessage(chatId, 'Enter the bank account number:');
    return;
  }
  if (session.step === 'accountNumber') {
    const accountNumber = text.replace(/\s/g, '');
    if (!/^\d{8,20}$/.test(accountNumber)) {
      await bot.sendMessage(chatId, 'Enter a valid account number (8–20 digits).');
      return;
    }
    session.data.accountNumber = accountNumber;
    await saveSession(chatId, session);
    try {
      await submitTrade(chatId, session);
    } catch (error) {
      console.error('Telegram gift-card submission failed:', error.response?.data?.message || error.message);
      await bot.sendMessage(chatId, 'I could not submit the trade right now. Your details are saved; please retry by sending the account number again or contact Cardzip support.');
    }
  }
};

const enqueueMessage = (message) => {
  const key = String(message.chat?.id || 'unknown');
  const previous = chatQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => handleMessage(message))
    .catch((error) => {
      console.error('Telegram message processing failed:', error.response?.data?.message || error.message);
      return bot?.sendMessage(key, 'Something went wrong. Please try again or type /trade to restart.')
        .catch((sendError) => {
          console.error('Could not send Telegram error reply:', sendError.message);
        });
    });
  chatQueues.set(key, next);
  void next.finally(() => {
    if (chatQueues.get(key) === next) chatQueues.delete(key);
  }).catch(() => undefined);
};

const startPolling = async (token) => {
  if (bot || (isRedisConfigured && !isRedisReady())) return;
  const ownsLock = await redisClient.setIfAbsent('cardzip:telegram:polling-lock', instanceId, 90);
  if (!ownsLock) return;

  const activeBot = new TelegramBot(token, {
    polling: {
      autoStart: false,
      interval: 5000,
      params: { timeout: 30 },
    },
    request: { timeout: 45000 },
  });
  bot = activeBot;
  activeBot.on('message', enqueueMessage);
  activeBot.on('polling_error', (error) => {
    if (bot !== activeBot) return;
    if (isTransientPollingError(error)) {
      logTelegramConnectionWarning(
        'Telegram polling connection interrupted; the bot will retry automatically:',
        error,
        (value) => {
          if (value !== undefined) lastTransientPollingWarningAt = value;
          return lastTransientPollingWarningAt;
        },
      );
      return;
    }
    if (!pollingErrorLogged) {
      pollingErrorLogged = true;
      console.error('Telegram polling error:', error.message);
    }
    void activeBot.stopPolling().catch((stopError) => {
      console.warn('Could not stop Telegram polling cleanly:', stopError.message);
    }).finally(() => {
      if (bot === activeBot) {
        bot = null;
        void redisClient.releaseLock('cardzip:telegram:polling-lock', instanceId);
      }
    });
  });
  void activeBot.startPolling().catch((error) => {
    if (bot !== activeBot) return;
    console.error('Could not start Telegram polling:', error.message);
    bot = null;
    void redisClient.releaseLock('cardzip:telegram:polling-lock', instanceId);
  });
  void activeBot.setMyCommands(telegramCommands).catch((error) => {
    if (isTransientPollingError(error)) {
      logTelegramConnectionWarning(
        'Could not register Telegram command menu; polling will continue:',
        error,
        (value) => {
          if (value !== undefined) lastCommandMenuWarningAt = value;
          return lastCommandMenuWarningAt;
        },
      );
      return;
    }
    console.error('Could not register Telegram command menu:', error.message);
  });
};

export const startTelegramBot = async () => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (process.env.TELEGRAM_BOT_MODE === 'disabled') return;
  if (!token) {
    console.warn('Telegram bot is disabled because TELEGRAM_BOT_TOKEN is not configured.');
    return;
  }
  if (bot) return;
  if (!lockTimer) {
    lockTimer = setInterval(async () => {
      try {
        if (bot) {
          const extended = await redisClient.extendLock('cardzip:telegram:polling-lock', instanceId, 90);
          if (!extended) {
            const currentBot = bot;
            bot = null;
            await currentBot.stopPolling();
            console.warn('Telegram polling stopped because this instance no longer owns the polling lock.');
          }
        } else {
          await startPolling(token);
        }
      } catch (error) {
        console.warn('Telegram bot maintenance failed; the API server will continue running:', error.message);
      }
    }, 30000);
    lockTimer.unref?.();
  }
  await startPolling(token);
};
