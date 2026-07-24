import {
    chat_metadata,
    event_types,
    eventSource,
    extension_prompt_roles,
    extension_prompt_types,
    saveSettingsDebounced,
} from '../../../../script.js';
import { metadata_keys } from '../../../authors-note.js';
import { extension_settings } from '../../../extensions.js';
import { promptManager } from '../../../openai.js';
import { getRegexedString, regex_placement } from '../../../extensions/regex/engine.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { DEFAULT_DEPTH, world_info_position } from '../../../world-info.js';
import {
    createCaptureState,
    REFRESH_STATES,
    shouldCaptureGeneration,
} from './lib/captureState.js';
import {
    cloneAndNormalizeEntries,
    getExactPromptOccurrenceRanks,
    sortEntriesByPromptOrder,
} from './lib/entries.js';
import {
    SORT_MODES,
    getSettings,
    setSortMode,
} from './lib/settings.js';
import {
    SORT_LOREBOOKS,
    SORT_PROMPT,
    destroyMonitorWindow,
    openMonitorWindow,
    updateMonitorWindow,
} from './lib/ui/monitorWindow.js';
import { injectToolbarButton } from './lib/ui/toolbarButton.js';
import { createGenerationScopeTracker } from './lib/runtimeScope.js';

const MODULE_NAME = 'Weyland-WorldInfoMonitor';
const SLASH_COMMAND_NAME = 'wi-triggered';

let settings = getSettings(extension_settings);
let toolbarHandle = null;
let slashCommand = null;
let activeOrderContext = null;
let visibleOrderContext = createOrderContext(null, 'normal');
const scopeTracker = createGenerationScopeTracker();

function normalizeActivatedEntries(entries) {
    return cloneAndNormalizeEntries(entries, {
        transformContent(content, entry) {
            // The capture controller clones again when async sticky enrichment
            // commits. Preserve the first WORLD_INFO regex result verbatim.
            if (Object.hasOwn(entry, 'finalPromptContent')) {
                return entry.finalPromptContent;
            }

            const regexDepth = Number(entry.position) === world_info_position.atDepth
                ? (entry.depth ?? DEFAULT_DEPTH)
                : null;

            return getRegexedString(content, regex_placement.WORLD_INFO, {
                depth: regexDepth,
                isMarkdown: false,
                isPrompt: true,
            });
        },
    });
}

const captureState = createCaptureState({
    cloneEntries: normalizeActivatedEntries,
    onChange: handleCaptureChange,
});

function toUiSortMode(sortMode) {
    return sortMode === SORT_MODES.PROMPT_ORDER ? SORT_PROMPT : SORT_LOREBOOKS;
}

function toPersistedSortMode(sortMode) {
    return sortMode === SORT_PROMPT ? SORT_MODES.PROMPT_ORDER : SORT_MODES.LOREBOOKS;
}

function asFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function getAuthorsNoteSnapshot() {
    return {
        authorsNotePosition: asFiniteNumber(
            chat_metadata?.[metadata_keys.position],
            extension_prompt_types.IN_CHAT,
        ),
        authorsNoteDepth: asFiniteNumber(
            chat_metadata?.[metadata_keys.depth],
            DEFAULT_DEPTH,
        ),
        authorsNoteRole: asFiniteNumber(
            chat_metadata?.[metadata_keys.role],
            extension_prompt_roles.SYSTEM,
        ),
    };
}

function getLiveMarkerSequence(generationType) {
    try {
        const collection = promptManager.getPromptCollection(generationType)?.collection;
        return Array.isArray(collection)
            ? collection.map(prompt => ({ identifier: prompt?.identifier }))
            : [];
    } catch (error) {
        console.error(`[${MODULE_NAME}] Could not read the active prompt order.`, error);
        return [];
    }
}

function createOrderContext(captureId, generationType) {
    return {
        captureId,
        generationType: String(generationType ?? 'normal'),
        markerSequence: getLiveMarkerSequence(generationType),
        exactOccurrenceRanks: null,
        activationEntries: null,
        activationCommitted: false,
        ...getAuthorsNoteSnapshot(),
    };
}

function refreshOrderContext(orderContext) {
    if (!orderContext) return;
    orderContext.markerSequence = getLiveMarkerSequence(orderContext.generationType);
    Object.assign(orderContext, getAuthorsNoteSnapshot());
}

function promoteOrderContext(orderContext) {
    if (!orderContext) return;
    visibleOrderContext = {
        generationType: orderContext.generationType,
        markerSequence: orderContext.markerSequence,
        exactOccurrenceRanks: orderContext.exactOccurrenceRanks,
        authorsNotePosition: orderContext.authorsNotePosition,
        authorsNoteDepth: orderContext.authorsNoteDepth,
        authorsNoteRole: orderContext.authorsNoteRole,
    };
}

