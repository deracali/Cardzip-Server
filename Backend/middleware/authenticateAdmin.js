import jwt from 'jsonwebtoken';
import Admin from '../model/adminModel.js';

export const authenticateAdmin = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Admin authentication required.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ success: false, message: 'Admin authentication is not configured on the server.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || typeof payload !== 'object' || payload.type !== 'admin' || !payload.id) {
      return res.status(401).json({ success: false, message: 'Invalid admin authentication token.' });
    }

    const admin = await Admin.findById(payload.id).select('-password -resetCode -resetCodeExpires');
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Admin account is unavailable.' });
    }

    req.admin = admin;
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Invalid or expired admin token.' });
    }
    console.error('Admin authentication error:', error);
    return res.status(500).json({ success: false, message: 'Could not authenticate admin.' });
  }
};

export const requireAdminPermission = (permission) => (req, res, next) => {
  if (req.admin?.role === 'superadmin' || req.admin?.role === 'admin') return next();
  const permissions = Array.isArray(permission) ? permission : [permission];
  if (!permissions.some((item) => req.admin?.visiblePages?.includes(item))) {
    return res.status(403).json({ success: false, message: 'You do not have access to this page or action.' });
  }
  return next();
};

export const requireAdministrator = (req, res, next) => {
  if (req.admin?.role === 'admin' || req.admin?.role === 'superadmin') return next();
  return res.status(403).json({ success: false, message: 'Only an administrator can perform this action.' });
};

export const requireWithdrawalPasskey = (req, res, next) => {
  const token = req.headers['x-withdrawal-access'];
  if (typeof token !== 'string' || !token) {
    return res.status(401).json({ success: false, message: 'Verify your withdrawal approval passkey to access this resource.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ success: false, message: 'Withdrawal approval is not configured on the server.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (
      !payload
      || typeof payload !== 'object'
      || payload.type !== 'withdrawal-access'
      || String(payload.id) !== String(req.admin?._id)
      || payload.passkeyVersion !== (req.admin?.withdrawalPasskeyVersion ?? 0)
    ) {
      return res.status(401).json({ success: false, message: 'Verify your withdrawal approval passkey to access this resource.' });
    }
    return next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Your withdrawal approval session is invalid or expired. Verify your passkey again.' });
    }
    console.error('Withdrawal passkey authentication error:', error);
    return res.status(500).json({ success: false, message: 'Could not verify withdrawal approval access.' });
  }
};
