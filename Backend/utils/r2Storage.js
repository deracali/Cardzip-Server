import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const R2_URI_PREFIX = 'r2://';
const R2_KEY_PREFIX = 'cardzip/product-files/';
let client;

export const isR2StorageConfigured = () => Boolean(
  process.env.R2_ACCOUNT_ID?.trim()
  && process.env.R2_ACCESS_KEY_ID?.trim()
  && process.env.R2_SECRET_ACCESS_KEY?.trim()
  && process.env.R2_BUCKET_NAME?.trim(),
);

const getR2Configuration = () => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    const error = new Error('Private R2 storage is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.');
    error.code = 'R2_STORAGE_NOT_CONFIGURED';
    throw error;
  }
  return { accountId, accessKeyId, secretAccessKey, bucketName };
};

const getR2Client = (configuration) => {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${configuration.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: configuration.accessKeyId,
        secretAccessKey: configuration.secretAccessKey,
      },
    });
  }
  return client;
};

export const getR2ObjectKey = (value) => {
  if (typeof value !== 'string' || !value.startsWith(R2_URI_PREFIX)) return null;
  const key = value.slice(R2_URI_PREFIX.length);
  return /^cardzip\/product-files\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,16})?$/i.test(key) ? key : null;
};

export const uploadProductFileToR2 = async (file, extension = '') => {
  const configuration = getR2Configuration();
  const key = `${R2_KEY_PREFIX}${randomUUID()}${extension}`;
  const body = file.tempFilePath ? createReadStream(file.tempFilePath) : file.data;
  if (!body) {
    const error = new Error('The uploaded file data is missing.');
    error.code = 'R2_UPLOAD_DATA_MISSING';
    throw error;
  }
  await getR2Client(configuration).send(new PutObjectCommand({
    Bucket: configuration.bucketName,
    Key: key,
    Body: body,
    ContentLength: file.size,
    ContentType: file.mimetype || 'application/octet-stream',
  }));
  return `${R2_URI_PREFIX}${key}`;
};

export const downloadProductFileFromR2 = async (storageUri) => {
  const key = getR2ObjectKey(storageUri);
  if (!key) {
    const error = new Error('The stored R2 file reference is invalid.');
    error.code = 'R2_INVALID_FILE_REFERENCE';
    throw error;
  }
  const configuration = getR2Configuration();
  const result = await getR2Client(configuration).send(new GetObjectCommand({
    Bucket: configuration.bucketName,
    Key: key,
  }));
  if (!result.Body) {
    const error = new Error('R2 returned an empty file body.');
    error.code = 'R2_EMPTY_FILE_BODY';
    throw error;
  }
  return {
    body: result.Body,
    contentLength: result.ContentLength,
    contentType: result.ContentType,
  };
};
