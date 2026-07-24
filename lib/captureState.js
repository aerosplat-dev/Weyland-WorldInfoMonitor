import { cloneAndNormalizeEntries } from './entries.js';

export const REFRESH_STATES = Object.freeze({
    NONE: 'none',
    SCANNING: 'scanning',
    CAPTURED: 'captured',
});

const IGNORED_GENERATION_TYPES = new Set(['quiet', 'impersonate']);

/**
 * @param {unknown} generationType
 * @param {unknown} dryRun
 * @returns {boolean}
 */
export function shouldCaptureGeneration(generationType, dryRun = false) {
    return dryRun !== true
        && !IGNORED_GENERATION_TYPES.has(String(generationType ?? '').toLowerCase());
}

/**
 * State controller for the generation events consumed by the runtime module.
 *
 * `beginActivation` clones synchronously, before any sticky/regex enrichment
 * can await. The returned capture id must be supplied to `commitActivation`;
 * starting another generation or changing chat invalidates it.
 *
 * @param {{
 *   cloneEntries?: (entries: unknown[]) => Record<string, any>[],
 *   onChange?: (state: ReturnType<ReturnType<typeof createCaptureState>['getState']>) => void,
 * }} [options]
 */
export function createCaptureState(options = {}) {
    const cloneEntries = typeof options.cloneEntries === 'function'
        ? options.cloneEntries
        : cloneAndNormalizeEntries;
    let onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    let sequence = 0;
    let entries = [];
    let refreshState = REFRESH_STATES.NONE;
    let activeCapture = null;
    let ignoredCapture = null;

    function getState() {
        return {
            captureId: sequence,
            activeCaptureId: activeCapture?.id ?? null,
            generationType: activeCapture?.generationType ?? null,
            entries: [...entries],
            refreshState,
        };
    }

    function notify() {
        onChange(getState());
    }

    function commitEmpty(captureId) {
        if (!activeCapture || activeCapture.id !== captureId || activeCapture.finalized) {
            return false;
        }

        entries = [];
        refreshState = REFRESH_STATES.CAPTURED;
        activeCapture.activationCommitted = true;
        activeCapture.activationPending = false;
        activeCapture.finalized = true;
        notify();
        return true;
    }

    /**
     * Signature matches GENERATION_STARTED:
     * (generationType, generationOptions, dryRun).
     *
     * @param {unknown} generationType
     * @param {unknown} [generationOptions]
     * @param {unknown} [dryRun]
     * @returns {number|null}
     */
    function startGeneration(generationType, generationOptions = {}, dryRun = false) {
        const actualDryRun = typeof generationOptions === 'boolean'
            ? generationOptions
            : dryRun;

        // A dry assembly can be nested while a real capture is enriching.
        // It must be a literal no-op; its lifecycle is filtered by runtime.
        if (actualDryRun === true) return null;

        if (!shouldCaptureGeneration(generationType, false)) {
            ignoredCapture = {};
            return null;
        }

        if (activeCapture && !activeCapture.finalized) {
            entries = activeCapture.previousEntries;
            refreshState = activeCapture.previousRefreshState;
        }

        ignoredCapture = null;
        const captureId = ++sequence;
        activeCapture = {
            id: captureId,
            generationType: String(generationType ?? ''),
            previousEntries: [...entries],
            previousRefreshState: refreshState,
            activationObserved: false,
            activationPending: false,
            activationCommitted: false,
            finalizationRequested: false,
            finalized: false,
        };
        // Keep the preceding capture visible while this generation scans.
        refreshState = REFRESH_STATES.SCANNING;
        notify();
        return captureId;
    }

    /**
     * Clones WORLD_INFO_ACTIVATED entries immediately and opens an async-safe
     * commit token.
     *
     * @param {unknown[]} activatedEntries
     * @returns {{captureId: number, entries: Record<string, any>[]}|null}
     */
    function beginActivation(activatedEntries) {
        if (ignoredCapture || !activeCapture || activeCapture.finalized) return null;

        const clonedEntries = cloneEntries(Array.isArray(activatedEntries) ? activatedEntries : []);
        activeCapture.activationObserved = true;
        activeCapture.activationPending = true;
        return {
            captureId: activeCapture.id,
            entries: clonedEntries,
        };
    }

    /**
     * @param {number} captureId
     * @param {unknown[]} activatedEntries
     * @returns {boolean} false when an older async capture has gone stale
     */
    function commitActivation(captureId, activatedEntries) {
        if (!activeCapture || activeCapture.id !== captureId || activeCapture.finalized) {
            return false;
        }

        entries = cloneEntries(Array.isArray(activatedEntries) ? activatedEntries : []);
        refreshState = REFRESH_STATES.SCANNING;
        activeCapture.activationPending = false;
        activeCapture.activationCommitted = true;
        if (activeCapture.finalizationRequested) {
            refreshState = REFRESH_STATES.CAPTURED;
            activeCapture.finalized = true;
        }
        notify();
        return true;
    }

    /**
     * Completes the begin/enrich/commit pattern while preserving rejection of
     * stale work. Enrichment errors remain visible to the caller.
     *
     * @param {unknown[]} activatedEntries
     * @param {(entries: Record<string, any>[], captureId: number) => unknown[]|Promise<unknown[]>} [enrichEntries]
     * @returns {Promise<boolean>}
     */
    async function captureActivation(activatedEntries, enrichEntries = async (value) => value) {
        const pending = beginActivation(activatedEntries);
        if (!pending) return false;

        try {
            const enrichedEntries = await enrichEntries(pending.entries, pending.captureId);
            return commitActivation(pending.captureId, enrichedEntries);
        } catch (error) {
            failActivation(pending.captureId);
            throw error;
        }
    }

    /**
     * Resolves a failed enrichment. If the primary/fallback finalizer already
     * ran while enrichment was pending, the capture becomes an empty result.
     *
     * @param {number} captureId
     * @returns {boolean}
     */
    function failActivation(captureId) {
        if (!activeCapture || activeCapture.id !== captureId || activeCapture.finalized) {
            return false;
        }

        activeCapture.activationPending = false;
        activeCapture.activationObserved = false;
        if (activeCapture.finalizationRequested) {
            return commitEmpty(captureId);
        }
        return true;
    }

    /**
     * GENERATE_AFTER_DATA is the primary empty-generation signal: by this
     * point the normal World Info scan has either emitted activation data or
     * completed with none.
     *
     * @returns {boolean}
     */
    function finalizeAfterData() {
        if (ignoredCapture) {
            return false;
        }
        if (!activeCapture || activeCapture.finalized) return false;

        activeCapture.finalizationRequested = true;
        if (activeCapture.activationPending) return true;
        if (!activeCapture.activationCommitted) return commitEmpty(activeCapture.id);

        refreshState = REFRESH_STATES.CAPTURED;
        activeCapture.finalized = true;
        notify();
        return true;
    }

    /**
     * A stopped/early-ended generation never becomes the last capture. Restore
     * the pre-scan display and invalidate enrichment still in flight.
     *
     * @returns {boolean}
     */
    function stopGeneration() {
        if (ignoredCapture) {
            ignoredCapture = null;
            return false;
        }
        if (!activeCapture || activeCapture.finalized) return false;

        sequence++;
        entries = activeCapture.previousEntries;
        refreshState = activeCapture.previousRefreshState;
        activeCapture = null;
        notify();
        return true;
    }

    /**
     * CHAT_CHANGED invalidates pending enrichment and removes the prior
     * chat's captured entries.
     */
    function changeChat() {
        sequence++;
        activeCapture = null;
        ignoredCapture = null;
        entries = [];
        refreshState = REFRESH_STATES.NONE;
        notify();
    }

    return {
        getState,
        setOnChange(callback) {
            onChange = typeof callback === 'function' ? callback : () => {};
        },
        startGeneration,
        beginActivation,
        commitActivation,
        captureActivation,
        failActivation,
        finalizeAfterData,
        stopGeneration,
        changeChat,
    };
}
