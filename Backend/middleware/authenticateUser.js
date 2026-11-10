import jwt from 'jsonwebtoken';

const authenticateUser = (req, res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }
  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ success: false, error: 'Authentication is not configured on the server.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || typeof payload !== 'object' || !payload.id || payload.type === 'admin') {
      return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
    }
    req.authUserId = String(payload.id);
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired authentication token.' });
  }
};

export default authenticateUser;