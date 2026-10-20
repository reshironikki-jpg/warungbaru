const admin = require('firebase-admin');

// Inisialisasi Firebase Admin menggunakan Environment Variables dari Vercel
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY 
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') 
        : undefined,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  // Mengatur Header CORS agar bisa diakses dari frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method, url } = req;

  try {
    // Endpoint: GET /api/products -> Mengambil data menu/produk warung
    if (method === 'GET' && (url === '/products' || url === '/')) {
      const snapshot = await db.collection('products').get();
      const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ success: true, data: products });
    }

    // Endpoint: POST /api/products -> Menambah produk/menu baru ke warung
    if (method === 'POST' && url === '/products') {
      let body = req.body;
      
      // Handle jika body masih berupa string JSON
      if (typeof body === 'string') {
        body = JSON.parse(body);
      }

      const { name, price, stock } = body;
      if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Nama dan harga wajib diisi!' });
      }

      const docRef = await db.collection('products').add({
        name,
        price: Number(price),
        stock: Number(stock || 0),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(201).json({ success: true, id: docRef.id, message: 'Produk berhasil ditambahkan!' });
    }

    return res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};