const lidarrConfig = require('../../config/lidarr');
const { database } = require('../database');
const { cache } = require('../cache');

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
    this.store = options.store || database;
    this.cache = options.cache || cache;
    this.ready = this.restorePendingJobs();
  }

  async enqueue({
    artistMbid, artistId, albumMbid, searchAlreadyTriggered = false,
    forceSearch = false, activityId, onStateChange
  }) {
    if (!artistMbid || !albumMbid) {
      throw new Error('Artist and album MusicBrainz IDs are required for reconciliation');
    }

    await this.ready;
    await this.store.saveAlbumReconciliationJob({
      artistMbid, artistId, albumMbid, activityId,
      searchTriggered: searchAlreadyTriggered, forceSearch
    });
    this.addDesired({
      artistMbid, artistId, albumMbid, searchAlreadyTriggered, forceSearch, activityId, onStateChange
    });
  }

  addDesired({
    artistMbid, artistId, albumMbid, searchAlreadyTriggered = false,
    forceSearch = false, activityId, onStateChange
  }) {
    let state = this.artists.get(artistMbid);
    if (!state) {
      state = {
        artistMbid,
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
      searchTriggered: forceSearch ? false : prior?.searchTriggered || searchAlreadyTriggered,
      activityId: activityId || prior?.activityId,
      onStateChange: onStateChange || prior?.onStateChange,
      notifiedState: forceSearch ? undefined : prior?.notifiedState,
      reconciled: false
    });

    if (state.cleanupTimer) {
      clearTimeout(state.cleanupTimer);
      state.cleanupTimer = null;
    }

    if (!state.running) {
      state.running = true;
      state.promise = this.run(artistMbid, state);
    }

  }

  async restorePendingJobs() {
    const jobs = await this.store.getAlbumReconciliationJobs();
    jobs.forEach(job => this.addDesired({
      artistMbid: job.artist_mbid,
      artistId: job.artist_id,
      albumMbid: job.album_mbid,
      searchAlreadyTriggered: Boolean(job.search_triggered),
      activityId: job.activity_id,
      onStateChange: job.activity_id
        ? state => this.store.updateAlbumAdditionState(job.activity_id, state)
        : undefined
    }));
  }

  waitFor(artistMbid) {
    return this.artists.get(artistMbid)?.promise || Promise.resolve();
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

        const reconciledAlbumMbids = [...state.albums.keys()];
        const reconciled = await this.reconcileAlbums(state);
        stableCount = reconciled && generation === state.generation ? stableCount + 1 : 0;

        if (stableCount >= this.stablePasses) {
          await this.notifySuccess(state);
          await Promise.all(reconciledAlbumMbids.map(albumMbid =>
            this.store.deleteAlbumReconciliationJob(artistMbid, albumMbid)
          ));
          this.cache.clearByPrefix('lidarr');
          completed = true;
          return;
        }

        await this.delay();
      }

      console.error(`Lidarr reconciliation timed out for artist ${artistMbid}`);
      await this.notifySuccess(state, true);
      await this.notifyFailure(state, 'Lidarr reconciliation timed out');
    } catch (error) {
      console.error(`Lidarr reconciliation failed for artist ${artistMbid}:`, error);
      await this.notifyFailure(state, error.message);
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
      desired.reconciled = false;
      try {
        let album = await this.albumService.findInLibraryStrict(albumMbid);
        if (!album) {
          allMonitored = false;
          continue;
        }

        if (!album.monitored) {
          await this.albumService.updateMonitoring(album, true);
          this.cache.clearByPrefix('lidarr');
        }

        album = await this.albumService.findInLibraryStrict(albumMbid);
        if (!album?.monitored) {
          allMonitored = false;
          continue;
        }

        const percentComplete = album.statistics?.percentOfTracks || 0;
        desired.percentComplete = percentComplete;
        if (!desired.searchTriggered && percentComplete < 100) {
          await this.albumService.triggerSearchStrict(album.id);
          desired.searchTriggered = true;
          await this.store.saveAlbumReconciliationJob({
            artistMbid: state.artistMbid,
            artistId: state.artistId,
            albumMbid,
            activityId: desired.activityId,
            searchTriggered: true
          });
        }
        desired.reconciled = true;

      } catch (error) {
        allMonitored = false;
        console.warn(`Unable to reconcile album ${albumMbid}:`, error.message);
      }
    }

    return allMonitored;
  }

  async notifySuccess(state, onlyReconciled = false) {
    for (const desired of state.albums.values()) {
      if (onlyReconciled && !desired.reconciled) continue;
      const operationState = desired.percentComplete >= 100 ? 'complete' : 'search_queued';
      if (desired.notifiedState === operationState) continue;

      await this.notify(desired, {
        operationState,
        monitored: true,
        searchTriggered: desired.searchTriggered,
        success: true,
        errorMessage: null
      });
      desired.notifiedState = operationState;
    }
  }

  async notifyFailure(state, message) {
    for (const desired of state.albums.values()) {
      if (desired.reconciled) continue;
      await this.notify(desired, {
        operationState: 'failed',
        monitored: false,
        searchTriggered: desired.searchTriggered,
        success: false,
        errorMessage: message
      });
      desired.notifiedState = 'failed';
    }
  }

  async notify(desired, state) {
    try {
      await desired.onStateChange?.(state);
    } catch (error) {
      console.warn('Unable to update album reconciliation status:', error.message);
    }
  }

  delay() {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, this.pollInterval);
      timer.unref?.();
    });
  }
}

module.exports = { AlbumReconciler };
