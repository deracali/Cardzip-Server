import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const getEncryptionKey = () => {
  const keyHex = process.env.KYC_DOCUMENT_ENCRYPTION_KEY;
  if (!keyHex || !/^[\da-f]{64}$/i.test(keyHex)) {
    const error = new Error('KYC document encryption is not configured.');
    error.statusCode = 503;
    throw error;
  }
  return Buffer.from(keyHex, 'hex');
};

export const encryptKycDocumentNumber = (documentNumber) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(documentNumber, 'utf8'),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('hex')).join(':');
};

export const decryptKycDocumentNumber = (encryptedDocumentNumber) => {
  const [ivHex, authTagHex, encryptedHex] = encryptedDocumentNumber.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('The encrypted KYC document number is invalid.');
  }
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
};
