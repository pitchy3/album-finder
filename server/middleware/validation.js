// server/middleware/validation.js - Input validation using Joi
const Joi = require('joi');

/**
 * Validation schemas for different endpoints
 */
const schemas = {
  // Authentication schemas
  basicAuthLogin: Joi.object({
    username: Joi.string()
      .min(1)
      .max(100)
      .pattern(/^[a-zA-Z0-9._-]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Username can only contain letters, numbers, dots, underscores, and hyphens',
        'string.min': 'Username must be at least 1 character',
        'string.max': 'Username must not exceed 100 characters'
      }),
    password: Joi.string()
      .min(16)
      .max(128)
      .required()
      .messages({
        'string.min': 'Password must be at least 16 characters',
        'string.max': 'Password must not exceed 128 characters'
      })
  }),

  // Lidarr configuration schemas
  lidarrConfig: Joi.object({
    url: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required()
      .messages({
        'string.uri': 'Must be a valid HTTP or HTTPS URL'
      }),
    apiKey: Joi.string()
      .pattern(/^[a-f0-9]{32}$/i)
      .required()
      .messages({
        'string.pattern.base': 'API key must be a 32-character hexadecimal string'
      }),
    rootFolder: Joi.string()
      .min(1)
      .max(500)
      .required()
      .messages({
        'string.min': 'Root folder path is required',
        'string.max': 'Root folder path is too long (max 500 characters)'
      }),
    qualityProfileId: Joi.number()
      .integer()
      .positive()
      .required()
      .messages({
        'number.base': 'Quality profile ID must be a number',
        'number.integer': 'Quality profile ID must be an integer',
        'number.positive': 'Quality profile ID must be positive'
      })
  }),

  lidarrTest: Joi.object({
    url: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required(),
    apiKey: Joi.string()
      .min(1)
      .max(100)
      .when('useSavedApiKey', {
        is: true,
        then: Joi.optional(),
        otherwise: Joi.required()
      }),
    useSavedApiKey: Joi.boolean()
      .optional()
  }),

  // OIDC configuration schemas
  oidcConfig: Joi.object({
    domain: Joi.string()
      .hostname()
      .required()
      .messages({
        'string.hostname': 'Must be a valid hostname (e.g., app.example.com)'
      }),
    issuerUrl: Joi.string()
      .uri({ scheme: ['http', 'https'] })
      .required()
      .messages({
        'string.uri': 'Must be a valid HTTP or HTTPS URL'
      }),
    clientId: Joi.string()
      .min(1)
      .max(200)
      .required()
      .messages({
        'string.min': 'Client ID is required',
        'string.max': 'Client ID is too long (max 200 characters)'
      }),
    clientSecret: Joi.string()
      .min(1)
      .max(500)
      .required()
      .messages({
        'string.min': 'Client secret is required',
        'string.max': 'Client secret is too long (max 500 characters)'
      })
  }),

  // BasicAuth configuration schemas
  basicAuthConfig: Joi.object({
    username: Joi.string()
      .min(1)
      .max(100)
      .pattern(/^[a-zA-Z0-9._-]+$/)
      .required()
      .messages({
        'string.pattern.base': 'Username can only contain letters, numbers, dots, underscores, and hyphens'
      }),
    password: Joi.string()
      .min(16)
      .max(128)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .required()
      .messages({
        'string.min': 'Password must be at least 16 characters',
        'string.max': 'Password must not exceed 128 characters',
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
      }),
    currentPassword: Joi.string()
      .min(16)
      .max(128)
      .optional()
  }),

  // Album/Music search schemas
  musicbrainzQuery: Joi.object({
    query: Joi.string()
      .min(1)
      .max(500)
      .required()
      .messages({
        'string.min': 'Search query is required',
        'string.max': 'Search query is too long (max 500 characters)'
      }),
    limit: Joi.alternatives()
      .try(
        Joi.number().integer().min(1).max(100),
        Joi.string().valid('all')
      )
      .optional()
      .messages({
        'alternatives.match': 'Limit must be a number between 1-100 or "all"'
      }),
    offset: Joi.number()
      .integer()
      .min(0)
      .max(10000)
      .optional()
  }),

  // Album addition schema
  addAlbum: Joi.object({
    mbid: Joi.string()
      .guid({ version: ['uuidv4'] })
      .required()
      .messages({
        'string.guid': 'Must be a valid MusicBrainz ID (UUID v4)'
      }),
    title: Joi.string()
      .min(1)
      .max(500)
      .required(),
    artist: Joi.string()
      .min(1)
      .max(500)
      .required()
  }),

  // Webhook payload schema (Lidarr)
  lidarrWebhook: Joi.object({
    eventType: Joi.string()
      .valid('Download', 'Grab', 'Rename', 'Test')
      .required(),
    artist: Joi.object({
      id: Joi.number().integer().optional(),
      name: Joi.string().optional(),
      path: Joi.string().optional(),
      mbId: Joi.string().guid().optional()
    }).optional(),
    album: Joi.object({
      id: Joi.number().integer().required(),
      title: Joi.string().required(),
      releaseDate: Joi.string().isoDate().optional()
    }).optional(),
    tracks: Joi.array().optional(),
    release: Joi.object().optional(),
    isUpgrade: Joi.boolean().optional()
  })
};

