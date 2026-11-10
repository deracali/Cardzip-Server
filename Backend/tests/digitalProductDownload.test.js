import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { Readable, Writable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Payment from '../model/paymentModel.js';
import StoreProduct from '../model/storeProductModel.js';
import User from '../model/userModel.js';
import { downloadPurchasedDigitalProductFile, initializePaystackPayment } from '../controller/paymentController.js';
import {
  createSellerDigitalAsset,
  uploadDigitalAssetSourceCode,
  uploadStoreProductDocument,
  uploadStoreProductSourceCode,
} from '../controller/storeController.js';
import { uploadProductFileToR2 } from '../utils/r2Storage.js';

const originalFindOne = Payment.findOne;
const originalCreate = Payment.create;
const originalFindById = StoreProduct.findById;
const originalStoreCreate = StoreProduct.create;
const originalStoreExists = StoreProduct.exists;
const originalStoreFindOne = StoreProduct.findOne;
const originalUserFindById = User.findById;
const originalFetch = globalThis.fetch;
const originalCallbackUrls = process.env.PAYSTACK_CALLBACK_URLS;
const originalPaystackSecret = process.env.PAYSTACK_SECRET_KEY;
const originalCloudinaryName = process.env.CLOUDINARY_CLOUD_NAME;
const originalCloudinaryConfig = { ...cloudinary.config() };
const originalCloudinaryUpload = cloudinary.uploader.upload;
const originalS3Send = S3Client.prototype.send;
const originalR2Environment = {
  accountId: process.env.R2_ACCOUNT_ID,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  bucketName: process.env.R2_BUCKET_NAME,
};
const productId = '507f1f77bcf86cd799439011';
let fetchCalls;
let upstreamResponse;
let paidPurchaseType;
let paymentQueries;

class CapturedResponse extends Writable {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.payload = null;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  status(code) {
    this.statusCode = code;
    return this;
  }

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  attachment(filename) {
    this.headers['content-disposition'] = filename;
    return this;
  }

  json(payload) {
    this.payload = payload;
    this.end();
    return this;
  }
}

const makeRequest = async (reference = 'paid-reference', fileType = 'rental-source-code', documentIndex = '0') => {
  const response = new CapturedResponse();
  const finished = new Promise((resolve, reject) => {
    response.once('finish', resolve);
    response.once('error', reject);
  });
  await downloadPurchasedDigitalProductFile({
    params: { productId, fileType, documentIndex },
    body: { reference },
  }, response);
  await finished;
  return response;
};

beforeEach(() => {
  fetchCalls = [];
  paidPurchaseType = 'use';
  paymentQueries = [];
  upstreamResponse = async () => new Response('ZIP', { status: 200 });
  Payment.findOne = (query) => {
    paymentQueries.push(query);
    return {
      select() { return this; },
      lean: async () => query.reference === 'paid-reference'
        && query.$or.some((purchaseType) => (
          purchaseType['metadata.purchaseType'] === paidPurchaseType
          || purchaseType['metadata.purchaseType']?.$in?.includes(paidPurchaseType)
        ))
        ? { _id: 'payment-id' }
        : null,
    };
  };
  StoreProduct.findById = () => ({
    select() { return this; },
    lean: async () => ({
      name: 'Test Asset',
      sourceCodeUrl: 'https://res.cloudinary.com/test/raw/upload/v1/test.zip',
      templateSourceCodeUrl: '',
      sourceArchiveVersion: 2,
      documents: [{
        name: 'test.pdf',
        url: 'https://res.cloudinary.com/test/raw/upload/v1/test.pdf',
        mimeType: 'application/pdf',
      }],
      templateDocuments: [{
        name: 'template-terms.pdf',
        url: 'https://res.cloudinary.com/test/raw/upload/v1/template-terms.pdf',
        mimeType: 'application/pdf',
      }],
    }),
  });
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return upstreamResponse(url, options);
  };
});

