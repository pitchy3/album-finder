// server/routes/webhook.js - Fixed webhook implementation for download tracking
const express = require("express");
const { cache } = require("../services/cache");
const { requestQueue } = require("../services/queue");
const { database } = require("../services/database");

const router = express.Router();

const LIDARR_WEBHOOK_KEY = process.env.LIDARR_WEBHOOK_KEY;

async function handleDownload(payload) {
  const artistName = payload.artist?.name;
  const album = payload.album; // This is a single object, not an array

  if (!album) {
    console.warn("No album found in payload, skipping DB update");
    return;
  }

  const lidarrAlbumId = album.id; // Get the album ID directly
  const albumTitle = album.title;

  console.log("Download complete:", artistName, albumTitle, "(Lidarr Album ID:", lidarrAlbumId, ")");

  try {
    // Check if any rows exist with this lidarr_album_id using the promisified method
    const existing = await database.all(
      "SELECT id, album_title FROM album_additions WHERE lidarr_album_id = ?",
      [lidarrAlbumId]
    );

    if (!existing || existing.length === 0) {
      console.log("No matching albums found in DB for lidarr_album_id:", lidarrAlbumId);
      return;
    }

    console.log(`Found ${existing.length} matching album(s) in database:`, 
      existing.map(e => `${e.album_title} (DB ID: ${e.id})`));

    // Update all matching rows to mark as downloaded using the promisified method
    const updateResult = await database.run(
      `UPDATE album_additions 
       SET downloaded = 1, success = 1 
       WHERE lidarr_album_id = ?`,
      [lidarrAlbumId]
    );

    console.log(
      `✅ Marked ${existing.length} album(s) as downloaded for lidarr_album_id=${lidarrAlbumId}`
    );
    console.log(`📊 Database rows affected: ${updateResult.changes}`);

  } catch (err) {
    console.error("❌ Error updating album as downloaded:", err);
  }
}

async function handleGrab(payload) {
  console.log("Track grabbed:", payload.artist?.name, payload.album?.title);
  // 👉 Add your custom logic here
}

async function handleRename(payload) {
  console.log("Files renamed:", payload.artist?.name);
  // 👉 Add your custom logic here
}

function checkApiKey(req, res, next) {
  const apiKey = req.header("x-webhook-key"); // Lidarr will send this header
  if (!apiKey || apiKey !== LIDARR_WEBHOOK_KEY) {
    console.warn("❌ Webhook API key validation failed:", {
      provided: apiKey ? `***${apiKey.slice(-4)}` : 'none',
      expected: LIDARR_WEBHOOK_KEY ? `***${LIDARR_WEBHOOK_KEY.slice(-4)}` : 'none'
    });
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Lidarr webhook endpoint (protected)
router.post("/lidarr", checkApiKey, async (req, res) => {
  try {
    const eventType = req.body.eventType;
    console.log("🎵 Lidarr webhook received:", eventType);
    
    // Log some key details for debugging (without full payload)
    if (req.body.album) {
      console.log("📀 Album details:", {
        id: req.body.album.id,
        title: req.body.album.title,
        artist: req.body.artist?.name
      });
    }

    switch (eventType) {
      case "Download":
        await handleDownload(req.body);
        break;
      case "Grab":
        await handleGrab(req.body);
        break;
      case "Rename":
        await handleRename(req.body);
        break;
      default:
        console.log(`❓ Unhandled Lidarr event: ${eventType}`);
    }

    res.status(200).json({ status: "ok", eventType });
  } catch (err) {
    console.error("💥 Error handling Lidarr webhook:", err);
    res.status(500).json({ error: "internal server error" });
  }
});

// Health check endpoint for webhooks
router.get("/health", (req, res) => {
  res.status(200).json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    webhook_key_configured: !!LIDARR_WEBHOOK_KEY 
  });
});

module.exports = router;
