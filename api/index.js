const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Inisialisasi Firebase Admin menggunakan Environment Variable FIREBASE_SERVICE_ACCOUNT
if (!admin.apps.length) {
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      throw new Error('Environment variable FIREBASE_SERVICE_ACCOUNT belum diatur.');
    }

    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

    // Memperbaiki format newline pada private_key jika ter-escape oleh environment Vercel
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin berhasil terhubung.');
  } catch (error) {
    console.error('Gagal inisialisasi Firebase Admin:', error.message);
  }
}

const db = admin.firestore();

// Fungsi menghitung Euclidean Distance antar 2 vektor wajah (128-dimensi)
function euclideanDistance(desc1, desc2) {
  if (desc1.length !== desc2.length) return 1.0;
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Endpoint 1: Registrasi Wajah Baru
app.post('/api/register', async (req, res) => {
  try {
    const { nama, jabatan, descriptor } = req.body;

    if (!nama || !descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ success: false, message: 'Data nama atau descriptor wajah tidak valid.' });
    }

    const docRef = await db.collection('users_wajah').add({
      nama: nama.trim(),
      jabatan: jabatan ? jabatan.trim() : '-',
      descriptor: descriptor,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ success: true, id: docRef.id, message: `Wajah ${nama} berhasil didaftarkan.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint 2: Scan & Verifikasi Absensi
app.post('/api/absen', async (req, res) => {
  try {
    const { descriptor, tipe } = req.body; // tipe: 'Masuk' atau 'Pulang'

    if (!descriptor || !Array.isArray(descriptor)) {
      return res.status(400).json({ success: false, message: 'Descriptor wajah tidak terbaca.' });
    }

    const usersSnapshot = await db.collection('users_wajah').get();
    if (usersSnapshot.empty) {
      return res.status(404).json({ success: false, message: 'Belum ada data wajah terdaftar di sistem.' });
    }

    let bestMatch = null;
    let lowestDistance = 1.0;
    const THRESHOLD = 0.50; // Ambang batas kemiripan (semakin kecil semakin ketat, ideal 0.45 - 0.55)

    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.descriptor) {
        const dist = euclideanDistance(descriptor, userData.descriptor);
        if (dist < lowestDistance) {
          lowestDistance = dist;
          bestMatch = { id: doc.id, ...userData };
        }
      }
    });

    if (!bestMatch || lowestDistance > THRESHOLD) {
      return res.status(401).json({
        success: false,
        message: 'Wajah tidak dikenali. Pastikan pencahayaan cukup atau daftar terlebih dahulu.'
      });
    }

    const waktuSekarang = new Date();
    const logData = {
      userId: bestMatch.id,
      nama: bestMatch.nama,
      jabatan: bestMatch.jabatan,
      tipe: tipe || 'Masuk',
      akurasi: ((1 - lowestDistance) * 100).toFixed(1) + '%',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      waktuString: waktuSekarang.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
    };

    await db.collection('absensi_logs').add(logData);

    res.json({
      success: true,
      message: `Absen ${logData.tipe} berhasil dicatat!`,
      data: logData
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Endpoint 3: Ambil Riwayat Absensi Terbaru
app.get('/api/logs', async (req, res) => {
  try {
    const snapshot = await db.collection('absensi_logs')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    const logs = [];
    snapshot.forEach(doc => {
      logs.push({ id: doc.id, ...doc.data() });
    });

    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Jalankan server lokal jika tidak di environment Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server berjalan di http://localhost:${PORT}`));
}

module.exports = app;