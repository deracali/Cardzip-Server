const preferredServices = ['whatsapp', 'telegram', 'google', 'razorpay', 'opay', 'palmpay', 'moniepoint', 'paystack', 'flutterwave', 'walmart', 'woocommerce', 'jumia', 'konga', 'amazon', 'facebook', 'instagram', 'tiktok', 'bolt', 'uber'];

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const recordsFrom = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ['apps', 'applications', 'items', 'results']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return recordsFrom(payload.data);
};

const nameOf = (record) => {
  if (typeof record === 'string' || typeof record === 'number') return String(record).trim();
  if (!isRecord(record)) return '';
  for (const key of ['appName', 'name', 'app', 'service', 'label']) {
    if (record[key] !== undefined && record[key] !== null) return String(record[key]).trim();
  }
  return '';
};

export const createSms4AppPage = (payload, { search = '', limit = 50, offset = 0 } = {}) => {
  const searchTerm = String(search).trim().toLowerCase();
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
  const start = Math.max(0, Number.parseInt(offset, 10) || 0);
  const uniqueRecords = new Map();

  recordsFrom(payload).forEach((record) => {
    const name = nameOf(record);
    if (!name || /^allservices$/i.test(name) || !name.toLowerCase().includes(searchTerm)) return;
    const key = name.toLowerCase();
    if (!uniqueRecords.has(key)) uniqueRecords.set(key, record);
  });

  const records = [...uniqueRecords.values()].sort((first, second) => {
    const firstPriority = preferredServices.indexOf(nameOf(first).toLowerCase());
    const secondPriority = preferredServices.indexOf(nameOf(second).toLowerCase());
    return (firstPriority < 0 ? Number.MAX_SAFE_INTEGER : firstPriority)
      - (secondPriority < 0 ? Number.MAX_SAFE_INTEGER : secondPriority);
  });
  const data = records.slice(start, start + pageSize);

  return {
    ...(isRecord(payload) ? payload : {}),
    data,
    pagination: {
      limit: pageSize,
      offset: start,
      total: records.length,
      hasMore: start + data.length < records.length,
    },
  };
};
