function isWeakMapKey(value) {
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

/**
 * Correlates SillyTavern's generation lifecycle events without writing an id
 * into core prompt data. OpenAI's CHAT_COMPLETION_PROMPT_READY `chat` array is
 * the same object later exposed as GENERATE_AFTER_DATA `prompt`, so that path
 * can be matched by identity. Other APIs fall back to the current assembly
 * scope.
 *
 * Finished scopes remain at the top of the stack for one microtask. Core can
 * emit GENERATION_ENDED and GENERATION_STOPPED as a pair from the same stop
 * action; the grace period makes the second event an idempotent duplicate
 * instead of allowing it to act on a parent scope.
 *
 * @param {{scheduleRemoval?: (callback: () => void) => void}} [options]
 */
export function createGenerationScopeTracker(options = {}) {
    const scheduleRemoval = typeof options.scheduleRemoval === 'function'
        ? options.scheduleRemoval
        : queueMicrotask;
    let sequence = 0;
    let scopes = [];
    let promptScopes = new WeakMap();
    const ambiguousPrompt = Object.freeze({ ambiguous: true });

    function removeScope(scope) {
        scope.removed = true;
        scopes = scopes.filter(candidate => candidate !== scope);
    }

    function beginScope(details = {}) {
        const scope = {
            id: ++sequence,
            captureId: details.captureId ?? null,
            generationType: String(details.generationType ?? ''),
            dryRun: details.dryRun === true,
            ignored: details.ignored === true,
            promptChat: null,
            afterDataSeen: false,
            finished: false,
            removed: false,
            orderContext: details.orderContext ?? null,
        };
        scopes.push(scope);
        return scope;
    }

    function getCurrentScope({ assemblyOnly = false } = {}) {
        for (let index = scopes.length - 1; index >= 0; index--) {
            const scope = scopes[index];
            if (scope.removed) continue;
            if (assemblyOnly && (scope.finished || scope.afterDataSeen)) continue;
            return scope;
        }
        return null;
    }

    function getCaptureScope() {
        const scope = getCurrentScope({ assemblyOnly: true });
        if (!scope || scope.ignored) return null;

        const hasIgnoredAssembly = scopes.some(candidate => (
            !candidate.removed
            && !candidate.finished
            && !candidate.afterDataSeen
            && candidate.ignored
        ));
        return hasIgnoredAssembly ? null : scope;
    }

    function attachPrompt(chat, dryRun = false) {
        if (!isWeakMapKey(chat)) return null;

        const candidates = [];
        for (let index = scopes.length - 1; index >= 0; index--) {
            const candidate = scopes[index];
            if (
                candidate.removed
                || candidate.finished
                || candidate.afterDataSeen
                || candidate.promptChat
                || candidate.dryRun !== (dryRun === true)
            ) {
                continue;
            }
            candidates.push(candidate);
        }

        if (candidates.length === 0) return null;
        if (candidates.length > 1) {
            // The event has no generation id or type. Refuse to guess when a
            // real and ignored non-dry assembly overlap; preserving the prior
            // visible capture is safer than cross-ranking either prompt.
            promptScopes.set(chat, ambiguousPrompt);
            return null;
        }

        const [scope] = candidates;
        scope.promptChat = chat;
        promptScopes.set(chat, scope);
        return scope;
    }

    function resolveAfterData(generateData) {
        const prompt = generateData?.prompt;
        const mappedScope = isWeakMapKey(prompt) ? promptScopes.get(prompt) : null;
        if (mappedScope === ambiguousPrompt) return null;

        const matchedByIdentity = mappedScope ?? null;
        const scope = matchedByIdentity ?? getCurrentScope({ assemblyOnly: true });
        if (!scope || scope.removed || scope.finished || scope.afterDataSeen) return null;

        scope.afterDataSeen = true;
        return {
            scope,
            matchedByIdentity: Boolean(matchedByIdentity),
        };
    }

    function markFinished(scope) {
        if (!scope || scope.removed) return { scope: null, duplicate: false };
        if (scope.finished) return { scope, duplicate: true };

        scope.finished = true;
        scheduleRemoval(() => removeScope(scope));
        return { scope, duplicate: false };
    }

    function finishCurrentScope() {
        return markFinished(getCurrentScope());
    }

    function reset() {
        for (const scope of scopes) scope.removed = true;
        scopes = [];
        promptScopes = new WeakMap();
    }

    return {
        beginScope,
        getCurrentScope,
        getCaptureScope,
        attachPrompt,
        resolveAfterData,
        markFinished,
        finishCurrentScope,
        reset,
    };
}