function getDisplayedEntries(state) {
    if (settings.sortMode !== SORT_MODES.PROMPT_ORDER) {
        return state.entries;
    }

    return sortEntriesByPromptOrder(state.entries, {
        exactOccurrenceRanks: visibleOrderContext.exactOccurrenceRanks,
        promptCollection: visibleOrderContext.markerSequence,
        authorsNotePosition: visibleOrderContext.authorsNotePosition,
        authorsNoteDepth: visibleOrderContext.authorsNoteDepth,
        authorsNoteRole: visibleOrderContext.authorsNoteRole,
        defaultDepth: DEFAULT_DEPTH,
    });
}

function createWindowState(state = captureState.getState()) {
    return {
        entries: getDisplayedEntries(state),
        sortMode: toUiSortMode(settings.sortMode),
        refreshState: state.refreshState,
        onSortModeChange: handleSortModeChange,
        returnFocusTo: () => toolbarHandle?.getElement() ?? null,
    };
}

function handleCaptureChange(state) {
    if (
        state.activeCaptureId !== null
        && activeOrderContext?.captureId === state.activeCaptureId
        && (
            activeOrderContext.activationCommitted
            || state.refreshState === REFRESH_STATES.CAPTURED
        )
    ) {
        promoteOrderContext(activeOrderContext);
    }

    updateMonitorWindow(createWindowState(state));
}

function handleSortModeChange(sortMode) {
    settings = setSortMode(extension_settings, toPersistedSortMode(sortMode));
    saveSettingsDebounced();
    updateMonitorWindow(createWindowState());
}

function handleToolbarClick() {
    void openMonitorWindow(createWindowState()).catch((error) => {
        console.error(`[${MODULE_NAME}] Could not open the monitor window.`, error);
    });
}

function handleGenerationStarted(generationType, generationOptions, dryRun) {
    const ignored = !shouldCaptureGeneration(generationType, dryRun);
    const scope = scopeTracker.beginScope({
        generationType,
        dryRun,
        ignored,
    });
    if (ignored) return;

    const captureId = captureState.startGeneration(generationType, generationOptions, dryRun);
    if (captureId === null) {
        scope.ignored = true;
        return;
    }

    scope.captureId = captureId;
    scope.orderContext = createOrderContext(captureId, generationType);
    activeOrderContext = scope.orderContext;
}

async function getStickyRounds(entry) {
    try {
        const command = SlashCommandParser.commands['wi-get-timed-effect'];
        if (typeof command?.callback !== 'function') return 0;

        const value = await command.callback(
            {
                effect: 'sticky',
                format: 'number',
                file: String(entry.world ?? ''),
                _scope: null,
                _abortController: null,
            },
            entry.uid,
        );
        const rounds = Number.parseInt(String(value), 10);
        return Number.isFinite(rounds) && rounds > 0 ? rounds : 0;
    } catch {
        return 0;
    }
}

async function enrichAndCommitActivation(scope, pending) {
    try {
        const enrichedEntries = await Promise.all(pending.entries.map(async entry => {
            const stickyRounds = await getStickyRounds(entry);
            return {
                ...entry,
                sticky: stickyRounds,
                stickyRounds,
            };
        }));

        if (
            scope.captureId === pending.captureId
            && activeOrderContext?.captureId === pending.captureId
        ) {
            activeOrderContext.activationEntries = enrichedEntries;
            activeOrderContext.activationCommitted = true;
        }
        captureState.commitActivation(pending.captureId, enrichedEntries);
    } catch (error) {
        captureState.failActivation(pending.captureId);
        console.error(`[${MODULE_NAME}] Could not enrich the activated entries.`, error);
    }
}

function handleWorldInfoActivated(entries) {
    const scope = scopeTracker.getCaptureScope();
    if (!scope || scope.captureId !== captureState.getState().activeCaptureId) return;

    try {
        const pending = captureState.beginActivation(entries);
        if (!pending || pending.captureId !== scope.captureId) return;

        if (activeOrderContext?.captureId === pending.captureId) {
            activeOrderContext.activationEntries = pending.entries;
        }

        void enrichAndCommitActivation(scope, pending);
    } catch (error) {
        if (scope.captureId !== null) captureState.failActivation(scope.captureId);
        console.error(`[${MODULE_NAME}] Could not capture activated World Info entries.`, error);
    }
}

