import {
    MOBILE_MEDIA_QUERY,
    attachDragHandle,
    attachViewportReclamp,
    isMobileLayout,
} from './dragResize.js';
import { groupEntriesByLorebook } from '../entries.js';
import { TOOLBAR_BUTTON_ID } from './toolbarButton.js';

const EXTENSION_NAME = 'Weyland-WorldInfoMonitor';
export const SORT_LOREBOOKS = 'lorebooks';
export const SORT_PROMPT = 'prompt';

let portalElement = null;
let windowReadyPromise = null;
let currentState = createDefaultState();
let selectedEntryKey = null;
let returnFocusElement = null;
let isWindowOpen = false;
let dragHandle = null;
let reclampHandle = null;
let layoutMediaQuery = null;
let layoutListenerUsesLegacyApi = false;

function createDefaultState() {
    return {
        entries: [],
        sortMode: SORT_LOREBOOKS,
        refreshState: 'none',
        statusText: '',
        onSortModeChange: null,
        onEntryOpen: null,
        onClose: null,
        returnFocusTo: null,
    };
}

function resolveExtensionBasePath(metaUrl) {
    const pathname = new URL(metaUrl).pathname;
    const match = pathname.match(new RegExp(`^/scripts/extensions/((?:third-party/)?${EXTENSION_NAME})/`));
    if (!match) {
        throw new Error(`[${EXTENSION_NAME}] Could not resolve extension base path from ${pathname}.`);
    }
    return match[1];
}

function normalizeSortMode(mode) {
    return mode === SORT_PROMPT || mode === 'prompt-order' ? SORT_PROMPT : SORT_LOREBOOKS;
}

function normalizeState(nextState) {
    const safeState = nextState && typeof nextState === 'object' ? nextState : {};
    return {
        ...currentState,
        ...safeState,
        entries: Array.isArray(safeState.entries) ? [...safeState.entries] : currentState.entries,
        sortMode: normalizeSortMode(safeState.sortMode ?? currentState.sortMode),
    };
}

function entryWorld(entry) {
    return String(entry.world ?? entry.sourceWorld ?? entry.lorebook ?? 'Unknown lorebook');
}

function entryTitle(entry) {
    const explicit = entry.title ?? entry.displayName ?? entry.label;
    if (explicit !== undefined && String(explicit).trim()) return String(explicit).trim();
    if (entry.comment !== undefined && String(entry.comment).trim()) return String(entry.comment).trim();
    const keys = entry.keys ?? entry.key;
    if (Array.isArray(keys) && keys.length) return keys.join(', ');
    if (keys !== undefined && String(keys).trim()) return String(keys).trim();
    return 'Untitled entry';
}

function entryIdentity(entry) {
    return JSON.stringify([entryWorld(entry), String(entry.uid ?? entry.id ?? '')]);
}

function entryStrategy(entry) {
    const explicit = entry.strategyLabel ?? entry.activationLabel ?? entry.strategy;
    if (explicit !== undefined && String(explicit).trim()) return String(explicit).trim();
    if (entry.constant === true) return 'Constant';
    if (entry.vectorized === true) return 'Vectorized';
    return 'Keyword';
}

function entryInsertion(entry) {
    const explicit = entry.insertionLabel ?? entry.positionLabel ?? entry.insertion?.label;
    if (explicit !== undefined && String(explicit).trim()) return String(explicit).trim();
    return 'Insertion unavailable';
}

function entrySticky(entry) {
    return entry.stickyRounds ?? entry.sticky;
}

function entryKeys(entry) {
    const keys = entry.keys ?? entry.key;
    if (Array.isArray(keys)) return keys.join(', ');
    return keys === undefined || keys === null ? '' : String(keys);
}

function entrySecondaryKeys(entry) {
    const keys = entry.secondaryKeys ?? entry.keysecondary ?? entry.secondary_keys;
    if (Array.isArray(keys)) return keys.join(', ');
    return keys === undefined || keys === null ? '' : String(keys);
}

function entryFinalContent(entry) {
    const content = entry.finalPromptContent
        ?? entry.finalContent
        ?? entry.promptContent
        ?? entry.content
        ?? '';
    return String(content);
}

