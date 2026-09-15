const lidarrConfig = require('../../config/lidarr');

/**
 * Reasserts Album Finder's desired per-album state after Lidarr's asynchronous
 * artist refresh has settled. State is grouped by artist so a later rapid add
 * also rechecks albums selected earlier in the same refresh window.
 */
class AlbumReconciler {
  constructor(albumService, options = {}) {
    this.albumService = albumService;
    this.pollInterval = options.pollInterval ?? lidarrConfig.reconciliation.pollInterval;
    this.maxAttempts = options.maxAttempts ?? lidarrConfig.reconciliation.maxAttempts;
    this.stablePasses = options.stablePasses ?? lidarrConfig.reconciliation.stablePasses;
    this.retentionMs = options.retentionMs ?? lidarrConfig.reconciliation.retentionMs;
    this.artists = new Map();
  }

  enqueue({ artistMbid, artistId, albumMbid, searchAlreadyTriggered = false }) {
    if (!artistMbid || !albumMbid) {
      throw new Error('Artist and album MusicBrainz IDs are required for reconciliation');
    }

    let state = this.artists.get(artistMbid);
    if (!state) {
      state = {
        artistId,
        albums: new Map(),
        generation: 0,
        running: false,
        cleanupTimer: null
      };
      this.artists.set(artistMbid, state);
    }

    state.artistId = artistId || state.artistId;
    state.generation += 1;
    const prior = state.albums.get(albumMbid);
    state.albums.set(albumMbid, {
      searchTriggered: prior?.searchTriggered || searchAlreadyTriggered
    });

    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
      state.cleanupTimer = null;
    }

    if (!state.running) {
      state.running = true;
      state.promise = this.run(artistMbid, state);
    }

    return state.promise;
  }

  async run(artistMbid, state) {
    let stableCount = 0;
    let lastProcessedGeneration = -1;
    let completed = false;

    try {
      for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
        const generation = state.generation;
        lastProcessedGeneration = generation;
        let refreshActive;

        try {
          refreshActive = await this.albumService.hasActiveArtistRefresh(state.artistId);
        } catch (error) {
          console.warn(`Unable to inspect Lidarr refresh state for ${artistMbid}:`, error.message);
          refreshActive = true;
        }

        if (refreshActive) {
          stableCount = 0;
          await this.delay();
          continue;
        }

        const reconciled = await this.reconcileAlbums(state);
        stableCount = reconciled && generation === state.generation ? stableCount + 1 : 0;

        if (stableCount >= this.stablePasses) {
          completed = true;
          return;
        }

        await this.delay();
      }

      console.error(`Lidarr reconciliation timed out for artist ${artistMbid}`);
    } catch (error) {
      console.error(`Lidarr reconciliation failed for artist ${artistMbid}:`, error);
    } finally {
      state.running = false;
      state.cleanupTimer = setTimeout(() => {
        if (!state.running) this.artists.delete(artistMbid);
      }, this.retentionMs);
      state.cleanupTimer.unref?.();

      // Close the narrow race where a selection is added after the worker's
      // final generation check but before it marks itself stopped.
      if (!completed) return;
      const latest = this.artists.get(artistMbid);
      if (latest === state && state.generation !== lastProcessedGeneration) {
        state.running = true;
        state.promise = this.run(artistMbid, state);
      }
    }
  }

  async reconcileAlbums(state) {
    let allMonitored = true;

    for (const [albumMbid, desired] of state.albums) {
      try {
        let album = await this.albumService.findInLibraryStrict(albumMbid);
        if (!album) {
          allMonitored = false;
          continue;
        }

        if (!album.monitored) {
          await this.albumService.updateMonitoring(album, true);
        }

        album = await this.albumService.findInLibraryStrict(albumMbid);
        if (!album?.monitored) {
          allMonitored = false;
          continue;
        }

        const percentComplete = album.statistics?.percentOfTracks || 0;
        if (!desired.searchTriggered && percentComplete < 100) {
          await this.albumService.triggerSearchStrict(album.id);
          desired.searchTriggered = true;
        }
      } catch (error) {
        allMonitored = false;
        console.warn(`Unable to reconcile album ${albumMbid}:`, error.message);
      }
    }

    return allMonitored;
  }

  delay() {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, this.pollInterval);
      timer.unref?.();
    });
  }
}

module.exports = { AlbumReconciler };
