/**
 * Terminal-failure handling for graph chapters.
 *
 * A chapter listed in Graphs/<id>.processingChapters blocks the chapter progress handler from
 * queuing any further work. When a chapter's pipeline step fails terminally (or its queue work
 * disappears), these helpers release the chapter so it can be retried, record the failure under
 * failedChapters.<n>, clear the library transcription spinner, and surface the error in the
 * catalogue graphProgress.
 *
 * This module must not import graphPipeline.js or GraphPipelineBase.js (import cycle).
 */
import logger from "../util/logger.js";
import {
  graphReleaseChapter,
  getAllGraphsFirestore,
  normalizeChapter,
} from "../storage/firestore/graph.js";
import {
  queueGetActiveGraphEntries,
  queueGetGraphChapterEntries,
} from "../storage/firestore/queue.js";
import {libraryResetTranscriptionStatusIfProcessingRtdb} from "../storage/realtimeDb/library.js";
import {updateData} from "../storage/realtimeDb/database.js";
import {getQueueEntryTypes} from "./v0.1/pipelineSteps.js";
import {
  graphStatusMessages,
  GRAPH_CHAPTER_FAILURE_RETRY_LIMIT,
} from "./config.js";

const MAX_ERROR_MESSAGE_LENGTH = 1000;

/**
 * Turn any thrown value into a readable message (same expression graphQueue uses for logging).
 * @param {*} error - Error, string, or other value
 * @return {string} Message truncated to MAX_ERROR_MESSAGE_LENGTH characters
 */