function handleChatCompletionPromptReady(eventData) {
    if (!Array.isArray(eventData?.chat)) return;

    const scope = scopeTracker.attachPrompt(eventData.chat, eventData?.dryRun === true);
    if (
        !scope
        || scope.ignored
        || scope.captureId !== captureState.getState().activeCaptureId
        || activeOrderContext?.captureId !== scope.captureId
    ) {
        return;
    }

    // Other generation listeners can alter Prompt Manager after start. Read
    // marker and Author's Note settings at the actual assembly boundary.
    refreshOrderContext(activeOrderContext);
    activeOrderContext.exactOccurrenceRanks = Array.isArray(activeOrderContext.activationEntries)
        ? getExactPromptOccurrenceRanks(
            activeOrderContext.activationEntries,
            eventData.chat,
        )
        : null;
    if (activeOrderContext.activationCommitted) {
        promoteOrderContext(activeOrderContext);
        updateMonitorWindow(createWindowState());
    }
}

function handleGenerateAfterData(generateData) {
    const resolved = scopeTracker.resolveAfterData(generateData);
    if (!resolved) return;

    const { scope, matchedByIdentity } = resolved;
    if (scope.ignored) {
        // Dry Generate() returns at this boundary and emits no terminal event.
        if (scope.dryRun) scopeTracker.markFinished(scope);
        return;
    }

    const state = captureState.getState();
    if (
        scope.captureId === null
        || state.activeCaptureId !== scope.captureId
        || activeOrderContext?.captureId !== scope.captureId
    ) {
        return;
    }

    refreshOrderContext(activeOrderContext);
    activeOrderContext.exactOccurrenceRanks = (
        matchedByIdentity
        && Array.isArray(scope.promptChat)
        && Array.isArray(activeOrderContext.activationEntries)
    )
        ? getExactPromptOccurrenceRanks(
            activeOrderContext.activationEntries,
            scope.promptChat,
        )
        : null;

    if (activeOrderContext.activationCommitted) {
        promoteOrderContext(activeOrderContext);
        updateMonitorWindow(createWindowState(state));
    }
    captureState.finalizeAfterData();
}

function handleGenerationFinished() {
    const { scope, duplicate } = scopeTracker.finishCurrentScope();
    if (!scope || duplicate || scope.ignored || scope.captureId === null) return;
    if (captureState.getState().activeCaptureId !== scope.captureId) return;

    // Once after-data has arrived, it is the authoritative finalizer. A slow
    // detached sticky lookup may still commit afterward; do not cancel it.
    if (!scope.afterDataSeen) {
        captureState.stopGeneration();
        if (activeOrderContext?.captureId === scope.captureId) {
            activeOrderContext = null;
        }
    }
}

function handleChatChanged() {
    scopeTracker.reset();
    activeOrderContext = null;
    visibleOrderContext = createOrderContext(null, 'normal');
    captureState.changeChat();
}

function getTriggeredEntries() {
    return JSON.stringify(captureState.getState().entries);
}

function registerSlashCommand() {
    slashCommand = SlashCommand.fromProps({
        name: SLASH_COMMAND_NAME,
        callback: getTriggeredEntries,
        returns: 'list of triggered WI entries',
        helpString: 'Get the cloned list of World Info entries triggered on the last captured generation.',
    });
    SlashCommandParser.addCommandObject(slashCommand);
}

function unregisterSlashCommand() {
    if (SlashCommandParser.commands[SLASH_COMMAND_NAME] === slashCommand) {
        delete SlashCommandParser.commands[SLASH_COMMAND_NAME];
    }
    slashCommand = null;
}

function registerEventListeners() {
    eventSource.on(event_types.GENERATION_STARTED, handleGenerationStarted);
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handleChatCompletionPromptReady);
    eventSource.on(event_types.GENERATE_AFTER_DATA, handleGenerateAfterData);
    eventSource.on(event_types.GENERATION_STOPPED, handleGenerationFinished);
    eventSource.on(event_types.GENERATION_ENDED, handleGenerationFinished);
    eventSource.on(event_types.CHAT_CHANGED, handleChatChanged);
}

export function destroyWorldInfoMonitor() {
    eventSource.removeListener(event_types.GENERATION_STARTED, handleGenerationStarted);
    eventSource.removeListener(event_types.WORLD_INFO_ACTIVATED, handleWorldInfoActivated);
    eventSource.removeListener(event_types.CHAT_COMPLETION_PROMPT_READY, handleChatCompletionPromptReady);
    eventSource.removeListener(event_types.GENERATE_AFTER_DATA, handleGenerateAfterData);
    eventSource.removeListener(event_types.GENERATION_STOPPED, handleGenerationFinished);
    eventSource.removeListener(event_types.GENERATION_ENDED, handleGenerationFinished);
    eventSource.removeListener(event_types.CHAT_CHANGED, handleChatChanged);
    captureState.setOnChange(() => {});
    scopeTracker.reset();
    unregisterSlashCommand();
    toolbarHandle?.destroy();
    toolbarHandle = null;
    destroyMonitorWindow();
}

function initialize() {
    registerEventListeners();
    registerSlashCommand();
    toolbarHandle = injectToolbarButton(handleToolbarClick);
    updateMonitorWindow(createWindowState());
}

initialize();
