import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  accountNumber: { type: String, trim: true },
  accountName: { type: String, trim: true },
  bankName: { type: String, trim: true },
  referralCode: { type: String, unique: true },
  referrer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  pushTokens: {
    type: [String],
    default: [],
  },

  // Fields for forgot password
  resetCode: { type: String },            // the code sent to the user
  resetCodeExpires: { type: Date },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

export default User;
