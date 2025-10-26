# API Routes Documentation Summary

This document summarizes the API routes for a music application that integrates with MusicBrainz, Lidarr, and provides authentication via OIDC.

## Authentication System

The application uses OpenID Connect (OIDC) for authentication with the following endpoints:

### Auth Routes (`/auth`)
- **GET `/auth/login`** - Initiates OIDC login flow with PKCE
- **GET `/auth/callback`** - Handles OIDC callback and token validation
- **POST `/auth/logout`** - Destroys session and redirects to OIDC logout
- **GET `/auth/debug`** - Returns authentication status and configuration info

All API routes require authentication except `/api/auth/user`, `/api/debug`, and configuration test endpoints.

## Core API Routes (`/api`)

### System & Status
- **GET `/api/auth/user`** - Public endpoint returning user login status
- **GET `/api/me`** - Returns current user information (authenticated)
- **GET `/api/debug`** - Comprehensive system status including Redis, cache, queue, and memory metrics
- **GET `/api/stats`** - Detailed statistics for authenticated users

## Music Data APIs

### MusicBrainz Integration (`/api/musicbrainz`)
All endpoints require authentication and support caching with rate limiting.

- **GET `/api/musicbrainz/recording`** - Search recordings
  - Query params: `query` (required), `limit` (default: 10)
  - Returns: MusicBrainz recording data with releases and artist credits

- **GET `/api/musicbrainz/release-group`** - Search release groups (albums)
  - Query params: `query` (required), `limit` (default: 20)
  - Returns: Release group search results

- **GET `/api/musicbrainz/release/:id`** - Get release details by ID
  - Path params: `id` (MBID)
  - Query params: `inc` (inclusions, default: "release-groups")
  - Returns: Detailed release information

- **GET `/api/musicbrainz/release`** - Get releases by release-group
  - Query params: `release-group` (required), `inc` (default: "recordings")
  - Returns: All releases for a release group

### Cover Art (`/api/coverart`)
- **GET `/api/coverart/:mbid`** - Get cover art for release group
  - Path params: `mbid` (MusicBrainz release group ID)
  - Returns: Cover Art Archive data or 404 if not found

## Lidarr Integration (`/api/lidarr`)

### Library Management
- **GET `/api/lidarr/lookup`** - Check if album exists in Lidarr library
  - Query params: `mbid` (required), `title`, `artist`
  - Returns: Album data with library status (`inLibrary`, `fullyAvailable`, `percentComplete`)

- **GET `/api/lidarr/lookup-search`** - Alternative lookup method using direct search
  - Same parameters as `/lookup`
  - Uses different internal strategy for checking library status

- **POST `/api/lidarr/add`** - Add artist and monitor specific album
  - Body: `mbid` (required), `title`, `artist`
  - Process: Looks up album → Checks if artist exists → Adds artist if needed → Monitors specific album → Triggers search
  - Returns: Success message with artist/album details

## Configuration Management (`/api/config`)

### Lidarr Configuration
- **GET `/api/config/lidarr`** - Get current Lidarr settings (sanitized)
- **POST `/api/config/lidarr`** - Update Lidarr configuration
  - Body: `url`, `apiKey`, `rootFolder`, `qualityProfileId`
- **POST `/api/config/lidarr/test`** - Test Lidarr connection
  - Body: `url`, `apiKey`, `useSavedApiKey` (optional)
  - Returns: Connection status and quality profiles
- **POST `/api/config/lidarr/rootfolders`** - Get available root folders
  - Body: `url`, `apiKey`, `useSavedApiKey` (optional)

### Authentication Configuration
- **GET `/api/config/auth`** - Get OIDC configuration (sanitized)
- **POST `/api/config/auth`** - Update OIDC settings
  - Body: `issuerUrl`, `clientId`, `clientSecret`, `domain`
  - Validates configuration and reinitializes OIDC client
- **POST `/api/config/auth/test`** - Test OIDC configuration (no auth required)
  - Body: `issuerUrl`, `clientId` (optional), `clientSecret` (optional), `domain` (optional)

## Admin Routes (`/admin`)

- **GET `/admin/cache/stats`** - Get cache statistics
- **DELETE `/admin/cache/flush`** - Clear all cache data
- **GET `/admin/queue/stats`** - Get request queue statistics

## Key Features

### Security
- All sensitive API keys and secrets are masked in responses
- OIDC tokens are encrypted before storage in sessions
- Comprehensive ID token validation with nonce, issuer, audience checks
- PKCE (Proof Key for Code Exchange) implementation for authorization code flow

### Performance
- Request queuing system to manage API rate limits
- Comprehensive caching for MusicBrainz and Lidarr responses
- Redis integration for scalable session storage
- Rate limiting for external API calls

### Error Handling
- Detailed error responses with appropriate HTTP status codes
- Graceful fallbacks for missing configuration
- Comprehensive logging throughout request lifecycle

### Lidarr Integration Logic
The Lidarr add process is sophisticated:
1. Looks up album metadata from MusicBrainz ID
2. Checks if artist already exists in Lidarr
3. If artist exists but album missing, triggers artist refresh
4. If artist doesn't exist, adds artist with monitoring disabled
5. Finds and monitors the specific requested album
6. Triggers search for missing files
7. Invalidates relevant cache entries

This ensures minimal library bloat by only monitoring requested albums rather than entire artist discographies.