// server/routes/api/logs.js - Complete admin logging API routes with timezone support and user search logs
const express = require("express");
const { ensureAuthenticated } = require("../../middleware/auth");
const { database } = require("../../services/database");
const tz = require("../../utils/timezone");
const router = express.Router();

// Get database statistics with timezone formatting
router.get("/stats", ensureAuthenticated, async (req, res) => {
  try {
    const stats = await database.getStats();
    
    // Add timezone information to stats
    if (stats) {
      stats.timezone = tz.getTimezoneInfo();
      stats.generatedAt = {
        utc: tz.formatForDatabase(tz.now()),
        local: tz.formatDisplay(tz.now()),
        relative: 'Just now'
      };
    }
    
    res.json(stats);
  } catch (error) {
    console.error("Error getting database stats:", error);
    res.status(500).json({ error: "Failed to get database statistics" });
  }
});

// Get query statistics with optional date range and timezone support
router.get("/queries/stats", ensureAuthenticated, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await database.getQueryStats(parseInt(days, 10));
    
    // Add timezone context
    if (stats) {
      stats.timezone = tz.getTimezoneInfo();
      stats.generatedAt = tz.formatDisplay(tz.now());
    }
    
    res.json(stats);
  } catch (error) {
    console.error("Error getting query stats:", error);
    res.status(500).json({ error: "Failed to get query statistics" });
  }
});

// Get recent additions (artists and albums) with timezone formatting
router.get("/additions", ensureAuthenticated, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const additions = await database.getRecentAdditions(parseInt(limit, 10));
    res.json(additions);
  } catch (error) {
    console.error("Error getting recent additions:", error);
    res.status(500).json({ error: "Failed to get recent additions" });
  }
});

// Get raw query logs with pagination and timezone formatting
router.get("/queries", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 100, user_id, endpoint, days = 7 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    let query = `
      SELECT 
        id, timestamp, user_id, username, email, endpoint, method, search_term, 
        artist, album, mbid, response_status, response_time_ms, 
        cache_hit, ip_address, user_agent, search_type
      FROM query_log 
      WHERE timestamp >= ?
    `;
    
    const params = [sinceDate];

    if (user_id) {
      query += ` AND user_id = ?`;
      params.push(user_id);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), offset);

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display in user's timezone
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM query_log 
      WHERE timestamp >= ?
    `;
    
    const countParams = [sinceDate];

    if (user_id) {
      countQuery += ` AND user_id = ?`;
      countParams.push(user_id);
    }

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting query logs:", error);
    res.status(500).json({ error: "Failed to get query logs" });
  }
});

// Get artist additions with pagination and timezone formatting
router.get("/artists", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 50, days = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    const query = `
      SELECT 
        id, timestamp, user_id, artist_name, artist_mbid, 
        lidarr_artist_id, monitored, success, error_message
      FROM artist_additions 
      WHERE timestamp >= ?
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `;

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, [sinceDate, parseInt(limit, 10), offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM artist_additions 
      WHERE timestamp >= ?
    `;

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, [sinceDate], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting artist addition logs:", error);
    res.status(500).json({ error: "Failed to get artist addition logs" });
  }
});

// Get album additions with pagination and timezone formatting
router.get("/albums", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 50, days = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    const query = `
      SELECT 
        id, timestamp, user_id, album_title, album_mbid, artist_name, 
        artist_mbid, lidarr_album_id, lidarr_artist_id, monitored, 
        search_triggered, success, error_message, downloaded
      FROM album_additions 
      WHERE timestamp >= ?
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `;

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, [sinceDate, parseInt(limit, 10), offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM album_additions 
      WHERE timestamp >= ?
    `;

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, [sinceDate], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting album addition logs:", error);
    res.status(500).json({ error: "Failed to get album addition logs" });
  }
});

// Routes for filtered album queries
router.get("/albums/downloaded", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 50, days = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    const query = `
      SELECT 
        id, timestamp, user_id, album_title, album_mbid, artist_name, 
        artist_mbid, lidarr_album_id, lidarr_artist_id, monitored, 
        search_triggered, success, error_message, downloaded
      FROM album_additions 
      WHERE timestamp >= ? AND downloaded = 1
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `;

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, [sinceDate, parseInt(limit, 10), offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM album_additions 
      WHERE timestamp >= ? AND downloaded = 1
    `;

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, [sinceDate], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting downloaded album logs:", error);
    res.status(500).json({ error: "Failed to get downloaded album logs" });
  }
});

router.get("/albums/pending", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 50, days = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    const query = `
      SELECT 
        id, timestamp, user_id, album_title, album_mbid, artist_name, 
        artist_mbid, lidarr_album_id, lidarr_artist_id, monitored, 
        search_triggered, success, error_message, downloaded
      FROM album_additions 
      WHERE timestamp >= ? AND (downloaded = 0 OR downloaded IS NULL) AND success = 1
      ORDER BY timestamp DESC 
      LIMIT ? OFFSET ?
    `;

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, [sinceDate, parseInt(limit, 10), offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    const countQuery = `
      SELECT COUNT(*) as total 
      FROM album_additions 
      WHERE timestamp >= ? AND (downloaded = 0 OR downloaded IS NULL) AND success = 1
    `;

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, [sinceDate], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting pending album logs:", error);
    res.status(500).json({ error: "Failed to get pending album logs" });
  }
});