/**
 * Create validation middleware for a specific schema
 * 
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @param {string} source - Where to get data from ('body', 'query', 'params')
 * @returns {Function} Express middleware
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const data = req[source];
    
    const { error, value } = schema.validate(data, {
      abortEarly: false,      // Return all errors, not just the first
      stripUnknown: true,     // Remove unknown fields
      convert: true,          // Type conversion (string to number, etc.)
      presence: 'required'    // All fields required unless marked optional
    });
    
    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type
      }));
      
      console.warn('⚠️ Validation failed', {
        path: req.path,
        method: req.method,
        errors: errors
      });
      
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors
      });
    }
    
    // Replace request data with validated/sanitized value
    req[source] = value;
    
    next();
  };
}

/**
 * Sanitize string input (prevent XSS)
 * 
 * @param {string} input - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeString(input) {
  if (typeof input !== 'string') {
    return input;
  }
  
  return input
    .replace(/[<>]/g, '') // Remove < and > (basic XSS prevention)
    .trim()
    .substring(0, 10000); // Reasonable length limit
}

/**
 * Sanitize all string fields in an object
 * 
 * @param {object} obj - Object to sanitize
 * @returns {object} Sanitized object
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }
  
  const sanitized = Array.isArray(obj) ? [] : {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Middleware to sanitize all input
 */
function sanitizeInput(req, res, next) {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
}

/**
 * Validate file uploads (if implemented)
 */
const fileUploadSchema = Joi.object({
  mimetype: Joi.string()
    .valid('image/jpeg', 'image/png', 'image/gif', 'image/webp')
    .required(),
  size: Joi.number()
    .max(5 * 1024 * 1024) // 5MB max
    .required(),
  filename: Joi.string()
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .max(255)
    .required()
});

/**
 * Custom validators
 */
const customValidators = {
  // Validate MusicBrainz ID format
  isMBID: (value, helpers) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  },
  
  // Validate no SQL injection patterns
  noSqlInjection: (value, helpers) => {
    const sqlPatterns = [
      /(\s|^)(union|select|insert|update|delete|drop|create|alter|exec|execute)(\s|$)/i,
      /'(or|and).*?=/i,
      /[;][\s]*drop/i
    ];
    
    for (const pattern of sqlPatterns) {
      if (pattern.test(value)) {
        return helpers.error('any.invalid', { message: 'Potential SQL injection detected' });
      }
    }
    
    return value;
  }
};

module.exports = {
  validate,
  schemas,
  sanitizeString,
  sanitizeObject,
  sanitizeInput,
  fileUploadSchema,
  customValidators
};