afterEach(() => {
  Payment.findOne = originalFindOne;
  Payment.create = originalCreate;
  StoreProduct.findById = originalFindById;
  StoreProduct.create = originalStoreCreate;
  StoreProduct.exists = originalStoreExists;
  StoreProduct.findOne = originalStoreFindOne;
  User.findById = originalUserFindById;
  globalThis.fetch = originalFetch;
  if (originalCallbackUrls === undefined) delete process.env.PAYSTACK_CALLBACK_URLS;
  else process.env.PAYSTACK_CALLBACK_URLS = originalCallbackUrls;
  if (originalPaystackSecret === undefined) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = originalPaystackSecret;
  if (originalCloudinaryName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
  else process.env.CLOUDINARY_CLOUD_NAME = originalCloudinaryName;
  cloudinary.config(originalCloudinaryConfig);
  cloudinary.uploader.upload = originalCloudinaryUpload;
  S3Client.prototype.send = originalS3Send;
  for (const [key, environmentName] of Object.entries({
    accountId: 'R2_ACCOUNT_ID',
    accessKeyId: 'R2_ACCESS_KEY_ID',
    secretAccessKey: 'R2_SECRET_ACCESS_KEY',
    bucketName: 'R2_BUCKET_NAME',
  })) {
    if (originalR2Environment[key] === undefined) delete process.env[environmentName];
    else process.env[environmentName] = originalR2Environment[key];
  }
});

test('denies unpaid references without requesting the file host', async () => {
  const response = await makeRequest('invalid-reference');

  assert.equal(response.statusCode, 403);
  assert.equal(fetchCalls.length, 0);
});

test('follows Cloudinary redirects and streams the purchased archive', async () => {
  upstreamResponse = async (_url, _options) => {
    if (fetchCalls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: 'https://media.cloudinary.com/test.zip' },
      });
    }
    return new Response('ZIP', { status: 200 });
  };

  const response = await makeRequest();

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.concat(response.chunks).toString(), 'ZIP');
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls.every(({ options }) => options.redirect === 'manual'));
});

test('rejects redirects outside Cloudinary without fetching their destination', async () => {
  upstreamResponse = async () => new Response(null, {
    status: 302,
    headers: { location: 'https://example.com/test.zip' },
  });

  const response = await makeRequest();

  assert.equal(response.statusCode, 502);
  assert.equal(fetchCalls.length, 1);
});

test('reports the upstream HTTP status when Cloudinary denies the file', async () => {
  upstreamResponse = async () => new Response(null, { status: 401 });

  const response = await makeRequest();

  assert.equal(response.statusCode, 502);
  assert.match(response.payload.message, /HTTP 401/);
});

test('retries Cloudinary 401 responses with a signed delivery URL', async () => {
  process.env.CLOUDINARY_CLOUD_NAME = 'test';
  cloudinary.config({
    cloud_name: 'test',
    api_key: 'test-api-key',
    api_secret: 'test-api-secret',
  });
  upstreamResponse = async (url) => (
    String(url).includes('/s--')
      ? new Response('PDF', { status: 200 })
      : new Response('Unauthorized', { status: 401 })
  );

  const response = await makeRequest('paid-reference', 'document', '0');

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.concat(response.chunks).toString(), 'PDF');
  assert.equal(fetchCalls.length, 2);
  assert.match(fetchCalls[1].url, /\/raw\/upload\/s--[^/]+\/v1\/test\.pdf/);
});

test('uploads product files to a private R2 bucket', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  let uploadedCommand;
  S3Client.prototype.send = async (command) => {
    uploadedCommand = command;
    return {};
  };

  const uri = await uploadProductFileToR2({
    name: 'project.zip',
    mimetype: 'application/zip',
    size: 3,
    data: Buffer.from('ZIP'),
  }, '.zip');

  assert.match(uri, /^r2:\/\/cardzip\/product-files\/[a-f0-9-]{36}\.zip$/i);
  assert.ok(uploadedCommand instanceof PutObjectCommand);
  assert.equal(uploadedCommand.input.Bucket, 'private-products');
  assert.equal(uploadedCommand.input.ContentType, 'application/zip');
  assert.equal(uploadedCommand.input.Body.toString(), 'ZIP');
});

test('uploads product files to Cloudinary first and mirrors them to R2', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  const uploadOrder = [];
  cloudinary.uploader.upload = async (_source, options) => {
    uploadOrder.push('cloudinary');
    return {
      secure_url: `https://res.cloudinary.com/test/raw/upload/v1/${options.public_id}`,
    };
  };
  S3Client.prototype.send = async () => {
    uploadOrder.push('r2');
    return {};
  };

  const invoke = async (handler, fileField, file) => {
    const response = new CapturedResponse();
    await handler({ files: { [fileField]: file } }, response);
    return response;
  };
  const sourceArchive = await invoke(uploadStoreProductSourceCode, 'sourceCode', {
    name: 'project.zip',
    mimetype: 'application/zip',
    size: 3,
    data: Buffer.from('ZIP'),
  });
  const document = await invoke(uploadStoreProductDocument, 'document', {
    name: 'terms.pdf',
    mimetype: 'application/pdf',
    size: 3,
    data: Buffer.from('PDF'),
  });

  assert.equal(sourceArchive.statusCode, 201);
  assert.match(sourceArchive.payload.data.sourceCodeUrl, /^r2:\/\/cardzip\/product-files\/.+\.zip$/i);
  assert.match(sourceArchive.payload.data.sourceCodeCloudinaryUrl, /^https:\/\/res\.cloudinary\.com\/test\/raw\/upload\/v1\/.+\.zip$/i);
  assert.equal(document.statusCode, 201);
  assert.match(document.payload.data.document.url, /^r2:\/\/cardzip\/product-files\/.+\.pdf$/i);
  assert.match(document.payload.data.document.cloudinaryUrl, /^https:\/\/res\.cloudinary\.com\/test\/raw\/upload\/v1\/.+\.pdf$/i);
  assert.equal(document.payload.data.document.name, 'terms.pdf');
  assert.deepEqual(uploadOrder, ['cloudinary', 'r2', 'cloudinary', 'r2']);
});

