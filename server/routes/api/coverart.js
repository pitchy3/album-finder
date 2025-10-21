// server/routes/api/coverart.js - Cover Art Archive routes
const express = require("express");
const { ensureAuthenticated } = require("../../middleware/auth");
const { queuedApiCall } = require("../../services/queue");
const { cachedFetch } = require("../../services/cache");

const router = express.Router();

// Cover Art Archive proxy
router.get("/:mbid", ensureAuthenticated, async (req, res) => {
  await queuedApiCall(req, res, async () => {
    const { mbid } = req.params;
    
    return await cachedFetch('coverart', { mbid }, async () => {
      const url = `https://coverartarchive.org/release-group/${mbid}`;
	  const debugLogging = false;
      if (debugLogging) {
        console.log("🖼️ Cover art lookup:", url);
	  }

      const response = await fetch(url);
      
      if (!response.ok) {
        if (response.status === 404) {
          // Coverartarchive throws a 404 if no coverart exists for a given mbid
		  // Normalize to a valid CAA-like response with no images.
          return { images: [] };
        }
        console.error("❌ Cover art lookup failed:", response.status, response.statusText);
        throw new Error(`Cover art error: ${response.statusText}`);
      }

      return await response.json();
    });
  });
});

module.exports = router;