// Export logs as CSV with timezone-aware timestamps
router.get("/export/:type", ensureAuthenticated, async (req, res) => {
  try {
    const { type } = req.params;
    const { days = 30 } = req.query;

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));
    let query, filename;

    switch (type) {
      case 'auth-events':
        query = `
          SELECT 
            timestamp, event_type, user_id, username, email,
            ip_address, error_message, session_id, oidc_subject
          FROM auth_events 
          WHERE timestamp >= ?
          ORDER BY timestamp DESC
        `;
        filename = `auth_events_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'queries':
        query = `
          SELECT 
            timestamp, user_id, endpoint, method, search_term, 
            artist, album, response_status, response_time_ms, 
            ip_address
          FROM query_log 
          WHERE timestamp >= ? AND endpoint = '/api/musicbrainz/recording'
          ORDER BY timestamp DESC
        `;
        filename = `musicbrainz_recording_queries_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'artists':
        query = `
          SELECT 
            timestamp, user_id, username, email, artist_name, artist_mbid, 
            lidarr_artist_id, monitored, success, error_message, ip_address
          FROM artist_additions 
          WHERE timestamp >= ?
          ORDER BY timestamp DESC
        `;
        filename = `artist_additions_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      case 'albums':
        query = `
          SELECT 
            timestamp, user_id, username, email, album_title, album_mbid, 
            artist_name, artist_mbid, lidarr_album_id, lidarr_artist_id, 
            monitored, search_triggered, success, error_message, ip_address, downloaded
          FROM album_additions 
          WHERE timestamp >= ?
          ORDER BY timestamp DESC
        `;
        filename = `album_additions_${new Date().toISOString().split('T')[0]}.csv`;
        break;

      default:
        return res.status(400).json({ 
          error: "Invalid export type. Use: auth-events, queries, artists, or albums" 
        });
    }

    const rows = await new Promise((resolve, reject) => {
      database.db.all(query, [sinceDate], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    if (rows.length === 0) {
      return res.status(404).json({ error: "No data found for the specified period" });
    }

    // Format timestamps for CSV export (convert to user's timezone)
    const formattedRows = rows.map(row => ({
      ...row,
      timestamp: tz.formatDisplay(tz.fromISO(row.timestamp), {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
      }),
      // Parse search_data if it exists (for user-searches export)
      ...(row.search_data && { search_data: (() => {
        try {
          const parsed = JSON.parse(row.search_data);
          return `"${JSON.stringify(parsed).replace(/"/g, '""')}"`;
        } catch (e) {
          return row.search_data;
        }
      })() })
    }));

    // Convert to CSV
    const headers = Object.keys(formattedRows[0]);
    let csv = headers.join(',') + '\n';

    formattedRows.forEach(row => {
      const values = headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) {
          return '';
        }
        // Escape quotes and wrap in quotes if contains comma or quote
        const stringValue = String(value);
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return '"' + stringValue.replace(/"/g, '""') + '"';
        }
        return stringValue;
      });
      csv += values.join(',') + '\n';
    });

    // Add timezone info as comment at the top
    const timezoneInfo = tz.getTimezoneInfo();
    const csvWithHeader = `# Exported on ${timezoneInfo.currentTime} (${timezoneInfo.timezone})\n` + 
                         `# Export type: ${type}\n` +
                         `# Period: ${parseInt(days, 10)} days\n` +
                         `# Total records: ${formattedRows.length}\n` +
                         csv;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvWithHeader);

  } catch (error) {
    console.error("Error exporting logs:", error);
    res.status(500).json({ error: "Failed to export logs" });
  }
});

// Get authentication events with pagination and timezone formatting
router.get("/auth-events", ensureAuthenticated, async (req, res) => {
  try {
    const { page = 1, limit = 50, days = 30, event_type } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const sinceDate = tz.formatForDatabase(tz.daysAgo(parseInt(days, 10)));

    let query = `
      SELECT 
        id, timestamp, event_type, user_id, username, email,
        ip_address, error_message, session_id, oidc_subject
      FROM auth_events 
      WHERE timestamp >= ?
    `;
    
    const params = [sinceDate];

    if (event_type && ['login_success', 'login_failure', 'logout'].includes(event_type)) {
      query += ` AND event_type = ?`;
      params.push(event_type);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), offset);

    const logs = await new Promise((resolve, reject) => {
      database.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []); // Ensure we return an array
      });
    });

    // Format timestamps for display
    const formattedLogs = logs.map(log => ({
      ...log,
      timestamp: tz.formatForAPI(tz.fromISO(log.timestamp)),
      displayTime: tz.formatDisplay(tz.fromISO(log.timestamp), { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      relativeTime: tz.getRelativeTime(tz.fromISO(log.timestamp))
    }));

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM auth_events 
      WHERE timestamp >= ?
    `;
    
    const countParams = [sinceDate];

    if (event_type && ['login_success', 'login_failure', 'logout'].includes(event_type)) {
      countQuery += ` AND event_type = ?`;
      countParams.push(event_type);
    }

    const totalCount = await new Promise((resolve, reject) => {
      database.db.get(countQuery, countParams, (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.total : 0); // Handle undefined row
      });
    });

    res.json({
      logs: formattedLogs,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit, 10))
      },
      timezone: tz.getTimezoneInfo(),
      period: {
        days: parseInt(days, 10),
        since: tz.formatDisplay(tz.daysAgo(parseInt(days, 10)))
      }
    });

  } catch (error) {
    console.error("Error getting auth event logs:", error);
    res.status(500).json({ error: "Failed to get authentication event logs" });
  }
});

module.exports = router;
