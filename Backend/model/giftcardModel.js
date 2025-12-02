import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// Sub‐schema for the per‐country type/rate info
const GiftCardTypeSchema = new Schema({
  country:  { type: String, required: true, trim: true },
  rate:     { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, trim: true }
}, { _id: false });

// Main GiftCard schema
const GiftCardModal = new Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    trim: true
  },
  discount: {
    type: String,
    trim: true
  },
  color: {
    type: String,
    required: true,
    match: /^#([0-9A-Fa-f]{6})$/
  },
  popular: {
    type: Boolean,
    default: false
  },
  cardLimit: {
    type: Number,
    required: true,
    min: 0
  },
  types: {
    type: [GiftCardTypeSchema],
    validate: v => Array.isArray(v) && v.length > 0
  }
}, {
  timestamps: true
});

export default model('Cards', GiftCardModal);
