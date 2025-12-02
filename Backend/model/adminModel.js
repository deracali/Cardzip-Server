import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin' },
    isActive: { type: Boolean, default: true },

    // Fields for password reset
    resetCode: { type: String },
    resetCodeExpires: { type: Date },
  },
  { timestamps: true }
);

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;
