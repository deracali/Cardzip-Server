import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    withdrawalPasskeyHash: { type: String, select: false },
    withdrawalPasskeyVersion: { type: Number, default: 0 },
    role: { type: String, enum: ['admin', 'superadmin', 'staff'], default: 'staff' },
    companyBalance: { type: Number, default: 0, min: 0 },
    companyProfit: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    department: { type: String, trim: true, default: 'Operations' },
    phone: { type: String, trim: true, default: '' },
    visiblePages: { type: [String], default: [] },
    assignedTasks: [{ type: mongoose.Schema.Types.ObjectId, ref: 'AdminTask' }],

    // Fields for password reset
    resetCode: { type: String },
    resetCodeExpires: { type: Date },
  },
  { timestamps: true }
);

adminSchema.index({ role: 1 }, {
  unique: true,
  partialFilterExpression: { role: 'superadmin' },
});

const Admin = mongoose.model('Admin', adminSchema);
export default Admin;
