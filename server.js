// Firebase server using Express and Firestor

const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Firebase Admin SDK setup
require('dotenv').config();

const serviceAccount = {
  type: process.env.FIRE_TYPE,
  project_id: process.env.FIRE_PROJECT_ID,
  private_key_id: process.env.FIRE_PRIVATE_KEY_ID,
  private_key: process.env.FIRE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIRE_CLIENT_EMAIL,
  client_id: process.env.FIRE_CLIENT_ID,
  auth_uri: process.env.FIRE_AUTH_URI,
  token_uri: process.env.FIRE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIRE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIRE_CLIENT_X509_CERT_URL,
  universe_domain: process.env.FIRE_UNIVERSE_DOMAIN
};
module.exports = serviceAccount;
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

app.use(bodyParser.json());

app.get('/', (req, res) => res.status(200).send('Server is running...'));

app.post('/saveinfo', async (req, res) => {
  const { userId, data } = req.body;
  try {
    await db.collection('Main').doc(userId).set(data, { merge: true }); // <-- add { merge: true }
    res.status(200).send('Info saved successfully');
  } catch (error) {
    res.status(500).send('Failed to save info');
  }
});

/**
 * Route: /getinfo
 * Method: GET
 * Description: Get all user info from 'Main'
 */
app.get('/getinfo', async (req, res) => {
  try {
    const snapshot = await db.collection('Main').get();
    const results = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json(results);
  } catch (error) {
    res.status(500).send('Failed to fetch info');
  }
});
/**
 * Route: /updateinfo
 * Method: POST
 * Description: Update user info in 'Main'
 */
app.post('/updateinfo', async (req, res) => {
  const { userId, data } = req.body;

  if (!userId || !data) {
    return res.status(400).send('Missing userId or data');
  }

  try {
    const userRef = db.collection('Main').doc(userId);
    await userRef.set(data, { merge: true }); // merge: true retains existing fields
    res.status(200).send('User info updated successfully');
  } catch (error) {
    console.error("Error updating user info:", error);
    res.status(500).send('Failed to update user info');
  }
});
/**
 * Route: /delete
 * Method: POST
 * Description: Delete user from 'Main'
 */
app.post('/delete', async (req, res) => {
  const { userId } = req.body;
  try {
    await db.collection('Main').doc(userId).delete();
    res.status(200).send('User deleted');
  } catch (error) {
    res.status(500).send('Failed to delete user');
  }
});

// Route: /UserErrors
// Method: POST
// Description: Save user error log to 'Errors' collection
app.post('/UserErrors', async (req, res) => {
  const { user_id, error } = req.body;
  try {
    const userRef = db.collection('Errors').doc(String(user_id));
    await userRef.set(
      {
        errorLogs: admin.firestore.FieldValue.arrayUnion({
          message: error,
          timestamp: new Date().toISOString(),
        }),
      },
      { merge: true }
    );
    res.status(200).send('Error saved');
  } catch (err) {
    res.status(500).send('Failed to save error');
  }
});

// Route: /Pet_stats
// Method: POST
// Description: Save or update user pet stats in 'Stats' collection
app.post('/Pet_stats', async (req, res) => {
  const { user_id, stats } = req.body;
  try {
    const statsRef = db.collection('Stats').doc(String(user_id));
    await statsRef.set(
      {
        ...stats,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
    res.status(200).send('Stats saved');
  } catch (err) {
    res.status(500).send('Failed to save stats');
  }
});
// Route: /getUserErrors
// Method: POST
// Description: Retrieve error logs for a specific user
app.post('/getUserErrors', async (req, res) => {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const doc = await db.collection('Errors').doc(String(user_id)).get();
    
    if (!doc.exists || !doc.data().errorLogs) {
      return res.status(200).json({ errorLogs: [] });
    }
    
    const errorLogs = doc.data().errorLogs;
    const logsArray = Array.isArray(errorLogs) ? errorLogs : Object.values(errorLogs);
    
    // Get only 5 latest errors
    const latestLogs = logsArray
      .sort((a, b) => 
        (b.timestamp?.toDate?.()?.getTime() || 0) - 
        (a.timestamp?.toDate?.()?.getTime() || 0)
      )
      .slice(0, 5); // Only take first 5
    
    res.status(200).json({ errorLogs: latestLogs });
  } catch (err) {
    console.error('Error in getUserErrors:', err);
    res.status(500).json({ 
      error: 'Failed to fetch user errors', 
      details: err.message 
    });
  }
});

// Route: /getUserStats
// Method: POST
// Description: Retrieve stats for a specific user
app.post('/getUserStats', async (req, res) => {
  const { user_id } = req.body;
  try {
    const doc = await db.collection('Stats').doc(String(user_id)).get();
    if (!doc.exists) {
      return res.status(404).json({ message: 'No stats found for this user' });
    }

    const data = doc.data();

    // ensure all keys exist with defaults
    const stats = {
      clean: data.clean || 0,
      energy: data.energy || 0,
      happiness: data.happiness || 0,
      health: data.health || 0,
      hunger: data.hunger || 0,
      in_bedroom: data.in_bedroom || false,
      is_sleeping: data.is_sleeping || false,
      updatedAt: data.updatedAt || new Date().toISOString()
    };

    res.status(200).json(stats);
  } catch (err) {
    res.status(500).send('Failed to fetch user stats');
  }
});
// Updated Wordle endpoints using Firestore
app.post('/checkWordle', async (req, res) => {
  try {
    const { userId } = req.body;
    const today = new Date().toISOString().split('T')[0];

    // Check for existing Wordle today using Firestore
    const snapshot = await db.collection('Wordle')
      .where('date', '==', today)
      .limit(1)
      .get();

    const wordle = snapshot.empty ? null : snapshot.docs[0].data();

    res.json({
      exists: !!wordle,
      wordle: wordle || null
    });
  } catch (error) {
    console.error("Check Wordle Error:", error);
    res.status(500).json({ error: "Failed to check Wordle" });
  }
});

app.post('/saveWordle', async (req, res) => {
  try {
    const { userId, wordle, status = "Unverified" } = req.body;
    const today = new Date().toISOString().split('T')[0];

    // First delete any existing Wordle for today (prevent duplicates)
    const snapshot = await db.collection('Wordle')
      .where('date', '==', today)
      .get();

    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Save new Wordle
    const docRef = await db.collection('Wordle').add({
      userId,
      wordle,
      status,
      date: today,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({ 
      success: true,
      wordleId: docRef.id
    });
  } catch (error) {
    console.error("Save Wordle Error:", error);
    res.status(500).json({ error: "Failed to save Wordle" });
  }
});

// Update the cleanup function to use Firestore
async function cleanupOldWordles() {
  try {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const snapshot = await db.collection('Wordle')
      .where('date', '<', yesterdayStr)
      .get();

    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    console.log(`Cleaned up ${snapshot.size} old Wordle entries`);
  } catch (error) {
    console.error("Wordle cleanup error:", error);
  }
}

// Add this before your server start code
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// === SERVER START ===
app.listen(3000, () => {
  console.log("Webhook server running on port 3000");
});
// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});