function entryWasFiltered(entry) {
    return entry.omittedAfterFiltering === true
        || entry.promptFilteredOut === true
        || entry.finalPromptOmitted === true;
}

function refreshStateName() {
    const value = typeof currentState.refreshState === 'object'
        ? currentState.refreshState.state
        : currentState.refreshState;
    return String(value ?? 'none').toLowerCase();
}

function refreshStateText() {
    const explicit = currentState.statusText
        || (typeof currentState.refreshState === 'object' ? currentState.refreshState.text : '');
    if (explicit) return String(explicit);

    const state = refreshStateName();
    if (state === 'scanning' || state === 'loading') return 'Scanning…';
    if (state === 'captured' || state === 'complete' || state === 'ready') return 'Last generation captured';
    return 'No captured generation yet';
}

function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function appendMetadata(metadataElement, label, value) {
    if (value === undefined || value === null || value === '') return;
    const item = createElement('div', 'wim-detail-metadata-item');
    item.append(
        createElement('dt', 'wim-detail-label', label),
        createElement('dd', 'wim-detail-value', String(value)),
    );
    metadataElement.append(item);
}

function buildEntryRow(entry, promptIndex = null) {
    const row = createElement('button', 'wim-entry-row');
    row.type = 'button';
    row.dataset.entryKey = entryIdentity(entry);
    row.setAttribute('aria-label', `Open ${entryTitle(entry)} from ${entryWorld(entry)}`);

    if (promptIndex !== null) {
        row.append(createElement('span', 'wim-prompt-index', String(promptIndex + 1)));
    }

    const main = createElement('span', 'wim-entry-main');
    main.append(
        createElement('span', 'wim-entry-title', entryTitle(entry)),
        createElement('span', 'wim-entry-world', entryWorld(entry)),
    );

    const metadata = createElement('span', 'wim-entry-metadata');
    metadata.append(
        createElement('span', 'wim-entry-chip', entryStrategy(entry)),
        createElement('span', 'wim-entry-insertion', entryInsertion(entry)),
    );

    const sticky = entrySticky(entry);
    if (sticky !== undefined && sticky !== null && sticky !== '' && Number(sticky) > 0) {
        metadata.append(createElement('span', 'wim-entry-sticky', `Sticky ${sticky}`));
    }

    main.append(metadata);
    row.append(main, createElement('span', 'wim-entry-chevron', '›'));
    return row;
}

function emptyStateText() {
    const state = refreshStateName();
    if (state === 'scanning' || state === 'loading') return 'Scanning for activated World Info entries…';
    if (state === 'none' || state === 'idle' || state === 'cleared') return 'No captured generation yet';
    return 'No World Info entries activated';
}

