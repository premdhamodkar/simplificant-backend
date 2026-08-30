const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  // 1. Demand the passport from the incoming request header
  const authHeader = req.header('Authorization');
  const token = authHeader && authHeader.split(' ')[1]; // Extract token from "Bearer <token>"

  // 2. If there is no passport, deny entry
  if (!token) {
    return res.status(401).json({ error: 'Access denied. No cryptographic passport provided.' });
  }

  try {
    // 3. Verify the royal seal (JWT_SECRET)
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    
    // 4. Attach the verified artisan's identity to the request and let them pass
    req.user = verified; 
    next();
  } catch (err) {
    // If the passport is fake or expired, deny entry
    return res.status(403).json({ error: 'Invalid or expired passport.' });
  }
};