test('keeps Cloudinary uploads available when the R2 mirror fails', async () => {
  cloudinary.uploader.upload = async () => ({
    secure_url: 'https://res.cloudinary.com/test/raw/upload/v1/project.zip',
  });
  S3Client.prototype.send = async () => {
    throw Object.assign(new Error('R2 unavailable'), { code: 'R2_UNAVAILABLE' });
  };
  const response = new CapturedResponse();
  await uploadStoreProductSourceCode({
    files: {
      sourceCode: {
        name: 'project.zip',
        mimetype: 'application/zip',
        size: 3,
        data: Buffer.from('ZIP'),
      },
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.data.sourceCodeUrl, 'https://res.cloudinary.com/test/raw/upload/v1/project.zip');
  assert.equal(response.payload.data.sourceCodeCloudinaryUrl, response.payload.data.sourceCodeUrl);
});

test('creates full-stack seller listings with separate rental/template assets and files', async () => {
  StoreProduct.exists = async () => null;
  StoreProduct.create = async (product) => product;
  const response = new CapturedResponse();
  await createSellerDigitalAsset({
    authUserId: 'seller-id',
    body: {
      name: 'Full Stack Listing',
      productType: 'full_stack',
      websiteUrl: 'https://example.com',
      category: 'software',
      description: 'A complete full-stack project.',
      sellerContact: 'seller@example.com',
      usePrice: 300,
      templatePrice: 1200,
      sourceCodeUrl: 'r2://cardzip/product-files/123e4567-e89b-12d3-a456-426614174000.zip',
      sourceCodeCloudinaryUrl: 'https://res.cloudinary.com/test/raw/upload/v1/rental.zip',
      templateSourceCodeUrl: 'r2://cardzip/product-files/223e4567-e89b-12d3-a456-426614174000.zip',
      templateSourceCodeCloudinaryUrl: 'https://res.cloudinary.com/test/raw/upload/v1/template.zip',
      documents: [{
        name: 'buyer-guide.pdf',
        url: 'r2://cardzip/product-files/323e4567-e89b-12d3-a456-426614174000.pdf',
        cloudinaryUrl: 'https://res.cloudinary.com/test/raw/upload/v1/buyer-guide.pdf',
        mimeType: 'application/pdf',
      }],
      templateDocuments: [{
        name: 'license.pdf',
        url: 'r2://cardzip/product-files/423e4567-e89b-12d3-a456-426614174000.pdf',
        cloudinaryUrl: 'https://res.cloudinary.com/test/raw/upload/v1/license.pdf',
        mimeType: 'application/pdf',
      }],
      screenshots: Array.from({ length: 10 }, (_, index) => `https://example.com/screenshot-${index}.jpg`),
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.data.productType, 'full_stack');
  assert.equal(response.payload.data.usePrice, 300);
  assert.equal(response.payload.data.templatePrice, 1200);
  assert.equal(response.payload.data.price, 300);
  assert.equal(response.payload.data.sourceCodeUrl, 'r2://cardzip/product-files/123e4567-e89b-12d3-a456-426614174000.zip');
  assert.equal(response.payload.data.templateDocuments[0].name, 'license.pdf');
});

test('uploads seller source archives through Cloudinary-first storage', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  cloudinary.uploader.upload = async (_source, options) => ({
    secure_url: `https://res.cloudinary.com/test/raw/upload/v1/${options.public_id}`,
  });
  S3Client.prototype.send = async () => ({});
  const response = new CapturedResponse();
  await uploadDigitalAssetSourceCode({
    files: {
      sourceCode: {
        name: 'seller.zip',
        mimetype: 'application/zip',
        size: 3,
        data: Buffer.from('ZIP'),
      },
    },
  }, response);

  assert.equal(response.statusCode, 201);
  assert.match(response.payload.data.sourceCodeUrl, /^r2:\/\/cardzip\/product-files\/.+\.zip$/i);
  assert.match(response.payload.data.sourceCodeCloudinaryUrl, /^https:\/\/res\.cloudinary\.com\/test\/raw\/upload\/v1\/.+\.zip$/i);
});

test('falls back to the Cloudinary backup when an R2 download fails', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  const key = 'cardzip/product-files/123e4567-e89b-12d3-a456-426614174000.zip';
  StoreProduct.findById = () => ({
    select() { return this; },
    lean: async () => ({
      name: 'Test Asset',
      sourceCodeUrl: `r2://${key}`,
      sourceCodeCloudinaryUrl: 'https://res.cloudinary.com/test/raw/upload/v1/test.zip',
      templateSourceCodeUrl: '',
      sourceArchiveVersion: 2,
      documents: [],
      templateDocuments: [],
    }),
  });

  S3Client.prototype.send = async () => {
    throw Object.assign(new Error('R2 object missing'), { code: 'NoSuchKey' });
  };
  upstreamResponse = async (url) => {
    assert.equal(String(url), 'https://res.cloudinary.com/test/raw/upload/v1/test.zip');
    return new Response('Cloudinary ZIP', { status: 200 });
  };

  const response = await makeRequest();

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.concat(response.chunks).toString(), 'Cloudinary ZIP');
  assert.equal(fetchCalls.length, 1);
});

test('authorizes seller rental and template downloads against their purchased option', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  paidPurchaseType = 'template';
  const key = 'cardzip/product-files/223e4567-e89b-12d3-a456-426614174000.zip';
  StoreProduct.findById = () => ({
    select() { return this; },
    lean: async () => ({
      name: 'Seller Full Stack',
      sourceCodeUrl: 'r2://cardzip/product-files/123e4567-e89b-12d3-a456-426614174000.zip',
      templateSourceCodeUrl: `r2://${key}`,
      sourceArchiveVersion: 2,
      documents: [],
      templateDocuments: [],
    }),
  });
  S3Client.prototype.send = async () => ({
    Body: Readable.from([Buffer.from('TEMPLATE ZIP')]),
    ContentLength: 11,
  });

  const denied = await makeRequest('paid-reference', 'rental-source-code');
  assert.equal(denied.statusCode, 403);

  const response = await makeRequest('paid-reference', 'template-source-code');

  assert.equal(response.statusCode, 200);
  assert.equal(Buffer.concat(response.chunks).toString(), 'TEMPLATE ZIP');
  assert.ok(paymentQueries.at(-1).$or.some((query) => query.purpose === 'seller_digital_asset'
    && query['metadata.purchaseType'] === 'template'));
});