function renderList() {
    if (!portalElement) return;
    const entries = currentState.entries;
    const list = portalElement.querySelector('#wim-entry-list');
    list.replaceChildren();

    const count = entries.length;
    portalElement.querySelector('#wim-entry-count').textContent = `${count} active ${count === 1 ? 'entry' : 'entries'}`;

    const refreshElement = portalElement.querySelector('#wim-refresh-state');
    refreshElement.textContent = refreshStateText();
    refreshElement.dataset.state = refreshStateName();

    portalElement.querySelectorAll('.wim-sort-button').forEach((button) => {
        const isActive = button.dataset.sortMode === currentState.sortMode;
        button.classList.toggle('wim-sort-button-active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });

    if (!entries.length) {
        const empty = createElement('div', 'wim-empty-state');
        const icon = createElement('span', 'fa-solid fa-book-open wim-empty-icon');
        icon.setAttribute('aria-hidden', 'true');
        empty.append(icon, createElement('strong', 'wim-empty-title', emptyStateText()));
        if (refreshStateName() !== 'scanning' && refreshStateName() !== 'loading') {
            empty.append(createElement('span', 'wim-empty-copy', 'The monitor refreshes automatically during generation.'));
        }
        list.append(empty);
        return;
    }

    if (currentState.sortMode === SORT_PROMPT) {
        const flatList = createElement('div', 'wim-prompt-list');
        entries.forEach((entry, index) => flatList.append(buildEntryRow(entry, index)));
        list.append(flatList);
        return;
    }

    for (const { world, entries: groupEntries } of groupEntriesByLorebook(entries)) {
        const group = createElement('section', 'wim-lorebook-group');
        const heading = createElement('h3', 'wim-lorebook-heading');
        const icon = createElement('span', 'fa-solid fa-book wim-lorebook-icon');
        icon.setAttribute('aria-hidden', 'true');
        heading.append(
            icon,
            createElement('span', 'wim-lorebook-name', world),
            createElement('span', 'wim-lorebook-count', String(groupEntries.length)),
        );
        group.append(heading);

        const rows = createElement('div', 'wim-lorebook-entries');
        groupEntries.forEach((entry) => rows.append(buildEntryRow(entry)));
        group.append(rows);
        list.append(group);
    }
}

function findSelectedEntry() {
    return currentState.entries.find((entry) => entryIdentity(entry) === selectedEntryKey) ?? null;
}

function renderDetail(entry) {
    if (!portalElement) return;
    portalElement.querySelector('#wim-detail-world').textContent = entryWorld(entry);
    portalElement.querySelector('#wim-detail-title').textContent = entryTitle(entry);

    const metadata = portalElement.querySelector('#wim-detail-metadata');
    metadata.replaceChildren();
    appendMetadata(metadata, 'Activation', entryStrategy(entry));
    appendMetadata(metadata, 'Insertion', entryInsertion(entry));
    appendMetadata(metadata, 'Depth', entry.depth);
    appendMetadata(metadata, 'Order', entry.order);
    appendMetadata(metadata, 'Keys', entryKeys(entry));
    appendMetadata(metadata, 'Secondary keys', entrySecondaryKeys(entry));
    appendMetadata(metadata, 'Sticky rounds', entrySticky(entry));

    const wasFiltered = entryWasFiltered(entry);
    portalElement.querySelector('#wim-filtered-notice').hidden = !wasFiltered;
    portalElement.querySelector('#wim-final-content').textContent = wasFiltered
        ? entryFinalContent(entry) || 'No content was inserted after prompt regex filtering.'
        : entryFinalContent(entry);
}

function findRowByKey(key) {
    if (!portalElement || !key) return null;
    return [...portalElement.querySelectorAll('.wim-entry-row')]
        .find((row) => row.dataset.entryKey === key) ?? null;
}

function setView(view, { focus = false } = {}) {
    if (!portalElement) return;

    const body = portalElement.querySelector('#wim-body');
    const backButton = portalElement.querySelector('#wim-back-button');
    const isDetail = view === 'detail';
    body.dataset.view = isDetail ? 'detail' : 'list';
    backButton.hidden = !isDetail;

    if (focus) {
        const focusTarget = isDetail
            ? portalElement.querySelector('#wim-detail-title')
            : findRowByKey(selectedEntryKey)
                ?? portalElement.querySelector('.wim-entry-row')
                ?? portalElement.querySelector('#wim-window');
        requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
    }
}

function renderWindow() {
    if (!portalElement) return;

    renderList();

    if (!selectedEntryKey) {
        setView('list');
        return;
    }

    const selectedEntry = findSelectedEntry();
    if (!selectedEntry) {
        selectedEntryKey = null;
        setView('list', { focus: true });
        return;
    }

    renderDetail(selectedEntry);
    setView('detail');
}

function openEntry(entry) {
    selectedEntryKey = entryIdentity(entry);
    renderDetail(entry);
    setView('detail', { focus: true });
    currentState.onEntryOpen?.(entry);
}

function handleEntryListClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest('.wim-entry-row');
    if (!row || !portalElement?.contains(row)) return;

    const entry = currentState.entries.find((candidate) => entryIdentity(candidate) === row.dataset.entryKey);
    if (entry) openEntry(entry);
}

function handleSortClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest('.wim-sort-button');
    if (!button || !portalElement?.contains(button)) return;

    const nextMode = normalizeSortMode(button.dataset.sortMode);
    if (nextMode === currentState.sortMode) return;

    currentState = normalizeState({ sortMode: nextMode });
    renderList();
    currentState.onSortModeChange?.(nextMode);
}

function handleBackClick() {
    const priorKey = selectedEntryKey;
    selectedEntryKey = null;
    setView('list');

    const row = findRowByKey(priorKey);
    requestAnimationFrame(() => (row ?? portalElement?.querySelector('#wim-window'))?.focus({ preventScroll: true }));
}

function handleCloseClick() {
    closeMonitorWindow();
}

function handleDocumentKeyDown(event) {
    if (!isWindowOpen || event.key !== 'Escape' || isMobileLayout()) return;
    event.preventDefault();
    event.stopPropagation();
    closeMonitorWindow();
}

function handleWindowPointerBoundary(event) {
    event.stopPropagation();
}

function teardownDragResize() {
    dragHandle?.destroy();
    reclampHandle?.destroy();
    dragHandle = null;
    reclampHandle = null;
}

function updateDragResizeForLayout() {
    teardownDragResize();
    if (!isWindowOpen || !portalElement || isMobileLayout()) return;

    const windowElement = portalElement.querySelector('#wim-window');
    const titlebar = portalElement.querySelector('#wim-titlebar');
    reclampHandle = attachViewportReclamp(windowElement);
    reclampHandle.reclamp();
    dragHandle = attachDragHandle(titlebar, windowElement);
}

function handleLayoutChange() {
    updateDragResizeForLayout();
}

function addLayoutListener() {
    if (layoutMediaQuery) return;
    layoutMediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    if (typeof layoutMediaQuery.addEventListener === 'function') {
        layoutMediaQuery.addEventListener('change', handleLayoutChange);
        layoutListenerUsesLegacyApi = false;
    } else {
        layoutMediaQuery.addListener(handleLayoutChange);
        layoutListenerUsesLegacyApi = true;
    }
}

function removeLayoutListener() {
    if (!layoutMediaQuery) return;
    if (layoutListenerUsesLegacyApi) {
        layoutMediaQuery.removeListener(handleLayoutChange);
    } else {
        layoutMediaQuery.removeEventListener('change', handleLayoutChange);
    }
    layoutMediaQuery = null;
    layoutListenerUsesLegacyApi = false;
}

function wirePortal() {
    const windowElement = portalElement.querySelector('#wim-window');
    portalElement.querySelector('#wim-entry-list').addEventListener('click', handleEntryListClick);
    portalElement.querySelector('.wim-sort-control').addEventListener('click', handleSortClick);
    portalElement.querySelector('#wim-back-button').addEventListener('click', handleBackClick);
    portalElement.querySelector('#wim-close-button').addEventListener('click', handleCloseClick);
    windowElement.addEventListener('mousedown', handleWindowPointerBoundary);
    windowElement.addEventListener('touchstart', handleWindowPointerBoundary);
    document.addEventListener('keydown', handleDocumentKeyDown, true);
    addLayoutListener();
}

function unwirePortal() {
    if (!portalElement) return;
    const windowElement = portalElement.querySelector('#wim-window');
    portalElement.querySelector('#wim-entry-list')?.removeEventListener('click', handleEntryListClick);
    portalElement.querySelector('.wim-sort-control')?.removeEventListener('click', handleSortClick);
    portalElement.querySelector('#wim-back-button')?.removeEventListener('click', handleBackClick);
    portalElement.querySelector('#wim-close-button')?.removeEventListener('click', handleCloseClick);
    windowElement?.removeEventListener('mousedown', handleWindowPointerBoundary);
    windowElement?.removeEventListener('touchstart', handleWindowPointerBoundary);
    document.removeEventListener('keydown', handleDocumentKeyDown, true);
    removeLayoutListener();
}

async function buildWindowElement() {
    let portal = document.getElementById('wim-portal');
    if (!portal) {
        const context = SillyTavern.getContext();
        const basePath = resolveExtensionBasePath(import.meta.url);
        const html = await context.renderExtensionTemplateAsync(basePath, 'template');

        // SillyTavern fixes <body> and transforms <html>. A sibling portal
        // avoids making the tool window a child of the fixed body.
        document.body.insertAdjacentHTML('afterend', html);
        portal = document.getElementById('wim-portal');
    }

    if (!portal) {
        throw new Error(`[${EXTENSION_NAME}] template.html did not produce #wim-portal.`);
    }

    const windowElement = portal.querySelector('#wim-window');
    if (!windowElement) {
        portal.remove();
        throw new Error(`[${EXTENSION_NAME}] template.html did not produce #wim-window.`);
    }

    portalElement = portal;
    wirePortal();
    renderWindow();
    return windowElement;
}

function ensureWindowElement() {
    if (portalElement) {
        return Promise.resolve(portalElement.querySelector('#wim-window'));
    }
    if (!windowReadyPromise) {
        windowReadyPromise = buildWindowElement().catch((error) => {
            windowReadyPromise = null;
            throw error;
        });
    }
    return windowReadyPromise;
}

function resolveReturnFocus(explicitTarget) {
    const resolvedTarget = typeof explicitTarget === 'function' ? explicitTarget() : explicitTarget;
    if (resolvedTarget && typeof resolvedTarget.focus === 'function') return resolvedTarget;
    const activeElement = document.activeElement;
    if (activeElement && activeElement !== document.body && typeof activeElement.focus === 'function') {
        return activeElement;
    }
    return document.getElementById(TOOLBAR_BUTTON_ID);
}

/**
 * Opens the monitor at the list view. The template and listeners are built
 * once, while state and callbacks are refreshed on every call.
 *
 * @param {Partial<ReturnType<typeof createDefaultState>>} [state]
 * @returns {Promise<HTMLElement>} the monitor window element once mounted
 */
export async function openMonitorWindow(state = {}) {
    currentState = normalizeState(state);
    returnFocusElement = resolveReturnFocus(currentState.returnFocusTo);
    selectedEntryKey = null;

    const windowElement = await ensureWindowElement();
    portalElement.setAttribute('aria-hidden', 'false');
    windowElement.hidden = false;
    isWindowOpen = true;
    renderWindow();
    updateDragResizeForLayout();

    requestAnimationFrame(() => windowElement.focus({ preventScroll: true }));
    return windowElement;
}

/**
 * Merges a partial state snapshot and refreshes the mounted monitor. Updating
 * before the first open is supported and does not eagerly build the window.
 *
 * @param {Partial<ReturnType<typeof createDefaultState>>} [state]
 */
export function updateMonitorWindow(state = {}) {
    currentState = normalizeState(state);
    renderWindow();
}

/**
 * Hides the monitor, releases desktop drag/reclamp listeners, and restores
 * focus to the World Info Monitor toolbar button (or the caller's explicit
 * returnFocusTo element).
 */
export function closeMonitorWindow() {
    if (!portalElement || !isWindowOpen) return;

    const windowElement = portalElement.querySelector('#wim-window');
    teardownDragResize();
    windowElement.hidden = true;
    portalElement.setAttribute('aria-hidden', 'true');
    isWindowOpen = false;
    selectedEntryKey = null;

    const focusTarget = returnFocusElement?.isConnected
        ? returnFocusElement
        : document.getElementById(TOOLBAR_BUTTON_ID);
    returnFocusElement = null;
    focusTarget?.focus({ preventScroll: true });
    requestAnimationFrame(() => {
        if (!isWindowOpen && focusTarget?.isConnected) {
            focusTarget.focus({ preventScroll: true });
        }
    });
    currentState.onClose?.();
}

/**
 * Removes every DOM/global listener and the sibling portal. This is intended
 * for extension teardown or hot reload; normal Close keeps the built window
 * available for a cheap reopen.
 */
export function destroyMonitorWindow() {
    const focusTarget = returnFocusElement?.isConnected
        ? returnFocusElement
        : document.getElementById(TOOLBAR_BUTTON_ID);

    teardownDragResize();
    unwirePortal();
    portalElement?.remove();
    portalElement = null;
    windowReadyPromise = null;
    currentState = createDefaultState();
    selectedEntryKey = null;
    returnFocusElement = null;
    isWindowOpen = false;
    focusTarget?.focus({ preventScroll: true });
}
