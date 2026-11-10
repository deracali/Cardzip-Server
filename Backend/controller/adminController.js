import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'node:crypto';
import { Resend } from 'resend';
import Admin from '../model/adminModel.js';

const getJwtSecret = () => process.env.JWT_SECRET;
const resend = new Resend(process.env.RESEND_API_KEY);

const safeAdmin = (admin) => ({
  id: admin._id,
  name: admin.name,
  email: admin.email,
  role: admin.role,
  isActive: admin.isActive,
  department: admin.department,
  phone: admin.phone,
  visiblePages: admin.visiblePages,
});

export const getBootstrapStatus = async (req, res) => {
  try {
    const configured = Boolean(process.env.ADMIN_BOOTSTRAP_SECRET);
    const hasSuperadmin = await Admin.exists({ role: 'superadmin' });
    return res.json({ success: true, available: configured && !hasSuperadmin });
  } catch (error) {
    console.error('Admin bootstrap status error:', error);
    return res.status(500).json({ success: false, message: 'Could not check admin setup status.' });
  }
};

// The bootstrap secret is only valid until the first superadmin is created.
export const signUp = async (req, res) => {
  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return res.status(503).json({ success: false, message: 'JWT authentication is not configured on the server.' });
    const { name, email, password, bootstrapSecret } = req.body;
    const expectedSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
    const suppliedSecret = typeof bootstrapSecret === 'string' ? bootstrapSecret : '';
    if (!expectedSecret) {
      return res.status(503).json({ success: false, message: 'Superadmin bootstrap is not configured.' });
    }
    const expected = Buffer.from(expectedSecret);
    const supplied = Buffer.from(suppliedSecret);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return res.status(403).json({ success: false, message: 'Invalid admin bootstrap secret.' });
    }
    if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') || typeof password !== 'string' || password.length < 12) {
      return res.status(400).json({ success: false, message: 'Provide a name, valid email, and password of at least 12 characters.' });
    }
    if (await Admin.exists({ role: 'superadmin' })) {
      return res.status(409).json({ success: false, message: 'The initial superadmin has already been created.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await Admin.findOne({ email: normalizedEmail })) {
      return res.status(409).json({ success: false, message: 'Email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newAdmin = new Admin({
      name: name.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: 'superadmin',
    });
    await newAdmin.save();

    const token = jwt.sign({ id: newAdmin._id, type: 'admin' }, jwtSecret, { expiresIn: '8h' });
    return res.status(201).json({ success: true, message: 'Superadmin created successfully.', token, admin: safeAdmin(newAdmin) });
  } catch (error) {
    console.error('Admin signup error:', error);
    return res.status(500).json({ success: false, message: 'Could not create the initial superadmin.' });
  }
};

// Admin Signin
export const signIn = async (req, res) => {
  try {
    const jwtSecret = getJwtSecret();
    if (!jwtSecret) return res.status(503).json({ success: false, message: 'JWT authentication is not configured on the server.' });
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email: String(email || '').trim().toLowerCase() });
    if (!admin || !admin.isActive) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const isMatch = typeof password === 'string' && await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: admin._id, type: 'admin' },
      jwtSecret,
      { expiresIn: '8h' }
    );

    return res.status(200).json({ success: true, message: 'Login successful.', token, admin: safeAdmin(admin) });
  } catch (error) {
    console.error('Admin signin error:', error);
    return res.status(500).json({ success: false, message: 'Could not sign in.' });
  }
};

