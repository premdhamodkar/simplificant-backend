// server.js

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');

// -------------------------
// Express App Initialization
// -------------------------
const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// -------------------------
// Boot-time DB Handshake Check
// -------------------------
async function verifyDatabaseConnection() {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL connected successfully');
    console.log(`   Server time: ${result.rows[0].now}`);
  } catch (err) {
    console.error('❌ Failed to connect to PostgreSQL');
    console.error(err.message);
    process.exit(1);
  }
}

// -------------------------
// Health Check Endpoint
// -------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime_seconds: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

const artisanRoutes = require('./routes/artisans');
app.use('/api/artisans', artisanRoutes);

const productRoutes = require('./routes/products');
app.use('/api/products', productRoutes);


const orderRoutes = require('./routes/orders');
app.use('/api/orders', orderRoutes);

// -------------------------
// Server Startup
// -------------------------
const PORT = process.env.PORT || 5000;

verifyDatabaseConnection().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});

module.exports = { app, pool };