const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// -------------------------
// POST /api/artisans/register
// Register a new artisan with a secure PIN
// -------------------------
router.post('/register', async (req, res) => {
  const { name, location, phone_number, pin } = req.body;

  if (!name || !location || !phone_number || !pin) {
    return res.status(400).json({ error: 'Name, location, phone number, and a 4-digit PIN are required.' });
  }

  try {
    // 1. Hash the PIN so it is never stored as plain text
    const saltRounds = 10;
    const pinHash = await bcrypt.hash(String(pin), saltRounds);

    // 2. Insert the artisan into the database
    const result = await pool.query(
      `INSERT INTO artisans (name, location, phone_number, pin_hash) 
       VALUES ($1, $2, $3, $4) RETURNING id, name, location, phone_number;`,
      [name, location, phone_number, pinHash]
    );

    const newArtisan = result.rows[0];

    // 3. Forge the Cryptographic Passport (JWT)
    const token = jwt.sign(
      { id: newArtisan.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' } // Token expires in 7 days
    );

    // 4. Return the artisan data AND the token
    return res.status(201).json({ artisan: newArtisan, token });

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An artisan with this phone number already exists.' });
    }
    console.error('❌ Error registering artisan:', err.message);
    return res.status(500).json({ error: 'Server error during registration.' });
  }
});

// -------------------------
// POST /api/artisans/login
// Verify phone and PIN to grant access
// -------------------------
router.post('/login', async (req, res) => {
  const { phone_number, pin } = req.body;

  if (!phone_number || !pin) {
    return res.status(400).json({ error: 'Phone number and PIN are required.' });
  }

  try {
    // 1. Find the artisan by phone number
    const result = await pool.query(`SELECT * FROM artisans WHERE phone_number = $1`, [phone_number]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid phone number or PIN.' });
    }

    const artisan = result.rows[0];

    // 2. Verify the provided PIN against the stored hash
    const isMatch = await bcrypt.compare(String(pin), artisan.pin_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid phone number or PIN.' });
    }

    // 3. Forge a fresh Cryptographic Passport (JWT)
    const token = jwt.sign(
      { id: artisan.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );

    // 4. Return the data (excluding the hash) and the token
    delete artisan.pin_hash; 
    return res.status(200).json({ artisan, token });

  } catch (err) {
    console.error('❌ Error logging in:', err.message);
    return res.status(500).json({ error: 'Server error during login.' });
  }
});

module.exports = router;