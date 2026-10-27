const admin = require('firebase-admin');

// ---------------------------------------------------------------------------
// Membaca environment variable dengan aman.
// Nilai dari dashboard/Vercel CLI terkadang masih dibungkus tanda kutip,
// jadi kita buang dulu sebelum dipakai.
// ---------------------------------------------------------------------------
function cleanEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) return undefined;

  let value = String(raw).trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1).trim();
  }
  return value.length ? value : undefined;
}

// ---------------------------------------------------------------------------
// Menyusun ulang private key Firebase menjadi PEM yang valid:
//   1. literal backslash-n (format env Vercel/dotenv) diubah jadi newline,
//      lalu karakter CR dari baris CRLF dibuang
//   2. hanya blok PEM yang diambil, sehingga kutip/spasi/teks nyangkut di
//      luar blok (sebelum BEGIN atau sesudah END) ikut terbuang
//   3. header, isi, dan footer dipisah newline seperti PEM pada umumnya,
//      walau key aslinya tersimpan sebagai satu baris tanpa newline
// ---------------------------------------------------------------------------
function normalizePrivateKey(key) {
  if (!key) return undefined;

  const NL = String.fromCharCode(10); // newline
  const BS = String.fromCharCode(92); // backslash
  const CR = String.fromCharCode(13); // CR

  // 1. literal backslash-n -> newline asli, lalu buang CR
  const pem = String(key).trim().split(BS + 'n').join(NL).split(CR).join('');

  // 2. ambil hanya blok PEM, buang apapun di luar blok itu
  const headerMatch = /-----BEGIN [A-Z0-9 ]+-----/.exec(pem);
  if (!headerMatch) return pem;

  const header = headerMatch[0];
  const footer = header.replace('BEGIN', 'END');
  const afterHeader = pem.slice(headerMatch.index + header.length);
  const footerIdx = afterHeader.indexOf(footer);
  const body = (footerIdx >= 0 ? afterHeader.slice(0, footerIdx) : afterHeader).trim();

  // 3. susun ulang: header, isi, footer dipisah newline
  return footerIdx >= 0 ? header + NL + body + NL + footer : header + NL + body;
}

// ---------------------------------------------------------------------------
// Inisialisasi Firebase Admin secara lazy, di dalam handler.
// Dulu inisialisasi dilakukan di top-level: kalau credential bermasalah,
// seluruh module gagal di-load dan Vercel membalas halaman HTML 500,
// yang bikin frontend melempar error saat membaca res.json().
// ---------------------------------------------------------------------------
let cachedDb = null;
let cachedInitError = null;

function getDb() {
  if (cachedDb) return cachedDb;
  if (cachedInitError) throw cachedInitError;

  try {
    const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL']
      .filter(name => !cleanEnv(name));

    if (missing.length) {
      throw new Error('Environment variable belum ter-set di Vercel: ' + missing.join(', '));
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          type: cleanEnv('FIREBASE_TYPE') || 'service_account',
          projectId: cleanEnv('FIREBASE_PROJECT_ID'),
          privateKeyId: cleanEnv('FIREBASE_PRIVATE_KEY_ID'),
          privateKey: normalizePrivateKey(cleanEnv('FIREBASE_PRIVATE_KEY')),
          clientEmail: cleanEnv('FIREBASE_CLIENT_EMAIL'),
        }),
      });
    }

    cachedDb = admin.firestore();
    return cachedDb;
  } catch (error) {
    cachedInitError = error;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Menyeragakan path request.
// Vercel bisa mengirim "/api/products" (tanpa rewrite), "/api/index" /
// "/api/index.js" (setelah rewrite), atau "/products". Semua dinormalkan
// jadi path relatif terhadap API: "/api/products" -> "/products".
// ---------------------------------------------------------------------------
function normalizePath(url) {
  let path = String(url || '/').split('?')[0].split('#')[0];
  path = path.replace(/\/index(\.js)?$/, '');
  path = path.replace(/^\/api(?=\/|$)/, '');
  path = path.replace(/\/+$/, '');
  return path || '/';
}

module.exports = async (req, res) => {
  // Header CORS agar bisa diakses dari frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { method } = req;
  const path = normalizePath(req.url);

  try {
    // GET /products (atau /) -> Mengambil data menu/produk warung
    if (method === 'GET' && (path === '/products' || path === '/')) {
      const snapshot = await getDb().collection('products').get();
      const products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ success: true, data: products });
    }

    // POST /products -> Menambah produk/menu baru ke warung
    if (method === 'POST' && path === '/products') {
      let body = req.body;

      // Handle jika body masih berupa string JSON
      if (typeof body === 'string') {
        body = JSON.parse(body);
      }

      const { name, price, stock } = body || {};
      if (!name || !price) {
        return res.status(400).json({ success: false, message: 'Nama dan harga wajib diisi!' });
      }

      const docRef = await getDb().collection('products').add({
        name,
        price: Number(price),
        stock: Number(stock || 0),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(201).json({ success: true, id: docRef.id, message: 'Produk berhasil ditambahkan!' });
    }

    return res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