test('streams private R2 product files only after payment authorization', async () => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET_NAME = 'private-products';
  const key = 'cardzip/product-files/123e4567-e89b-12d3-a456-426614174000.zip';
  StoreProduct.findById = () => ({
    select() { return this; },
    lean: async () => ({
      name: 'Test Asset',
      sourceCodeUrl: `r2://${key}`,
      templateSourceCodeUrl: '',
      sourceArchiveVersion: 2,
      documents: [],
      templateDocuments: [],
    }),
  });
  let objectRequested = false;
  S3Client.prototype.send = async (command) => {
    objectRequested = true;
    assert.equal(command.input.Bucket, 'private-products');
    assert.equal(command.input.Key, key);
    return { Body: Readable.from([Buffer.from('R2 ZIP')]), ContentLength: 6 };
  };

  const denied = await makeRequest('invalid-reference');
  assert.equal(denied.statusCode, 403);
  assert.equal(objectRequested, false);

  const allowed = await makeRequest();
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['content-type'], 'application/zip');
  assert.equal(Buffer.concat(allowed.chunks).toString(), 'R2 ZIP');
  assert.equal(objectRequested, true);
});

test('allows full-template legal documents only for full-template purchases', async () => {
  const rentalResponse = await makeRequest('paid-reference', 'template-document', '0');

  assert.equal(rentalResponse.statusCode, 403);
  assert.equal(fetchCalls.length, 0);

  paidPurchaseType = 'template';
  const templateResponse = await makeRequest('paid-reference', 'template-document', '0');

  assert.equal(templateResponse.statusCode, 200);
  assert.equal(templateResponse.headers['content-type'], 'application/pdf');
  assert.equal(Buffer.concat(templateResponse.chunks).toString(), 'ZIP');
  assert.ok(paymentQueries.at(-1).$or.some((query) => query.purpose === 'digital_product'
    && query['metadata.purchaseType'] === 'template'));
});

