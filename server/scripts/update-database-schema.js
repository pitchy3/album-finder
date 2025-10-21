#!/usr/bin/env node
// server/scripts/update-database-schema.js - Add search_type column to fix logging errors

const { database } = require('../services/database');

async function updateDatabaseSchema() {
  console.log('🔧 Updating database schema to add search_type field...');
  
  try {
    // Initialize database connection
    await database.initialize();
    
    // Check if column already exists first
    const checkQuery = `PRAGMA table_info(query_log)`;
    
    // Get current table structure
    const tableInfo = await new Promise((resolve, reject) => {
      database.db.all(checkQuery, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    
    console.log('📋 Current query_log table columns:', tableInfo.map(col => col.name).join(', '));
    
    // Check if search_type column already exists
    const hasSearchType = tableInfo.some(col => col.name === 'search_type');
    
    if (!hasSearchType) {
      console.log('➕ Adding search_type column to query_log table...');
      
      // Add the column
      const alterQuery = `ALTER TABLE query_log ADD COLUMN search_type TEXT DEFAULT NULL`;
      
      await new Promise((resolve, reject) => {
        database.db.run(alterQuery, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log('✅ Added search_type column to query_log table');
      
      // Add index for better performance
      const indexQuery = `CREATE INDEX IF NOT EXISTS idx_query_log_search_type ON query_log(search_type)`;
      
      await new Promise((resolve, reject) => {
        database.db.run(indexQuery, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      console.log('✅ Added index for search_type column');
      
      // Verify the update
      const updatedTableInfo = await new Promise((resolve, reject) => {
        database.db.all(checkQuery, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      console.log('📋 Updated query_log table columns:', updatedTableInfo.map(col => col.name).join(', '));
      
    } else {
      console.log('ℹ️  search_type column already exists, skipping...');
    }
    
    console.log('✅ Database schema update completed successfully!');
    
    // Log a test entry to verify the fix
    await database.logQuery({
      userId: 'schema-update-test',
      endpoint: '/test',
      method: 'GET',
      responseStatus: 200,
      responseTime: 100,
      cacheHit: false,
      searchType: 'test_search'
    });
    
    console.log('✅ Test log entry created successfully with search_type field');
    
  } catch (error) {
    console.error('❌ Database schema update failed:', error);
    throw error;
  } finally {
    await database.close();
  }
}

// Run if called directly
if (require.main === module) {
  updateDatabaseSchema()
    .then(() => {
      console.log('🎉 Schema update complete! Logging errors should be resolved.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Schema update failed:', error);
      process.exit(1);
    });
}

module.exports = { updateDatabaseSchema };
