import mongoose from 'mongoose';

const giftCardSchema = new mongoose.Schema({
  type: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, default: 'USD' },

  imageUrls: [{ type: String }],

  ngnAmount: Number,
  exchangeRate: Number,
  catalogCardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cards', default: null },
  region: { type: String, trim: true, default: '' },
  cardType: { type: String, trim: true, default: '' },
  cardLogo: { type: String, trim: true, default: '' },

  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  referrer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },

  status: {
    type: String,
    enum: ['pending', 'successful', 'failed'],
    default: 'pending',
  },
  tradeSpeed: {
     type: String,
     enum: ['slow', 'fast'],
     default: 'fast', // you can choose the default
   },

  companyFeedback: { type: String, trim: true },

  read: { type: Boolean, default: false },
  readCount: { type: Number, default: 0, min: 0 },

  bankDetails: {
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
  },

  referrerBankDetails: {
    bankName: { type: String, trim: true },
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
  },

  phoneNumber: { type: String, trim: true },

  paymentMethod: String,
  submittedVia: { type: String, enum: ['app', 'telegram'], default: 'app' },
  telegramSubmissionId: { type: String, unique: true, sparse: true, index: true },
  cryptoPayout: Number,
  walletAddress: { type: String, trim: true },

  createdAt: { type: Date, default: Date.now },

  statusUpdatedAt: {
    type: Date,
    default: Date.now,
  },
});

// ✅ PRE-SAVE HOOK GOES HERE (before model export)
giftCardSchema.pre('save', function (next) {
  if (this.isModified('status')) {
    this.statusUpdatedAt = new Date();
    console.log("🔄 Status updated, new timestamp:", this.statusUpdatedAt);
  }
  next();
});

// ✅ Model definition MUST come after hook
const GiftCard = mongoose.model('GiftCard', giftCardSchema);

export default GiftCard;
