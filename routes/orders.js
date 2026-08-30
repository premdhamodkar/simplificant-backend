// routes/orders.js

const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth'); // <-- The Guard

// -------------------------
// POST /api/orders
// Create a new order (buyer checkout) -> UNPROTECTED (Buyers purchase without a passport)
// -------------------------
router.post('/', async (req, res) => {
  const {
    product_id,
    artisan_id,
    buyer_name,
    buyer_phone,
    shipping_address,
    total_amount,
  } = req.body;

  // -------------------------
  // Validation
  // -------------------------
  if (
    !product_id ||
    !artisan_id ||
    !buyer_name ||
    !buyer_phone ||
    !shipping_address ||
    total_amount === undefined
  ) {
    return res.status(400).json({
      error:
        'Missing required fields: product_id, artisan_id, buyer_name, buyer_phone, shipping_address, and total_amount are all required.',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO orders (product_id, artisan_id, buyer_name, buyer_phone, shipping_address, total_amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, product_id, artisan_id, buyer_name, buyer_phone, shipping_address, total_amount, status, created_at;`,
      [product_id, artisan_id, buyer_name, buyer_phone, shipping_address, total_amount]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // -------------------------
    // Foreign key violation: invalid product_id or artisan_id
    // -------------------------
    if (err.code === '23503') {
      return res.status(400).json({
        error: 'Invalid product_id or artisan_id: no matching record found.',
      });
    }

    console.error('❌ Error creating order:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while placing this order.',
    });
  }
});

// -------------------------
// GET /api/orders/artisan/:artisanId
// Fetch all orders for a specific artisan -> PROTECTED BY AUTH
// -------------------------
router.get('/artisan/:artisanId', auth, async (req, res) => {
  const { artisanId } = req.params;

  // -------------------------
  // Sovereign Check: Ensure the passport matches the requested territory
  // -------------------------
  if (req.user.id !== artisanId) {
    return res.status(403).json({
      error: 'Unauthorized: You may only inspect your own workshop ledger.',
    });
  }

  try {
    const result = await pool.query(
      `SELECT
         orders.id,
         orders.product_id,
         orders.artisan_id,
         orders.buyer_name,
         orders.buyer_phone,
         orders.shipping_address,
         orders.total_amount,
         orders.status,
         orders.created_at,
         products.auto_title,
         products.image_url
       FROM orders
       JOIN products ON orders.product_id = products.id
       WHERE orders.artisan_id = $1
       ORDER BY orders.created_at DESC;`,
      [artisanId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching artisan orders:', err.message);
    return res.status(500).json({
      error: "Something went wrong while fetching this artisan's orders.",
    });
  }
});

// -------------------------
// PUT /api/orders/:id/status
// Update an order's fulfillment status -> PROTECTED BY AUTH
// -------------------------
router.put('/:id/status', auth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const VALID_STATUSES = ['Pending Fulfillment', 'Shipped', 'Completed'];

  if (!status || !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}.`,
    });
  }

  try {
    // Optional defense: Verify this order actually belongs to the logged-in artisan before updating
    // (For absolute watertight security, we ensure the order's artisan_id matches req.user.id)
    const ownershipCheck = await pool.query(`SELECT artisan_id FROM orders WHERE id = $1`, [id]);
    if (ownershipCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }
    if (ownershipCheck.rows[0].artisan_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized: This order does not belong to your workshop.' });
    }

    const result = await pool.query(
      `UPDATE orders
       SET status = $1
       WHERE id = $2
       RETURNING id, product_id, artisan_id, buyer_name, buyer_phone, shipping_address, total_amount, status, created_at;`,
      [status, id]
    );

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating order status:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while updating this order.',
    });
  }
});

module.exports = router;