# Album Finder

A modern, scalable web application for discovering and managing music albums with seamless MusicBrainz and Lidarr integration.

## Features

### 🎵 Music Discovery
- **Dual Search Modes**
  - Find albums by song and artist
  - Browse complete artist discographies
- **MusicBrainz Integration** - Access comprehensive music metadata
- **Cover Art** - Automatic cover art retrieval from Cover Art Archive
- **Smart Filtering** - Filter releases by type (Albums, EPs, Singles, Other)
- **Release Status** - Real-time Lidarr library status with download progress

### 🎨 Modern Interface
- **Dark/Light Mode** - Automatic theme switching with system preference detection
- **Responsive Design** - Optimized for desktop and mobile
- **Progressive Loading** - Streaming search results for fast feedback
- **User Preferences** - Persistent search settings and UI preferences

### 🔐 Multi-User Support
- **OpenID Connect (OIDC)** - Enterprise-grade authentication
- **Session Management** - Secure Redis-backed sessions
- **Activity Logging** - Comprehensive user action tracking
- **Per-User Analytics** - Search history and addition logs

### 📊 Advanced Features
- **Intelligent Caching** - Multi-layer caching with Redis and in-memory stores
- **Request Queue** - Fair scheduling for concurrent users
- **Rate Limiting** - MusicBrainz API compliance
- **Webhook Support** - Automatic status updates from Lidarr
- **Activity Dashboard** - View search history, additions, and authentication events

### 🚀 Production Ready
- **Scalable Architecture** - Horizontal scaling support with load balancing
- **Docker Support** - Complete containerization with docker-compose
- **Health Checks** - Built-in monitoring endpoints
- **Timezone Support** - Configurable timezone for logging and display
- **Database Logging** - SQLite-based activity tracking

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Lidarr instance (for music management)
- Optional: OIDC provider for authentication

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/album-finder.git
cd album-finder
```

2. **Configure environment variables**
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Application
APP_PORT=3001
TZ=America/Los_Angeles

# Session Security
SESSION_SECRET=your-super-secret-session-key-here-change-me

# Lidarr Webhook (optional)
LIDARR_WEBHOOK_KEY=your-webhook-key-here
```

3. **Start the application**
```bash
docker-compose up -d
```

4. **Access the application**
- Open http://localhost:3001
- Navigate to Settings to configure Lidarr and OIDC

### First Time Setup

1. **Configure Lidarr** (Settings → Lidarr Settings)
   - Enter your Lidarr URL and API key
   - Select root folder and quality profile
   - Test connection

2. **Optional: Configure Authentication** (Settings → Auth Settings)
   - Enter domain, OIDC issuer URL, client ID, and secret
   - Test connection
   - Save configuration

3. **Start Searching!**
   - Use "Find by Song" to search by track name
   - Use "Browse Artist" to explore complete discographies

## Architecture

### Technology Stack
- **Frontend**: React 18 with Vite, TailwindCSS
- **Backend**: Node.js 18+ with Express
- **Database**: SQLite (activity logging)
- **Cache**: Redis + NodeCache
- **Authentication**: OpenID Connect
- **Container**: Docker with multi-stage builds

### Project Structure
```
album-finder/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── contexts/      # React contexts (preferences)
│   │   ├── hooks/         # Custom hooks
│   │   └── services/      # API services
│   └── package.json
├── server/                # Node.js backend
│   ├── config/           # Configuration
│   ├── middleware/       # Express middleware
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   └── utils/            # Utilities
├── docker-compose.yml    # Main compose file
└── Dockerfile           # Multi-stage build
```

## Configuration

### Application Settings

Settings are managed through the web interface (Settings page) and stored in `/app/server/data/config.json`.

#### Lidarr Configuration
- **URL**: Lidarr instance URL (e.g., `http://lidarr:8686`)
- **API Key**: Found in Lidarr → Settings → General → Security
- **Root Folder**: Music storage location
- **Quality Profile**: Default quality profile for new additions

#### Authentication Configuration
- **Domain**: Your application domain (e.g., `album.example.com`)
- **OIDC Issuer**: OpenID Connect provider URL
- **Client ID/Secret**: OIDC application credentials
- **Scopes**: `openid profile email` (default)

