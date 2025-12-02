import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import User from '../model/userModel.js';
import redisClient from '../controller/redisClient.js';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);


// Get all users
export const getUsers = async (req, res) => {
  try {
    const users = await User.find().limit(20); // limit to 20 users
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const JWT_SECRET = process.env.JWT_SECRET || 'yoursecretkey';

// Helper to generate a referral code
const generateReferralCode = () => Math.random().toString(36).substr(2, 8).toUpperCase();



export const createUser = async (req, res) => {
  const { name, email, password, accountNumber, accountName, bankName, referrer } = req.body;

  try {
    // Check if email already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'Email already in use' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Check if the provided referrer exists (by referralCode)
    let referrerUser = null;
    if (referrer) {
      referrerUser = await User.findOne({ referralCode: referrer });
      if (!referrerUser) {
        return res.status(400).json({ message: 'Invalid referral code' });
      }
    }

    // Create new user with generated referralCode
    const user = new User({
      name,
      email,
      password: hashedPassword,
      accountNumber,
      accountName,
      bankName,
      referrer: referrerUser ? referrerUser._id : null,
      referralCode: generateReferralCode(),
    });

    const savedUser = await user.save();

    // Generate JWT
    const token = jwt.sign({ id: savedUser._id }, JWT_SECRET, { expiresIn: '7d' });

    // Include bank info in response
    res.status(201).json({
      user: {
        id: savedUser._id,
        name: savedUser.name,
        email: savedUser.email,
        accountNumber: savedUser.accountNumber,
        accountName: savedUser.accountName,
        bankName: savedUser.bankName,
        createdAt: savedUser.createdAt,
        referrer: referrerUser ? {
          id: referrerUser._id,
          name: referrerUser.name,
          email: referrerUser.email,
        } : null,
        referralCode: savedUser.referralCode,
      },
      token
    });
  } catch (err) {
    console.error('Error in createUser:', err);
    res.status(400).json({ message: err.message });
  }
};





export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid email or password' });

    // Generate JWT
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

   res.status(200).json({
  user: {
    id: user._id.toString(), // explicitly assign _id as id
    name: user.name,
    email: user.email,
    accountNumber: user.accountNumber,
    accountName: user.accountName,
    bankName: user.bankName,
    createdAt: user.createdAt
  },
  token
});

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};




export const updateUser = async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ✅ Clear Redis cache for this user
    if (redisClient) {
      await redisClient.del(`user:${id}`);
      console.log(`Cache cleared for user:${id}`);
    }

    res.status(200).json(updatedUser);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};



// Delete user by email
export const deleteUserByEmail = async (req, res) => {
  const { email } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOneAndDelete({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (redisClient) {
      await redisClient.del(`user:${user._id.toString()}`);
      console.log(`Cache cleared for user:${user._id}`);
    }

    return res.json({ message: "User account deleted successfully" });

  } catch (err) {
    console.error("Error in deleteUserByEmail:", err);
    return res.status(500).json({ message: err.message });
  }
};




// Get a user by ID
export const getUserById = async (req, res) => {
  const userId = req.params.id;

  try {
    // Check Redis cache first
    const cachedUser = await redisClient.get(`user:${userId}`);
    if (cachedUser) {
      console.log('Cache hit ✅');
      return res.json(JSON.parse(cachedUser));
    }

    // Cache miss: fetch from DB
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const now = new Date();
    const createdAt = new Date(user.createdAt);
    const diffInMonths = (now - createdAt) / (1000 * 60 * 60 * 24 * 30);

    let memberLevel = 'Bronze';
    let progressPercent = 0;
    let nextLevel = 'Silver';
    if (diffInMonths >= 6) { memberLevel = 'Platinum'; progressPercent = 100; nextLevel = null; }
    else if (diffInMonths >= 3) { memberLevel = 'Gold'; progressPercent = Math.round((diffInMonths / 6) * 100); nextLevel = 'Platinum'; }
    else if (diffInMonths >= 1) { memberLevel = 'Silver'; progressPercent = Math.round((diffInMonths / 6) * 100); nextLevel = 'Gold'; }

    const referralCount = await User.countDocuments({ referrer: user._id });

    const userData = {
      ...user.toObject(),
      memberLevel,
      progressPercent,
      nextLevel,
      referralCount,
    };

    // Store in Redis cache for 60 seconds (adjust TTL as needed)
    await redisClient.setEx(`user:${userId}`, 60, JSON.stringify(userData));

    res.json(userData);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



// Delete a user
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



// 1️⃣ Send reset code
export const sendResetCode = async (req, res) => {
  const { email } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Generate 6-digit numeric code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const resetCodeExpires = Date.now() + 15 * 60 * 1000; // 15 minutes

    user.resetCode = resetCode;
    user.resetCodeExpires = resetCodeExpires;
    await user.save();

    // Send email via Resend
    await resend.emails.send({
      from: 'Cardzip <onboarding@resend.dev>',
      to: user.email,
      subject: 'Your Password Reset Code',
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
          a.button { display: inline-block; padding: 12px 25px; background-color: #95c2c2; color: white !important; text-decoration: none; border-radius: 6px; font-weight: 600; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Cardzip</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hello ${user.name},</p>
            <p>We received a request to reset your password. Use the code below to reset it. This code will expire in 15 minutes.</p>
            <div class="code-box">${resetCode}</div>
            <p>If you did not request a password reset, please ignore this email.</p>
            <p>Thank you,<br>Cardzip Team</p>
          </div>
          <div class="footer">
            &copy; 2025 Cardzip. All rights reserved.
          </div>
        </div>
      </body>
      </html>
      `,
    });

    res.json({ message: 'Reset code sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};

// 2️⃣ Verify code and reset password
export const resetPasswordWithCode = async (req, res) => {
  const { email, code, newPassword } = req.body;

  try {
    const user = await User.findOne({
      email,
      resetCode: code,
      resetCodeExpires: { $gt: Date.now() }, // ensure code is not expired
    });

    if (!user) return res.status(400).json({ message: 'Invalid or expired code' });

    // Hash the new password
    user.password = await bcrypt.hash(newPassword, 10);

    // Clear code and expiry
    user.resetCode = undefined;
    user.resetCodeExpires = undefined;

    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: err.message });
  }
};
