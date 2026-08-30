// routes/products.js

const express = require('express');
const router = express.Router();
const pool = require('../db');
const { GoogleGenAI, Type } = require('@google/genai');
const cloudinary = require('cloudinary').v2;

// -------------------------
// Cloudinary Configuration
// -------------------------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// -------------------------
// Gemini Client Initialization
// -------------------------
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// -------------------------
// Structured Output Schema
// Physically enforces the shape of the AI response
// -------------------------
const productSchema = {
  type: Type.OBJECT,
  properties: {
    auto_title: {
      type: Type.STRING,
      description: 'A short, marketable product title based on the image.',
    },
    auto_description: {
      type: Type.STRING,
      description: 'A concise, appealing product description for an e-commerce listing.',
    },
    category: {
      type: Type.STRING,
      enum: ['Pottery', 'Textile', 'Metalwork', 'Woodwork', 'Jute'],
    },
    suggested_price_inr: {
      type: Type.INTEGER,
      description:
        'A realistic wholesale/retail market price in INR for a handmade product from a rural Indian artisan. Base this on typical local market rates for similar handcrafted goods — avoid premium, export, or luxury-boutique pricing.',
    },
  },
  required: ['auto_title', 'auto_description', 'category', 'suggested_price_inr'],
  propertyOrdering: ['auto_title', 'auto_description', 'category', 'suggested_price_inr'],
};

// -------------------------
// POST /api/products/auto-catalog
// AI-generate product listing from an image + upload image to Cloudinary
// -------------------------
router.post('/auto-catalog', async (req, res) => {
  const { artisan_id, base64Image, mimeType } = req.body;

  // -------------------------
  // Validation
  // -------------------------
  if (!artisan_id || !base64Image || !mimeType) {
    return res.status(400).json({
      error: 'Missing required fields: artisan_id, base64Image, and mimeType are all required.',
    });
  }

  let secureImageUrl;

  try {
    // -------------------------
    // The Upload Intercept: build a proper Data URI
    // -------------------------
    const dataUri = `data:${mimeType};base64,${base64Image}`;

    // -------------------------
    // The Vault: upload to Cloudinary
    // -------------------------
    try {
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: 'artisan_crafts',
        resource_type: 'image',
      });
      secureImageUrl = uploadResult.secure_url;
    } catch (uploadErr) {
      console.error('❌ Cloudinary upload failed:', uploadErr.message);
      return res.status(502).json({
        error: 'Failed to upload the image. Please try again with a different image.',
      });
    }

    // -------------------------
    // AI Pipeline: Image Analysis
    // -------------------------
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                'Analyze this handmade product image and generate an e-commerce listing for it. ' +
                'The seller is a rural Indian artisan. Suggest a fair, realistic market price, not a luxury price.',
            },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: productSchema,
      },
    });

    const productData = JSON.parse(aiResponse.text);
    const { auto_title, auto_description, category, suggested_price_inr } = productData;

    // -------------------------
    // Database Insert (using the real Cloudinary secure_url)
    // -------------------------
    const result = await pool.query(
      `INSERT INTO products (artisan_id, image_url, auto_title, auto_description, category, suggested_price_inr)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, artisan_id, image_url, auto_title, auto_description, category, suggested_price_inr, created_at;`,
      [artisan_id, secureImageUrl, auto_title, auto_description, category, suggested_price_inr]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    // -------------------------
    // Foreign key violation: invalid artisan_id
    // -------------------------
    if (err.code === '23503') {
      return res.status(400).json({
        error: 'Invalid artisan_id: no artisan found with this ID.',
      });
    }

    console.error('❌ Error in auto-catalog pipeline:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while generating the product listing.',
    });
  }
});

// -------------------------
// GET /api/products
// Fetch all products for the public marketplace feed,
// joined with their respective artisan details
// -------------------------
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         products.id,
         products.artisan_id,
         products.image_url,
         products.auto_title,
         products.auto_description,
         products.category,
         products.suggested_price_inr,
         products.created_at,
         artisans.name AS artisan_name,
         artisans.location AS artisan_location,
         artisans.phone_number AS artisan_phone_number
       FROM products
       JOIN artisans ON products.artisan_id = artisans.id
       ORDER BY products.created_at DESC;`
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching product feed:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while fetching the product feed.',
    });
  }
});


// -------------------------
// GET /api/products/artisan/:artisanId
// Fetch all products belonging to a specific artisan (for their inventory dashboard)
// -------------------------
router.get('/artisan/:artisanId', async (req, res) => {
  const { artisanId } = req.params;

  try {
    const result = await pool.query(
      `SELECT
         id,
         artisan_id,
         image_url,
         auto_title,
         auto_description,
         category,
         suggested_price_inr,
         created_at
       FROM products
       WHERE artisan_id = $1
       ORDER BY created_at DESC;`,
      [artisanId]
    );

    return res.status(200).json(result.rows);
  } catch (err) {
    console.error('❌ Error fetching artisan inventory:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while fetching this artisan\'s products.',
    });
  }
});

// -------------------------
// PUT /api/products/:id
// Update a product's title, description, and price.
// Ownership is verified via artisan_id in the request body.
// -------------------------
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { artisan_id, auto_title, auto_description, suggested_price_inr } = req.body;

  if (!artisan_id || !auto_title || !auto_description || suggested_price_inr === undefined) {
    return res.status(400).json({
      error: 'artisan_id, auto_title, auto_description, and suggested_price_inr are all required.',
    });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET auto_title = $1,
           auto_description = $2,
           suggested_price_inr = $3
       WHERE id = $4 AND artisan_id = $5
       RETURNING id, artisan_id, image_url, auto_title, auto_description, category, suggested_price_inr, created_at;`,
      [auto_title, auto_description, suggested_price_inr, id, artisan_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Product not found, or it does not belong to this artisan.',
      });
    }

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Error updating product:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while updating this product.',
    });
  }
});

// -------------------------
// DELETE /api/products/:id
// Delete a product. Ownership is verified via artisan_id in the request body.
// -------------------------
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const { artisan_id } = req.body;

  if (!artisan_id) {
    return res.status(400).json({ error: 'artisan_id is required to delete a product.' });
  }

  try {
    const result = await pool.query(
      `DELETE FROM products WHERE id = $1 AND artisan_id = $2 RETURNING id;`,
      [id, artisan_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Product not found, or it does not belong to this artisan.',
      });
    }

    return res.status(200).json({ id: result.rows[0].id, deleted: true });
  } catch (err) {
    console.error('❌ Error deleting product:', err.message);
    return res.status(500).json({
      error: 'Something went wrong while deleting this product.',
    });
  }
});

module.exports = router;