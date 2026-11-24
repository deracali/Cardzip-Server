import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchesVirtualNumberPriceQuote,
  VIRTUAL_NUMBER_MARKUP_NGN,
} from '../utils/virtualNumberPricing.js';

test('accepts the UI quote only when it matches the provider price plus the fixed markup', () => {
  assert.equal(matchesVirtualNumberPriceQuote(7960, 10960), true);
  assert.equal(matchesVirtualNumberPriceQuote(7960, 7960), false);
  assert.equal(matchesVirtualNumberPriceQuote(7960, 12960), false);
  assert.equal(matchesVirtualNumberPriceQuote(7960, Number.NaN), false);
  assert.equal(VIRTUAL_NUMBER_MARKUP_NGN, 3000);
});