#### User Preferences
- **Dark Mode**: Toggle dark/light theme
- **Release Limit**: Number of releases to fetch (50/100/All)
- **Release Categories**: Filter by Albums, EPs, Singles, Other

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_PORT` | Application port | `3001` |
| `NODE_ENV` | Environment mode | `production` |
| `TZ` | Timezone (IANA format) | `UTC` |
| `SESSION_SECRET` | Session encryption key | ⚠️ Required |
| `REDIS_URL` | Redis connection URL | `redis://redis:6379` |
| `LIDARR_WEBHOOK_KEY` | Webhook authentication key | Optional |
| `CACHE_TTL` | Cache duration (seconds) | `3600` |
| `MAX_CONCURRENT_REQUESTS` | Concurrent API limit | `10` |

## API Documentation

The application includes interactive API documentation via Swagger UI.

**Access**: http://localhost:3001/api/docs

### Key Endpoints

#### Music Search
- `GET /api/musicbrainz/recording` - Search recordings
- `GET /api/musicbrainz/release-group` - Search release groups
- `GET /api/musicbrainz/release-group/stream` - Streaming artist search

#### Lidarr Integration
- `POST /api/lidarr/add` - Add artist/album to Lidarr
- `GET /api/lidarr/lookup` - Check album status
- `POST /api/lidarr/retry-download` - Retry failed downloads

#### Activity Logs
- `GET /api/logs/queries` - Search history
- `GET /api/logs/albums` - Album additions
- `GET /api/logs/artists` - Artist additions
- `GET /api/logs/auth-events` - Authentication events

## Advanced Usage

### Scaling with Multiple Instances

Use the scaling compose file for load balancing:

```bash
docker-compose -f docker-compose.yml -f docker-compose.scale.yml up -d
```

This creates 3 application instances behind a load balancer.

### Webhook Configuration

Configure Lidarr to send webhook notifications:

1. In Lidarr → Settings → Connect → Add → Webhook
2. Set URL: `http://album-finder:3000/webhook/lidarr`
3. Add custom header: `x-api-key: your-webhook-key`
4. Select triggers: Download, Grab, Rename

### Database Management

**Initialize database** (first run or after schema changes):
```bash
docker-compose exec album-finder node server/scripts/init-database.js
```

**Update schema** (for migrations):
```bash
docker-compose exec album-finder node server/scripts/update-database-schema.js
```

**Export logs**:
```bash
# Access via web UI: Logs → Export button
# Or via API: GET /api/logs/export/{type}
```

### Reverse Proxy Setup

Example Caddy configuration:

```caddy
album.example.com {
    reverse_proxy album-finder:3000
}
```

Example Nginx configuration:

```nginx
server {
    listen 443 ssl;
    server_name album.example.com;
    
    location / {
        proxy_pass http://album-finder:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
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

2. **Run development servers**
```bash
# Terminal 1 - Backend
cd server && npm run dev

# Terminal 2 - Frontend
cd client && npm run dev
```

3. **Access development server**
- Frontend: http://localhost:5173
- Backend: http://localhost:3000

### Building for Production

```bash
# Build Docker image
docker build -t album-finder:latest .

# Or use docker-compose
docker-compose build
```

## Troubleshooting

### Common Issues

**Database Permission Errors**
```bash
# Check data directory permissions
ls -la server/data

# Fix permissions
chmod -R 777 server/data
chown -R 1000:1000 server/data
```

**Redis Connection Issues**
```bash
# Check Redis status
docker-compose logs redis

# Test Redis connection
docker-compose exec redis redis-cli ping
```

**OIDC Authentication Problems**
1. Verify issuer URL is accessible
2. Check client ID and secret are correct
3. Ensure callback URL is whitelisted: `https://your-domain/auth/callback`
4. Review logs: `docker-compose logs album-finder`

**Search Timeout Errors**
- Reduce release limit in preferences
- Check MusicBrainz rate limiting
- Verify network connectivity

### Logs

**View application logs**:
```bash
docker-compose logs -f album-finder
```

**View all service logs**:
```bash
docker-compose logs -f
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure Docker build succeeds

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [MusicBrainz](https://musicbrainz.org/) - Music metadata database
- [Cover Art Archive](https://coverartarchive.org/) - Album cover art
- [Lidarr](https://lidarr.audio/) - Music collection manager
- React, Express, and the open-source community

## Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/album-finder/issues)
- **Documentation**: [Wiki](https://github.com/yourusername/album-finder/wiki)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/album-finder/discussions)

---

**Note**: This application requires an active internet connection for MusicBrainz API access and a configured Lidarr instance for music management features.