function toErrorMessage(error) {
  const message = error?.message || (typeof error === "string" ? error : JSON.stringify(error)) || "Unknown error";
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

/**
 * Number of times a chapter has been released after a terminal failure.
 * @param {Object} graph - Graph doc data
 * @param {number|string} chapter - Chapter index
 * @return {number} Failure attempts (0 when never failed)
 */
function getChapterFailureAttempts(graph, chapter) {
  const attempts = graph?.failedChapters?.[normalizeChapter(chapter)]?.attempts;
  return Number(attempts) || 0;
}

/**
 * Whether a chapter has used up its automatic retries.
 * @param {Object} graph - Graph doc data
 * @param {number|string} chapter - Chapter index
 * @return {boolean} True when attempts >= GRAPH_CHAPTER_FAILURE_RETRY_LIMIT
 */
function isChapterRetryExhausted(graph, chapter) {
  return getChapterFailureAttempts(graph, chapter) >= GRAPH_CHAPTER_FAILURE_RETRY_LIMIT;
}

/**
 * Surface a chapter failure on the catalogue's graphProgress (path updates only).
 * @param {Object} params - graphId, sku, chapter, step, message, failedAt
 * @return {Promise<void>}
 */
async function writeCatalogueGraphError({graphId, sku, chapter, step, message, failedAt}) {
  await updateData({
    ref: `catalogue/${sku}`,
    data: {
      "graphProgress/status": "error",
      "graphProgress/inProgress": false,
      "graphProgress/description": graphStatusMessages.failed,
      "graphProgress/lastUpdated": failedAt,
      "graphProgress/lastError": {
        graphId,
        chapter,
        step: step ?? null,
        message,
        failedAt,
      },
    },
  });
}

/**
 * Release a chapter whose graph work failed terminally. Each side effect is attempted
 * independently and failures are logged; this function never throws.
 * @param {Object} params
 * @param {string} params.graphId - Graph ID
 * @param {string} params.sku - Book SKU (for library and catalogue updates)
 * @param {string} params.uid - User ID owning the library item
 * @param {number|string} params.chapter - Chapter index
 * @param {string} params.step - Pipeline step that failed
 * @param {*} params.error - Error or message describing the failure
 * @param {string|null} params.queueId - Queue entry ID of the failed step
 * @param {number|null} params.retryCount - Queue retry count at failure
 * @param {string} params.releasedBy - graphQueue, graphCheckup or admin
 * @return {Promise<{released: boolean, attempts: number, errorMessage: string}>}
 */
async function releaseFailedChapter({
  graphId,
  sku,
  uid,
  chapter,
  step,
  error,
  queueId = null,
  retryCount = null,
  releasedBy,
}) {
  const errorMessage = toErrorMessage(error);
  const chapterNumber = normalizeChapter(chapter);
  const failedAt = Date.now();

  let releaseResult = null;
  try {
    releaseResult = await graphReleaseChapter({
      graphId,
      chapter: chapterNumber,
      step,
      error: errorMessage,
      queueId,
      retryCount,
      releasedBy,
    });
  } catch (releaseError) {
    logger.error(`${graphId} releaseFailedChapter: failed to release chapter ${chapterNumber}: ${releaseError.message}`);
    return {released: false, attempts: 0, errorMessage};
  }

  if (!releaseResult) {
    logger.warn(`${graphId} releaseFailedChapter: graph doc not found, chapter ${chapterNumber} not released`);
    return {released: false, attempts: 0, errorMessage};
  }
  const {attempts} = releaseResult;

  if (uid && sku) {
    try {
      await libraryResetTranscriptionStatusIfProcessingRtdb({uid, sku, chapter: chapterNumber});
    } catch (libraryError) {
      logger.error(`${graphId} releaseFailedChapter: failed to reset library status for ${uid}/${sku} chapter ${chapterNumber}: ${libraryError.message}`);
    }
  }

  if (sku) {
    try {
      await writeCatalogueGraphError({graphId, sku, chapter: chapterNumber, step, message: errorMessage, failedAt});
    } catch (catalogueError) {
      logger.error(`${graphId} releaseFailedChapter: failed to write graphProgress error for ${sku}: ${catalogueError.message}`);
    }
  }

  const summary = `${graphId} Released chapter ${chapterNumber} (sku ${sku}) after terminal failure at step ${step} ` +
    `(attempt ${attempts} of ${GRAPH_CHAPTER_FAILURE_RETRY_LIMIT}, releasedBy ${releasedBy}): ${errorMessage}`;
  if (attempts >= GRAPH_CHAPTER_FAILURE_RETRY_LIMIT) {
    logger.critical(`${summary}. Automatic retries exhausted - manual retry required.`);
  } else {
    logger.warn(summary);
  }

  return {released: true, attempts, errorMessage};
}

/**
 * @param {Array<Object>} entries - Queue entries
 * @return {number} Most recent update time across the entries, in ms
 */
function newestTimeUpdated(entries) {
  return Math.max(...entries.map((entry) => entry.timeUpdated || entry.timeRequested || 0));
}

/**
 * Decide whether a graph's processing chapters have no live queue work behind them.
 * @param {Object} params
 * @param {Array<Object>} params.activeEntries - Pending/processing graph entries (any chapter)
 * @param {Array<Object>} params.chapterEntries - All entries of the graph's processing chapters
 * @param {number} params.thresholdMs - Minimum age of the newest chapter entry when nothing is active
 * @param {number} params.processingThresholdMs - Age after which a processing entry is stale
 * @param {number} params.now - Current time in ms
 * @return {string|null} Reason the graph is stuck, or null when it is not stuck
 */
function getStuckReason({activeEntries, chapterEntries, thresholdMs, processingThresholdMs, now}) {
  if (activeEntries.length === 0) {
    // The age check avoids releasing during the short window between marking a chapter
    // processing and adding its first queue entry
    if (chapterEntries.length === 0) {
      return "no active queue entry";
    }
    return now - newestTimeUpdated(chapterEntries) > thresholdMs ? "no active queue entry" : null;
  }
  const allActiveAreStale = activeEntries.every((entry) =>
    entry.status === "processing" &&
    now - (entry.processingStarted || entry.timeUpdated || 0) > processingThresholdMs);
  return allActiveAreStale ? "processing entry exceeded time limit" : null;
}

/**
 * Build the failure record for a stuck chapter, preferring its latest errored queue entry.
 * @param {Object} params
 * @param {Array<Object>} params.entries - All queue entries for this chapter
 * @param {string} params.reason - Why the graph is considered stuck
 * @return {Object} {step, error, queueId, retryCount} for releaseFailedChapter
 */
function describeChapterFailure({entries, reason}) {
  const chapterEntries = [...entries].sort((a, b) => (b.timeUpdated || 0) - (a.timeUpdated || 0));
  const errorEntry = chapterEntries.find((entry) => entry.status === "error");
  if (errorEntry) {
    return {
      step: errorEntry.entryType,
      error: errorEntry.trace || `stuck: ${reason}`,
      queueId: errorEntry.id,
      retryCount: errorEntry.retryCount ?? null,
    };
  }
  const latestEntry = chapterEntries[0];
  return {
    step: latestEntry?.entryType ?? null,
    error: `stuck: ${reason}`,
    queueId: latestEntry?.id ?? null,
    retryCount: latestEntry?.retryCount ?? null,
  };
}

/**
 * Find graphs whose processingChapters have no live queue work and release those chapters.
 * A graph is stuck when it has no pending/processing entry and the newest entry of its processing
 * chapters is older than thresholdMs (or they have no entries), or when every active entry is
 * processing and started more than processingThresholdMs ago. All queue reads are scoped by
 * status or chapter, so a graph with many entries cannot truncate the check.
 * @param {Object} params
 * @param {number} params.thresholdMs - Age of the newest entry before an idle graph counts as stuck
 * @param {number} params.processingThresholdMs - Age before a processing entry counts as stale
 * @param {number} params.now - Current time in ms (injectable for tests)
 * @return {Promise<{checked: number, released: Array<{graphId: string, chapter: number, reason: string}>}>}
 */
async function releaseStuckChapters({thresholdMs, processingThresholdMs, now = Date.now()}) {
  const graphs = await getAllGraphsFirestore({fields: ["sku", "uid", "processingChapters"]});
  const processingGraphs = graphs.filter((graph) =>
    Array.isArray(graph.processingChapters) && graph.processingChapters.length > 0);
  const released = [];

  for (const graph of processingGraphs) {
    try {
      const activeEntries = await queueGetActiveGraphEntries({graphId: graph.id});
      const chapters = [...new Set(graph.processingChapters.map(normalizeChapter))];
      const entriesByChapter = new Map();
      for (const chapter of chapters) {
        entriesByChapter.set(chapter, await queueGetGraphChapterEntries({
          graphId: graph.id,
          chapter,
          legacyEntryTypes: getQueueEntryTypes(),
        }));
      }
      const chapterEntries = [...entriesByChapter.values()].flat();
      const reason = getStuckReason({activeEntries, chapterEntries, thresholdMs, processingThresholdMs, now});
      if (!reason) {
        continue;
      }
      for (const chapter of chapters) {
        const failure = describeChapterFailure({entries: entriesByChapter.get(chapter), reason});
        const result = await releaseFailedChapter({
          graphId: graph.id,
          sku: graph.sku,
          uid: graph.uid,
          chapter,
          ...failure,
          releasedBy: "graphCheckup",
        });
        if (result.released) {
          released.push({graphId: graph.id, chapter, reason});
        }
      }
    } catch (error) {
      logger.error(`${graph.id} releaseStuckChapters: failed to check graph: ${error.message}`);
    }
  }

  return {checked: processingGraphs.length, released};
}

export {
  toErrorMessage,
  releaseFailedChapter,
  releaseStuckChapters,
  getChapterFailureAttempts,
  isChapterRetryExhausted,
};
