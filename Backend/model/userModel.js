import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  profileImage: { type: String, default: '', trim: true, maxlength: 2048 },
  password: { type: String, required: true },
  googleSub: { type: String, unique: true, sparse: true, select: false },
  appleSub: { type: String, unique: true, sparse: true, select: false },
  telegramChatId: { type: String, unique: true, sparse: true, index: true, select: false },
  telegramLinkCodeHash: { type: String, select: false },
  telegramLinkCodeExpires: { type: Date, select: false },
  telegramLinkCodeSentAt: { type: Date, select: false },
  telegramLinkCodeAttempts: { type: Number, default: 0, select: false },
  accountNumber: { type: String, trim: true },
  accountName: { type: String, trim: true },
  bankName: { type: String, trim: true },
  referralCode: { type: String, unique: true },
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  walletBalance: { type: Number, default: 0 },
  walletCurrency: { type: String, default: 'NGN' },
  pushTokens: {
    type: [String],
    default: [],
  },
  kyc: {
    status: { type: String, enum: ['not_submitted', 'pending', 'approved', 'rejected'], default: 'not_submitted' },
    legalName: { type: String, trim: true },
    documentType: { type: String, enum: ['nin', 'passport', 'drivers_license'] },
    documentLastFour: { type: String, trim: true },
    documentNumberEncrypted: { type: String, select: false },
    documentHash: { type: String, select: false },
    submittedAt: { type: Date },
  },

  // Fields for forgot password
  resetCode: { type: String },            // the code sent to the user
  resetCodeExpires: { type: Date },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;
