export const VIRTUAL_NUMBER_MARKUP_NGN = 3000;

export const matchesVirtualNumberPriceQuote = (providerPrice, quotedPrice) => (
  Number.isFinite(providerPrice)
  && Number.isFinite(quotedPrice)
  && Math.round(quotedPrice * 100) === Math.round((providerPrice + VIRTUAL_NUMBER_MARKUP_NGN) * 100)
);
