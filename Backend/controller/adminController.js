import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import sgMail from "@sendgrid/mail";
import Admin from '../model/adminModel.js';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key';

// Admin Signup
export const signUp = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return res.status(400).json({ message: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newAdmin = new Admin({
      name,
      email,
      password: hashedPassword,
      role,
    });

    await newAdmin.save();

    res.status(201).json({ message: 'Admin created successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Admin Signin
export const signIn = async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.status(200).json({ message: 'Login successful', token, admin });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update Admin Info
export const updateAdmin = async (req, res) => {
  try {
    const adminId = req.params.id;
    const updates = req.body;

    if (updates.password) {
      updates.password = await bcrypt.hash(updates.password, 10);
    }

    const updatedAdmin = await Admin.findByIdAndUpdate(adminId, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedAdmin) return res.status(404).json({ message: 'Admin not found' });

    res.status(200).json({ message: 'Admin updated successfully', admin: updatedAdmin });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};



export const sendAdminResetCode = async (req, res) => {
  const { email } = req.body;
  console.log("📩 Admin reset request:", req.body);

  try {
    const admin = await Admin.findOne({ email });
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

    console.log("✅ Admin reset email sent to", admin.email);

    res.json({ message: "Admin reset code sent to email" });
  } catch (err) {
    console.error("❌ Admin reset error:", err);
    res.status(500).json({ message: err.message || "Server error" });
  }
};


// 2️⃣ Verify code and reset admin password
export const resetAdminPasswordWithCode = async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    const admin = await Admin.findOne({
      email,
      resetCode: code,
      resetCodeExpires: { $gt: Date.now() },
    });

    if (!admin) return res.status(400).json({ message: 'Invalid or expired code' });

    // Hash new password
    admin.password = await bcrypt.hash(newPassword, 10);

    // Clear code and expiry
    admin.resetCode = undefined;
    admin.resetCodeExpires = undefined;

    await admin.save();

    res.json({ message: 'Admin password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