test('allows a full-template checkout after a completed rental purchase', async () => {
  process.env.PAYSTACK_CALLBACK_URLS = 'https://cardzip.example/payment-callback';
  process.env.PAYSTACK_SECRET_KEY = 'test-secret';
  let paymentQuery;
  let createdPayment;
  const completedRentalPayment = {
    status: 'completed',
    reference: 'completed-rental-reference',
    metadata: { productId, purchaseType: 'use' },
  };
  Payment.findOne = (query) => {
    paymentQuery = query;
    return {
      sort: async () => query.status === completedRentalPayment.status
        && query['metadata.purchaseType'] === completedRentalPayment.metadata.purchaseType
        ? completedRentalPayment
        : null,
    };
  };
  StoreProduct.findOne = () => ({
    select: async () => ({
      _id: productId,
      name: 'Test Asset',
      productType: 'website',
      usePrice: 100,
      templatePrice: 300,
    }),
  });
  User.findById = () => ({
    select: async () => ({ _id: '507f1f77bcf86cd799439012', email: 'buyer@example.test' }),
  });
  Payment.create = async (payment) => {
    createdPayment = payment;
    return { ...payment, save: async () => {} };
  };
  globalThis.fetch = async () => new Response(JSON.stringify({
    status: true,
    data: { authorization_url: 'https://checkout.paystack.com/test', reference: 'template-reference' },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const response = new CapturedResponse();
  await initializePaystackPayment({
    authUserId: '507f1f77bcf86cd799439013',
    body: {
      purpose: 'digital_product',
      productId,
      purchaseType: 'template',
      callbackUrl: 'https://cardzip.example/payment-callback',
    },
  }, response);

  assert.equal(paymentQuery['metadata.purchaseType'], 'template');
  assert.equal(createdPayment.metadata.purchaseType, 'template');
  assert.equal(response.statusCode, 201);
  assert.equal(response.payload.data.authorizationUrl, 'https://checkout.paystack.com/test');
});

test('resumes an existing pending payment for the selected purchase option', async () => {
  process.env.PAYSTACK_CALLBACK_URLS = 'https://cardzip.example/payment-callback';
  process.env.PAYSTACK_SECRET_KEY = 'test-secret';
  const previousPayment = {
    status: 'pending',
    reference: 'existing-template-reference',
    authorizationUrl: 'https://checkout.paystack.com/existing',
  };
  Payment.findOne = (query) => ({
    sort: async () => query.status === 'pending' && query['metadata.purchaseType'] === 'template'
      ? previousPayment
      : null,
  });
  StoreProduct.findOne = () => ({
    select: async () => ({
      _id: productId,
      name: 'Test Asset',
      productType: 'website',
      usePrice: 100,
      templatePrice: 300,
    }),
  });

  const response = new CapturedResponse();
  await initializePaystackPayment({
    authUserId: '507f1f77bcf86cd799439013',
    body: { purpose: 'digital_product', productId, purchaseType: 'template' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.reference, 'existing-template-reference');
  assert.equal(response.payload.data.authorizationUrl, 'https://checkout.paystack.com/existing');
  assert.equal(response.payload.data.resumedPendingPayment, true);
});

test('returns an existing completed purchase instead of resuming a newer pending checkout', async () => {
  process.env.PAYSTACK_CALLBACK_URLS = 'https://cardzip.example/payment-callback';
  process.env.PAYSTACK_SECRET_KEY = 'test-secret';
  Payment.findOne = (query) => ({
    sort: async () => query.status === 'completed'
      ? { status: 'completed', reference: 'completed-template-reference', metadata: { productId, purchaseType: 'template' } }
      : { status: 'pending', reference: 'pending-template-reference', authorizationUrl: 'https://checkout.paystack.com/pending' },
  });
  StoreProduct.findOne = () => ({
    select: async () => ({
      _id: productId,
      name: 'Test Asset',
      productType: 'website',
      usePrice: 100,
      templatePrice: 300,
    }),
  });
  StoreProduct.findById = () => ({
    select: async () => ({
      _id: productId,
      name: 'Test Asset',
      slug: 'test-asset',
      productType: 'website',
      sourceCodeUrl: '',
      templateSourceCodeUrl: '',
      sourceArchiveVersion: 2,
      documents: [],
      templateDocuments: [],
    }),
  });

  const response = new CapturedResponse();
  await initializePaystackPayment({
    authUserId: '507f1f77bcf86cd799439013',
    body: { purpose: 'digital_product', productId, purchaseType: 'template' },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.data.alreadyPurchased, true);
  assert.equal(response.payload.data.reference, 'completed-template-reference');
});
