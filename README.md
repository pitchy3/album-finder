# Album Finder

[![Test Suite](https://github.com/pitchy3/album-finder/actions/workflows/test.yml/badge.svg)](https://github.com/pitchy3/album-finder/actions/workflows/test.yml) [![Build and Publish Docker Image](https://github.com/pitchy3/album-finder/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/pitchy3/album-finder/actions/workflows/docker-publish.yml)

A production-ready web application for discovering and managing music albums with seamless MusicBrainz and Lidarr integration. Built with enterprise-grade security and scalability in mind.

## Features

### 🎵 Music Discovery
- **Dual Search Modes**
  - **Find by Song**: Search albums by track name and artist
  - **Browse Artist**: Explore complete artist discographies with streaming results
- **MusicBrainz Integration**: Comprehensive music metadata from MusicBrainz database
- **Cover Art**: Automatic cover art retrieval from Cover Art Archive and Lidarr
- **Smart Filtering**: Filter releases by type (Albums, EPs, Singles, Other)
- **Release Status**: Real-time Lidarr library status with download progress tracking
- **Streaming Search**: Progressive loading with visual feedback for large result sets

### 🎨 Modern User Interface
- **Dark/Light Mode**: Automatic theme detection with manual toggle
- **Responsive Design**: Optimized for desktop, tablet, and mobile devices
- **Progressive Loading**: Streaming search results with batch updates
- **User Preferences**: Persistent settings for search behavior and UI preferences
- **Activity Dashboard**: Comprehensive view of search history and additions

### 🔐 Enterprise Security
- **Flexible Authentication**
  - **OpenID Connect (OIDC)**: Enterprise SSO with providers like Authentik, Keycloak, Auth0
  - **Basic Authentication**: Simple username/password for self-hosted environments
  - **Optional Authentication**: Run without authentication for trusted networks
- **Advanced Security Features**
  - CSRF protection with double-submit cookies and origin validation
  - Secure session management with Redis backend
  - Token encryption for OIDC credentials (AES-256-GCM)
  - Rate limiting with progressive lockout for failed authentication attempts
  - Automatic token refresh for OIDC sessions
  - Secure password requirements (16+ chars, uppercase, number)
  - Input validation and sanitization
  - Security headers (CSP, HSTS, X-Frame-Options)
- **Session Management**: Redis-backed sessions with automatic cleanup
- **Activity Logging**: Comprehensive audit trail of user actions and authentication events

### 📊 Advanced Features
- **Multi-Layer Caching**: Redis and in-memory stores for optimal performance
- **Request Queue**: Fair scheduling system for concurrent users
- **Rate Limiting**: MusicBrainz API compliance with configurable delays
- **Webhook Support**: Real-time status updates from Lidarr for download completion
- **Activity Dashboard**: View search history, album/artist additions, and authentication logs
- **Download Retry**: Manual retry for failed downloads directly from logs page
- **Timezone Support**: Configurable timezone for accurate logging and display

### 🚀 Production Features
- **Horizontal Scaling**: Load balancer support for multiple instances
- **Docker Support**: Multi-stage builds with security best practices
- **Health Checks**: Built-in monitoring endpoints
- **Database Encryption**: Sensitive configuration data encrypted at rest
- **Graceful Shutdown**: Proper cleanup of resources and connections
- **Comprehensive Logging**: Structured logging with request tracking

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Lidarr instance (for music management)
- Optional: OIDC provider or BasicAuth credentials

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/pitchy3/album-finder.git
cd album-finder
```

2. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Application
NODE_ENV=production
APP_PORT=3001
TZ=America/Los_Angeles

# Session Security (REQUIRED - generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
SESSION_SECRET=your-cryptographically-secure-random-string-here

# Security Settings
COOKIE_SECURE=true          # Set to false ONLY for local dev without HTTPS
ENABLE_CSRF=true           # CSRF protection (recommended in production)
REQUIRE_HTTPS_AUTH=true    # Require HTTPS for authentication

# User/Group IDs for volume permissions
PUID=1000
PGID=1000

# Redis
REDIS_URL=redis://redis:6379

# Lidarr Webhook (optional - for download status updates)
LIDARR_WEBHOOK_KEY=your-secure-webhook-key-here

# Performance Tuning
CACHE_TTL=3600                    # Cache TTL in seconds (1 hour)
MAX_CACHE_SIZE=1000              # Maximum cache entries
MAX_CACHE_MEMORY=100             # Max cache memory in MB
MUSICBRAINZ_DELAY=1000           # Delay between MusicBrainz requests (ms)
MAX_CONCURRENT_REQUESTS=10       # Max concurrent API requests
REQUEST_TIMEOUT=30000            # Request timeout (ms)
```

3. **Start the application**
```bash
docker compose up -d
```

The init container will automatically fix volume permissions before the application starts.

4. **Access the application**
- Open http://localhost:3001
- Navigate to Settings (⚙️) to configure Lidarr and authentication

### First Time Setup

#### 1. Configure Lidarr (Settings → Lidarr Settings)
- Enter your Lidarr URL (e.g., `http://lidarr:8686`)
- Add your API key (found in Lidarr → Settings → General → Security)
- Test the connection to load quality profiles
- Select root folder and quality profile
- Save configuration

#### 2. Configure Authentication (Optional, Settings → Auth Settings)

**Option A: OpenID Connect (OIDC)**
1. Toggle authentication ON
2. Select "OpenID Connect (OIDC)" as authentication type
3. Enter your configuration:
   - **Domain**: Your application domain (e.g., `album.example.com`)
   - **OIDC Issuer**: Provider URL (e.g., `https://authentik.company.com/application/o/album-finder/`)
   - **Client ID**: From your OIDC provider
   - **Client Secret**: From your OIDC provider
4. Test the connection
5. Save configuration
6. Configure callback URL in your OIDC provider: `https://your-domain/auth/callback`

**Option B: Basic Authentication**
1. Toggle authentication ON
2. Select "Basic Authentication" as authentication type
3. Configure credentials:
   - **Username**: Your desired username (alphanumeric, dots, underscores, hyphens)
   - **Password**: Minimum 16 characters, must include uppercase letter and number
4. Save configuration

**Option C: No Authentication**
- Leave authentication toggle OFF
- Suitable for trusted networks or development only
- ⚠️ Not recommended for production deployments

#### 3. Configure User Preferences (Settings → Preferences)
- **Dark Mode**: Toggle theme (auto-detects system preference)
- **Artist Release Limit**: Number of releases to fetch (50/100/All)
- **Release Categories**: Filter types (Albums, EPs, Singles, Other)

#### 4. Start Searching!
- **Find by Song**: Search by track name and artist
- **Browse Artist**: Explore complete discographies with streaming results

## Architecture

### Technology Stack

**Frontend**
- React 18 with Hooks
- Vite for fast development and optimized builds
- TailwindCSS for responsive styling
- Context API for state management

**Backend**
- Node.js 18+ with Express
- SQLite for activity logging and audit trails
- Redis for session storage and caching
- NodeCache for in-memory caching layer

**Security**
- OpenID Connect (openid-client) for SSO
- bcrypt for password hashing (BasicAuth)
- @dr.pogodin/csurf for CSRF protection
- express-rate-limit with progressive lockout
- AES-256-GCM for token encryption

**Infrastructure**
- Docker multi-stage builds
- Redis for distributed sessions and caching
- Graceful shutdown handling
- Health check endpoints

### Project Structure
```
album-finder/
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/       # UI components
│   │   │   ├── config/      # Configuration UI (modular tabs)
│   │   │   ├── AlbumCard.jsx
│   │   │   ├── AuthConfirmationPage.jsx
│   │   │   ├── AuthLoadingScreen.jsx
│   │   │   ├── LoginPrompt.jsx
│   │   │   ├── LogsPage.jsx
│   │   │   └── UserHeader.jsx
│   │   ├── contexts/        # React contexts
│   │   │   └── PreferencesContext.jsx
│   │   ├── hooks/           # Custom hooks
│   │   │   ├── useAlbumSearch.js
│   │   │   ├── useArtistSearch.js
│   │   │   ├── useArtistSearchStream.js
│   │   │   ├── useAuth.js
│   │   │   ├── useAuthConfig.js
│   │   │   └── useLidarrConfig.js
│   │   └── services/        # API services
│   │       ├── albumEnrichmentService.js
│   │       ├── albumSearchService.js
│   │       ├── apiService.js (CSRF handling)
│   │       └── lidarrService.js
│   └── package.json
├── server/                   # Node.js backend
│   ├── config/              # Configuration management
│   │   └── index.js         # Dynamic runtime configuration
│   ├── middleware/          # Express middleware
│   │   ├── auth.js          # Authentication middleware
│   │   ├── csrf.js          # CSRF protection
│   │   ├── logging.js       # Request logging
│   │   ├── rateLimit.js     # Rate limiting with progressive lockout
│   │   ├── securityHeaders.js # Security headers (CSP, HSTS, etc.)
│   │   ├── session.js       # Session configuration
│   │   ├── tokenRefresh.js  # Automatic OIDC token refresh
│   │   └── validation.js    # Input validation with Joi
│   ├── routes/              # API routes
│   │   ├── api/
│   │   │   ├── config.js    # Configuration management
│   │   │   ├── coverart.js  # Cover Art Archive
│   │   │   ├── lidarr.js    # Lidarr integration
│   │   │   ├── logs.js      # Activity logging
│   │   │   └── musicbrainz.js # MusicBrainz API
│   │   ├── auth.js          # Authentication routes
│   │   └── webhook.js       # Lidarr webhooks
│   ├── services/            # Business logic
│   │   ├── auth.js          # Authentication service
│   │   ├── cache.js         # Caching layer
│   │   ├── configEncryption.js # Config encryption at rest
│   │   ├── database.js      # SQLite operations
│   │   ├── queue.js         # Request queue
│   │   ├── rateLimit.js     # Rate limiting logic
│   │   ├── redis.js         # Redis connection
│   │   └── tokenEncryption.js # Token encryption (AES-256-GCM)
│   ├── utils/               # Utilities
│   │   └── timezone.js      # Timezone handling
│   ├── data/                # Runtime data (volume mount)
│   │   ├── config.json      # Encrypted configuration
│   │   ├── albumfinder.db   # SQLite database
│   │   └── backups/         # Config backups
│   └── app.js               # Application entry point
├── docker-compose.yml        # Main compose file
├── Dockerfile               # Multi-stage build
└── .env                     # Environment configuration
```

### Security Architecture

**Authentication Flow**
```
User → Login → Authentication Provider → Callback → Session Creation → Application Access
                    ↓                                      ↓
              OIDC/BasicAuth                    Encrypted Token Storage
                                                 Redis Session Store
```

**Request Security Pipeline**
```
Client Request → Security Headers → CSRF Validation → Rate Limiting → 
Session Validation → Input Validation → Business Logic → Response
```

**Data Protection**
- Configuration at rest: AES-256-GCM encryption
- Tokens in session: AES-256-GCM encryption with scrypt key derivation
- Passwords: bcrypt with 12 rounds (BasicAuth)
- Session cookies: Secure, HttpOnly, SameSite=Strict

## Configuration

### Application Settings

All application settings are managed through the web interface (Settings page) and stored securely in `/app/server/data/config.json` with encryption for sensitive fields.

#### Lidarr Configuration
- **URL**: Lidarr instance URL (e.g., `http://lidarr:8686`)
- **API Key**: Found in Lidarr → Settings → General → Security → API Key
- **Root Folder**: Music storage location (must exist in Lidarr)
- **Quality Profile**: Default quality profile for new additions

#### Authentication Configuration

**OpenID Connect (OIDC)**
- **Domain**: Your application domain (without https://, e.g., `album.example.com`)
- **OIDC Issuer**: Provider URL (e.g., `https://authentik.company.com/application/o/album-finder/`)
- **Client ID**: Application identifier from OIDC provider
- **Client Secret**: Application secret from OIDC provider (encrypted at rest)
- **Callback URL**: Auto-generated as `https://{domain}/auth/callback`
- **Scopes**: `openid profile email` (default)
- **Token Refresh**: Automatic refresh 5 minutes before expiry

**Basic Authentication**
- **Username**: Alphanumeric with dots, underscores, hyphens (1-100 chars)
- **Password**: Minimum 16 characters, must include uppercase letter and number
- **Security**: bcrypt hashing with timing-attack protection

**Authentication Security Features**
- Progressive rate limiting (escalating lockouts after repeated failures)
- Session regeneration on login (prevent session fixation)
- Encrypted token storage (AES-256-GCM)
- Automatic logout on token expiration
- Activity logging for all authentication events

#### User Preferences
- **Dark Mode**: Toggle between light and dark themes
- **Release Limit**: Number of releases to fetch per artist (50/100/All)
- **Release Categories**: Filter by Albums, EPs, Singles, Other

### Environment Variables

#### Required Variables

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `SESSION_SECRET` | Session encryption key | ⚠️ **Required** | Generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |

#### Application Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `production` |
| `APP_PORT` | Application port | `3001` |
| `TZ` | Timezone (IANA format) | `UTC` |

#### Security Configuration

| Variable | Description | Default | Notes |
|----------|-------------|---------|-------|
| `COOKIE_SECURE` | Secure cookies (HTTPS) | `true` | Set to `false` only for local dev |
| `ENABLE_CSRF` | CSRF protection | `true` | Always enabled in production |
| `REQUIRE_HTTPS_AUTH` | Require HTTPS for auth | `true` | Reject auth over HTTP |

#### Redis Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_URL` | Redis connection URL | `redis://redis:6379` |

#### Performance Tuning

| Variable | Description | Default |
|----------|-------------|---------|
| `CACHE_TTL` | Cache duration (seconds) | `3600` |
| `MAX_CACHE_SIZE` | Max cache entries | `1000` |
| `MAX_CACHE_MEMORY` | Max cache memory (MB) | `100` |
| `MUSICBRAINZ_DELAY` | MB API delay (ms) | `1000` |
| `MAX_CONCURRENT_REQUESTS` | Concurrent requests | `10` |
| `REQUEST_TIMEOUT` | Request timeout (ms) | `30000` |

#### Optional Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `LIDARR_WEBHOOK_KEY` | Webhook auth key | None |
| `PUID` | User ID for volumes | `1000` |
| `PGID` | Group ID for volumes | `1000` |

### Security Best Practices

**Production Deployment**
```env
NODE_ENV=production
SESSION_SECRET=<64-character-hex-string>
COOKIE_SECURE=true
ENABLE_CSRF=true
REQUIRE_HTTPS_AUTH=true
```

**Development Environment**
```env
NODE_ENV=development
SESSION_SECRET=<any-32-char-string>
COOKIE_SECURE=false
ENABLE_CSRF=false
REQUIRE_HTTPS_AUTH=false
```

## API Documentation

### Interactive Documentation

The application includes Swagger UI for interactive API exploration:

**Access**: http://localhost:3001/api/docs

### Core Endpoints

#### Music Search
- `GET /api/musicbrainz/recording` - Search recordings by track and artist
- `GET /api/musicbrainz/release-group` - Search release groups by artist
- `GET /api/musicbrainz/release-group/stream` - Streaming artist discography search
- `GET /api/musicbrainz/release/:id` - Get release details by ID

#### Lidarr Integration
- `POST /api/lidarr/add` - Add artist/album to Lidarr
- `GET /api/lidarr/lookup` - Check album status in Lidarr
- `GET /api/lidarr/artist-status` - Check artist monitoring status
- `POST /api/lidarr/retry-download` - Retry failed album download
- `GET /api/lidarr/debug` - Test Lidarr connection

#### Cover Art
- `GET /api/coverart/:mbid` - Get cover art for release group

#### Activity Logs
- `GET /api/logs/queries` - User search history
- `GET /api/logs/albums` - Album addition history
- `GET /api/logs/albums/downloaded` - Downloaded albums
- `GET /api/logs/albums/pending` - Pending downloads
- `GET /api/logs/artists` - Artist addition history
- `GET /api/logs/auth-events` - Authentication event log
- `GET /api/logs/stats` - Activity statistics
- `GET /api/logs/export/:type` - Export logs as CSV

#### Configuration
- `GET /api/config/lidarr` - Get Lidarr config (sanitized)
- `POST /api/config/lidarr` - Update Lidarr config
- `POST /api/config/lidarr/test` - Test Lidarr connection
- `GET /api/config/auth` - Get auth config (sanitized)
- `POST /api/config/auth/oidc` - Update OIDC config
- `POST /api/config/auth/basicauth` - Update BasicAuth config
- `POST /api/config/auth/set-type` - Change auth type

#### Authentication
- `GET /auth/login` - Initiate OIDC login or show BasicAuth form
- `POST /auth/login/basicauth` - BasicAuth login endpoint
- `GET /auth/callback` - OIDC callback handler
- `POST /auth/logout` - Logout (works for both auth types)
- `GET /api/auth/user` - Get current user and auth status

#### Utility
- `GET /healthz` - Health check endpoint
- `GET /api/debug` - Debug information (authenticated)
- `GET /api/stats` - Server statistics (authenticated)
- `GET /api/csrf-token` - Get CSRF token
- `GET /api/timezone-info` - Get timezone information

### Webhook Endpoint

#### Lidarr Webhook
- `POST /webhook/lidarr` - Receive Lidarr events
  - Requires `x-api-key` header matching `LIDARR_WEBHOOK_KEY`
  - Handles: Download, Grab, Rename events
  - Updates album download status in database

## Advanced Usage

### Reverse Proxy Setup

#### Caddy (Recommended)

Caddy automatically handles HTTPS with Let's Encrypt:

```caddy
album.example.com {
    reverse_proxy album-finder:3000
    
    # Optional: Rate limiting
    rate_limit {
        zone album_finder {
            window 1m
            requests 100
        }
    }
}
```

#### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name album.example.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://album-finder:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support (if needed)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Webhook Configuration

Configure Lidarr to send download completion notifications:

1. In Lidarr → Settings → Connect → Add → Webhook
2. Configure:
   - **Name**: Album Finder
   - **URL**: `http://album-finder:3000/webhook/lidarr`
   - **Method**: POST
   - **Custom Headers**: `x-api-key: your-webhook-key-from-env`
3. Select triggers:
   - ✅ On Download
   - ✅ On Grab
   - ✅ On Rename
4. Save

The webhook automatically updates album download status in the database.

### Horizontal Scaling

Deploy multiple instances with Redis session sharing:

```bash
# Scale to 3 instances
docker compose up -d --scale album-finder=3
```

**Requirements**:
- Load balancer configured for sticky sessions
- Redis for shared session storage
- Shared volume for SQLite database (or migrate to PostgreSQL)

**Load Balancer Configuration** (example with nginx):
```nginx
upstream album_finder_backend {
    ip_hash;  # Sticky sessions
    server album-finder-1:3000;
    server album-finder-2:3000;
    server album-finder-3:3000;
}

server {
    listen 80;
    location / {
        proxy_pass http://album_finder_backend;
    }
}
```

### Database Operations

#### Backup Database
```bash
# Backup SQLite database
docker compose exec album-finder sqlite3 /app/server/data/albumfinder.db ".backup '/app/server/data/backup.db'"

# Copy backup to host
docker cp album-finder:/app/server/data/backup.db ./albumfinder-backup-$(date +%Y%m%d).db
```

#### Export Activity Logs

Via Web UI:
1. Navigate to Logs page
2. Select log type (Queries, Albums, Artists, Auth Events)
3. Click Export button
4. Choose date range
5. Download CSV

Via API:
```bash
# Export album additions
curl -H "Accept: text/csv" \
  http://localhost:3001/api/logs/export/albums?days=30 \
  > album-additions.csv

# Export authentication events
curl -H "Accept: text/csv" \
  http://localhost:3001/api/logs/export/auth-events?days=7 \
  > auth-events.csv
```

### Monitoring

#### Health Checks
```bash
# Basic health check
curl http://localhost:3001/healthz

# Detailed status
curl -u username:password http://localhost:3001/api/debug
```

#### Statistics
```bash
# Get server statistics
curl -u username:password http://localhost:3001/api/stats
```

#### Redis Monitoring

Enable Redis Commander (optional):
```bash
docker compose --profile monitoring up -d redis-commander
```
Access at http://localhost:8081

### Performance Optimization

#### Caching Strategy

The application uses a multi-layer caching approach:

1. **Redis Cache** (distributed, persistent)
   - Session data
   - API responses
   - Cross-instance sharing

2. **NodeCache** (in-memory, fast)
   - MusicBrainz responses (1 hour TTL)
   - Lidarr status checks (5 minutes TTL)
   - Cover art URLs (1 hour TTL)

3. **Browser Cache**
   - Static assets
   - Cover art images

#### Rate Limiting Configuration

Customize rate limits in `.env`:
```env
MUSICBRAINZ_DELAY=1000        # Increase for stricter compliance
MAX_CONCURRENT_REQUESTS=20    # Increase for more powerful servers
REQUEST_TIMEOUT=60000         # Increase for slow networks
```

#### Database Maintenance

```bash
# Vacuum database (reclaim space)
docker compose exec album-finder sqlite3 /app/server/data/albumfinder.db "VACUUM;"

# Analyze database (optimize queries)
docker compose exec album-finder sqlite3 /app/server/data/albumfinder.db "ANALYZE;"

# Check database integrity
docker compose exec album-finder sqlite3 /app/server/data/albumfinder.db "PRAGMA integrity_check;"
```

## Development

### Local Development Setup

1. **Install dependencies**
```bash
# Server
cd server && npm install

# Client
cd client && npm install
```

2. **Configure development environment**
```bash
cp .env.example .env.development
```

Edit `.env.development`:
```env
NODE_ENV=development
SESSION_SECRET=dev-secret-min-32-chars-long
COOKIE_SECURE=false
ENABLE_CSRF=false
REDIS_URL=redis://localhost:6379
```

3. **Start Redis** (required)
```bash
docker run -d -p 6379:6379 redis:7-alpine
```

4. **Run development servers**
```bash
# Terminal 1 - Backend (with hot reload)
cd server && npm run dev

# Terminal 2 - Frontend (with HMR)
cd client && npm run dev
```

5. **Access development servers**
- Frontend dev server: http://localhost:5173
- Backend API: http://localhost:3000
- Hot module replacement enabled for instant feedback

### Development Tools

#### Testing
```bash
# Run server tests
cd server && npm test

# Run client tests
cd client && npm test

# Run E2E tests (requires Docker)
npm run test:e2e
```

#### Code Quality
```bash
# Lint code
npm run lint

# Format code
npm run format
```

### Building for Production

```bash
# Build Docker image
docker build -t album-finder:latest .

# Or use docker-compose
docker compose build

# Test production build locally
docker compose -f docker-compose.yml up
```

### Project Guidelines

**Code Style**
- Use ESLint and Prettier configurations
- Follow existing patterns in codebase
- Write meaningful commit messages

**Security**
- Never commit secrets or API keys
- Use environment variables for configuration
- Follow security best practices

**Testing**
- Add tests for new features
- Ensure existing tests pass
- Test authentication flows thoroughly

## Troubleshooting

### Common Issues

#### Permission Errors on Data Directory

**Symptom**: `EACCES: permission denied` or `Cannot write to /app/server/data`

**Solution**:
```bash
# Check current permissions
docker compose exec album-finder ls -la /app/server/data

# Fix permissions using init container
docker compose up album-finder-init

# Or manually fix
docker compose exec --user root album-finder chown -R albumfinder:albumfinder /app/server/data
docker compose restart album-finder
```

#### Database Locked Errors

**Symptom**: `database is locked` errors

**Causes**:
- Multiple processes accessing database simultaneously
- Incomplete shutdown left lock file

**Solution**:
```bash
# Stop all containers
docker compose down

# Remove lock files
rm -f albumfinder-data/*.db-*

# Restart
docker compose up -d
```

#### Redis Connection Failures

**Symptom**: `Redis Client Error` or `ECONNREFUSED redis:6379`

**Solution**:
```bash
# Check Redis status
docker compose logs redis

# Restart Redis
docker compose restart redis

# Test Redis connection
docker compose exec redis redis-cli ping
# Should return: PONG

# Check Redis from app container
docker compose exec album-finder nc -zv redis 6379
```

#### OIDC Authentication Problems

**Symptom**: Authentication fails or loops back to login

**Common Causes & Solutions**:

1. **Incorrect Issuer URL**
   - Verify URL is accessible from server
   - Must end with trailing slash if required by provider
   - Test: `curl https://your-oidc-issuer/.well-known/openid-configuration`

2. **Callback URL Not Whitelisted**
   - Ensure `https://your-domain/auth/callback` is registered in OIDC provider
   - Match protocol (http/https) exactly
   - Check for typos in domain

3. **Session Issues**
   - Check Redis is running: `docker compose ps redis`
   - Verify `SESSION_SECRET` is set and persistent
   - Clear browser cookies and try again

4. **Token Encryption Errors**
   - Ensure `SESSION_SECRET` hasn't changed (will break existing sessions)
   - Check server logs for `Failed to decrypt` errors
   - Restart with fresh sessions: `docker compose restart album-finder`

**Debug Steps**:
```bash
# Check OIDC configuration
curl http://localhost:3001/api/config/auth

# View authentication logs
docker compose logs album-finder | grep "OIDC\|Auth"

# Test connection to OIDC provider
curl -v https://your-oidc-provider/.well-known/openid-configuration
```

#### BasicAuth Login Fails

**Symptom**: Invalid username or password despite correct credentials

**Solutions**:
1. **Check Password Requirements**
   - Minimum 16 characters
   - Must include uppercase letter
   - Must include number
   
2. **Progressive Lockout**
   - Account locks after 5 failed attempts
   - Wait for lockout to expire (starts at 30 seconds, escalates to hours)
   - Check logs: `docker compose logs album-finder | grep "lockout"`

3. **Re-enter Password**
   - If changing settings while logged in with BasicAuth, current password required
   - Navigate to Settings → Auth Settings → Current Password field

#### Search Timeout Errors

**Symptom**: `Request timeout` when browsing large artist discographies

**Solutions**:
1. **Reduce Release Limit**
   - Go to Settings → Preferences
   - Change "Artist Release Limit" from "All" to 50 or 100

2. **Increase Timeout** (in `.env`):
   ```env
   REQUEST_TIMEOUT=60000  # 60 seconds
   ```

3. **Filter Categories**
   - Go to Settings → Preferences → Release Categories
   - Disable categories you don't need (Singles, Other)

#### MusicBrainz Rate Limiting

**Symptom**: Slow searches or `429 Too Many Requests` errors

**Solutions**:
1. **Increase Delay Between Requests** (in `.env`):
   ```env
   MUSICBRAINZ_DELAY=1500  # 1.5 seconds (default: 1000ms)
   ```

2. **Reduce Concurrent Requests** (in `.env`):
   ```env
   MAX_CONCURRENT_REQUESTS=5  # Lower for better compliance
   ```

3. **Use Caching**
   - Results are cached automatically for 1 hour
   - Avoid repeated searches for the same artist

#### Lidarr Connection Issues

**Symptom**: `Connection refused` or `Invalid API key` when testing Lidarr

**Solutions**:
1. **Verify Lidarr URL**
   ```bash
   # Test from host
   curl http://localhost:8686/api/v1/system/status
   
   # Test from container
   docker compose exec album-finder curl http://lidarr:8686/api/v1/system/status
   ```

2. **Check API Key**
   - Copy EXACT key from Lidarr → Settings → General → Security → API Key
   - No spaces or extra characters
   - Re-enter in Album Finder settings

3. **Network Issues**
   - Ensure Lidarr is on same Docker network
   - Check firewall rules
   - Verify Lidarr is running: `docker compose ps lidarr`

4. **Authentication Timeout**
   - If using authentication, ensure you're logged in
   - Check session is valid: test with another API endpoint first

#### Webhook Not Working

**Symptom**: Album download status not updating automatically

**Verify Configuration**:
```bash
# 1. Check webhook key is set
docker compose exec album-finder env | grep LIDARR_WEBHOOK_KEY

# 2. Test webhook endpoint
curl -X POST \
  -H "x-api-key: your-webhook-key" \
  -H "Content-Type: application/json" \
  http://localhost:3001/webhook/lidarr \
  -d '{"eventType":"Test","artist":{"name":"Test"}}'

# 3. Check Lidarr logs for webhook errors
# In Lidarr UI: System → Logs
```

**Common Issues**:
- Webhook key mismatch between `.env` and Lidarr configuration
- Album Finder not reachable from Lidarr container
- Wrong URL in Lidarr (use container name, not localhost)

#### High Memory Usage

**Symptom**: Container using excessive memory

**Solutions**:
1. **Adjust Cache Settings** (in `.env`):
   ```env
   MAX_CACHE_MEMORY=50      # Reduce from 100MB
   MAX_CACHE_SIZE=500       # Reduce from 1000 entries
   ```

2. **Reduce Concurrent Requests**:
   ```env
   MAX_CONCURRENT_REQUESTS=5  # Lower limit
   ```

3. **Set Container Memory Limits** (in `docker-compose.yml`):
   ```yaml
   services:
     album-finder:
       deploy:
         resources:
           limits:
             memory: 512M  # Adjust as needed
   ```

4. **Clear Cache**:
   ```bash
   # Restart containers to clear in-memory cache
   docker compose restart album-finder redis
   ```

### Logs and Debugging

#### View Application Logs
```bash
# Follow all logs
docker compose logs -f

# Follow specific service
docker compose logs -f album-finder

# View last 100 lines
docker compose logs --tail=100 album-finder

# Search logs for errors
docker compose logs album-finder | grep -i error

# Search for authentication issues
docker compose logs album-finder | grep -i "auth\|login\|session"

# Search for CSRF issues
docker compose logs album-finder | grep -i csrf
```

#### Enable Debug Logging

Add to `.env`:
```env
NODE_ENV=development  # Enables more verbose logging
```

Restart:
```bash
docker compose restart album-finder
```

#### Check Service Health
```bash
# Check all services
docker compose ps

# Check specific service health
docker compose ps album-finder

# Test health endpoint
curl http://localhost:3001/healthz
```

#### Database Inspection
```bash
# Open SQLite shell
docker compose exec album-finder sqlite3 /app/server/data/albumfinder.db

# View recent queries
sqlite> SELECT * FROM query_log ORDER BY timestamp DESC LIMIT 10;

# View recent album additions
sqlite> SELECT * FROM album_additions ORDER BY timestamp DESC LIMIT 10;

# View authentication events
sqlite> SELECT * FROM auth_events ORDER BY timestamp DESC LIMIT 10;

# Check table schemas
sqlite> .schema query_log
sqlite> .schema album_additions
sqlite> .schema auth_events

# Exit
sqlite> .exit
```

### Getting Help

If you encounter issues not covered here:

1. **Check logs** for error messages
2. **Search existing issues** on GitHub
3. **Create a new issue** with:
   - Description of the problem
   - Steps to reproduce
   - Relevant log excerpts (sanitize sensitive data)
   - Environment details (OS, Docker version, etc.)

## Security Considerations

### Production Deployment Checklist

- [ ] Generate strong `SESSION_SECRET` (64+ character random hex)
- [ ] Set `COOKIE_SECURE=true`
- [ ] Set `ENABLE_CSRF=true`
- [ ] Set `REQUIRE_HTTPS_AUTH=true`
- [ ] Deploy behind HTTPS reverse proxy (Caddy, Nginx)
- [ ] Configure authentication (OIDC or BasicAuth)
- [ ] Set secure `LIDARR_WEBHOOK_KEY`
- [ ] Review and restrict network access
- [ ] Enable firewall rules
- [ ] Regular database backups
- [ ] Monitor authentication logs for suspicious activity
- [ ] Keep Docker images updated

### Security Features

**Authentication**
- Progressive rate limiting (3+ failures = 30s lockout, escalates to hours)
- Session regeneration on login (prevents session fixation)
- Secure password requirements (16+ chars, complexity rules)
- Timing-attack protection for password comparison
- Comprehensive authentication event logging

**Session Security**
- Redis-backed distributed sessions
- Secure, HttpOnly, SameSite=Strict cookies
- Automatic session expiration
- Session ID regeneration on privilege escalation

**Data Protection**
- Configuration encrypted at rest (AES-256-GCM)
- OIDC tokens encrypted in session (AES-256-GCM with scrypt key derivation)
- Database file permissions (0600 - owner read/write only)
- Sensitive fields obfuscated in API responses

**Network Security**
- CSRF protection with double-submit cookies and origin validation
- Security headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Rate limiting on all API endpoints
- Input validation and sanitization
- SQL injection prevention (parameterized queries)

**Monitoring**
- Comprehensive activity logging
- Authentication event tracking
- Failed login attempt monitoring
- Session activity audit trail

### Vulnerability Disclosure

If you discover a security vulnerability, please:

1. **DO NOT** open a public GitHub issue
2. Email security details privately
3. Include steps to reproduce
4. Allow reasonable time for patch development

## Contributing

Contributions are welcome! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Set up development environment (see Development section)
4. Make your changes
5. Add tests for new functionality
6. Ensure all tests pass
7. Update documentation as needed
8. Commit changes (`git commit -m 'Add amazing feature'`)
9. Push to branch (`git push origin feature/amazing-feature`)
10. Open a Pull Request

### Development Guidelines

**Code Style**
- Follow existing code patterns and conventions
- Use ESLint and Prettier configurations
- Write self-documenting code with clear variable names
- Add comments for complex logic

**Security**
- Never commit secrets, API keys, or sensitive data
- Use environment variables for configuration
- Follow OWASP security best practices
- Sanitize all user inputs
- Use parameterized queries for database operations

**Testing**
- Write tests for new features and bug fixes
- Maintain or improve code coverage
- Test authentication flows thoroughly
- Include integration tests for API endpoints
- Test edge cases and error conditions

**Documentation**
- Update README.md for new features
- Add JSDoc comments for functions
- Update API documentation (Swagger/OpenAPI)
- Include usage examples

**Commit Messages**
- Use clear, descriptive commit messages
- Format: `type(scope): description`
- Types: feat, fix, docs, style, refactor, test, chore
- Example: `feat(auth): add BasicAuth support`

### Pull Request Process

1. Update CHANGELOG.md with your changes
2. Ensure Docker build succeeds
3. Update documentation as needed
4. Link related issues in PR description
5. Request review from maintainers
6. Address review feedback promptly

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [MusicBrainz](https://musicbrainz.org/) - Comprehensive music metadata database
- [Cover Art Archive](https://coverartarchive.org/) - Album cover art repository
- [Lidarr](https://lidarr.audio/) - Music collection manager
- [React](https://react.dev/) - UI framework
- [Express](https://expressjs.com/) - Web framework for Node.js
- [Redis](https://redis.io/) - In-memory data store
- [TailwindCSS](https://tailwindcss.com/) - Utility-first CSS framework
- Open-source community for invaluable tools and libraries

## Support

### Getting Help

- **Documentation**: [GitHub Wiki](https://github.com/pitchy3/album-finder/wiki)
- **Issues**: [GitHub Issues](https://github.com/pitchy3/album-finder/issues)
- **Discussions**: [GitHub Discussions](https://github.com/pitchy3/album-finder/discussions)

### Reporting Bugs

When reporting bugs, please include:
- Description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, Docker version, Node version)
- Relevant log excerpts (sanitize sensitive information)
- Screenshots if applicable

### Feature Requests

Feature requests are welcome! Please:
- Check if the feature already exists or is planned
- Describe the feature and use case
- Explain why it would be valuable
- Consider implementation complexity

---

**Note**: This application requires an active internet connection for MusicBrainz API access and a configured Lidarr instance for music management features. Authentication is optional but strongly recommended for production deployments.