// Update Admin Info
export const updateAdmin = async (req, res) => {
  try {
    if (String(req.admin._id) !== req.params.id) {
      return res.status(403).json({ success: false, message: 'You can only update your own admin profile.' });
    }
    const adminId = req.params.id;
    const updates = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) updates.name = req.body.name.trim();
    if (typeof req.body.phone === 'string') updates.phone = req.body.phone.trim();
    if (typeof req.body.password === 'string' && req.body.password.length >= 12) {
      updates.password = await bcrypt.hash(req.body.password, 12);
    } else if (req.body.password !== undefined) {
      return res.status(400).json({ success: false, message: 'Password must be at least 12 characters.' });
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(adminId, updates, {
      new: true,
      runValidators: true,
    }).select('-password -resetCode -resetCodeExpires');

    if (!updatedAdmin) return res.status(404).json({ success: false, message: 'Admin not found.' });

    return res.status(200).json({ success: true, message: 'Admin updated successfully.', admin: updatedAdmin });
  } catch (error) {
    console.error('Admin update error:', error);
    return res.status(500).json({ success: false, message: 'Could not update the admin profile.' });
  }
};



export const sendAdminResetCode = async (req, res) => {
  const { email } = req.body;

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(503).json({ success: false, message: 'Admin password reset email is not configured.' });
    }
    const admin = await Admin.findOne({ email: String(email || '').trim().toLowerCase() });
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    // Generate reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpires = Date.now() + 15 * 60 * 1000;

    admin.resetCode = resetCode;
    admin.resetCodeExpires = resetCodeExpires;
    await admin.save();

    // ✉️ Send email using Resend (same as user)
    await resend.emails.send({
      from: "Cardzip Admin <onboarding@resend.dev>",
      to: admin.email,
      subject: "Admin Password Reset Code",
      html: `
      <html>
      <head>
        <style>
          body { font-family: "Poppins", sans-serif; background-color: #f5f6fa; margin: 0; padding: 0; }
          .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 10px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden; }
          .header { background-color: #95c2c2; color: white; text-align: center; padding: 30px 20px; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 30px 20px; color: #333333; }
          .content h2 { color: #95c2c2; font-size: 20px; margin-bottom: 10px; }
          .code-box { display: inline-block; background: #f0f4ff; color: #95c2c2; font-size: 28px; font-weight: bold; padding: 15px 25px; border-radius: 8px; letter-spacing: 4px; margin: 20px 0; }
          .footer { background: #f5f6fa; text-align: center; padding: 20px; font-size: 14px; color: #777; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header"><h1>Cardzip Admin</h1></div>
          <div class="content">
            <h2>Admin Password Reset</h2>
            <p>Hello ${admin.name || "Admin"},</p>
            <p>Use the secure code below to reset your admin password. This code expires in 15 minutes.</p>
            <div class="code-box">${resetCode}</div>
            <p>If you did not request this, please review your account security immediately.</p>
            <p>Regards,<br>Cardzip Security Team</p>
          </div>
          <div class="footer">&copy; 2025 Cardzip. All rights reserved.</div>
        </div>
      </body>
      </html>
      `,
    });

    return res.json({ success: true, message: "Admin reset code sent to email." });
  } catch (err) {
    console.error('Admin reset email error:', err);
    return res.status(500).json({ success: false, message: 'Could not send the admin reset code.' });
  }
};


// 2️⃣ Verify code and reset admin password
export const resetAdminPasswordWithCode = async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    if (typeof newPassword !== 'string' || newPassword.length < 12) {
      return res.status(400).json({ success: false, message: 'Password must be at least 12 characters.' });
    }
    const admin = await Admin.findOne({
      email: String(email || '').trim().toLowerCase(),
      resetCode: code,
      resetCodeExpires: { $gt: Date.now() },
    });

    if (!admin) return res.status(400).json({ message: 'Invalid or expired code' });

    // Hash new password
    admin.password = await bcrypt.hash(newPassword, 12);

    // Clear code and expiry
    admin.resetCode = undefined;
    admin.resetCodeExpires = undefined;

    await admin.save();

    return res.json({ success: true, message: 'Admin password reset successfully.' });
  } catch (err) {
    console.error('Admin password reset error:', err);
    return res.status(500).json({ success: false, message: 'Could not reset the admin password.' });
  }
};
