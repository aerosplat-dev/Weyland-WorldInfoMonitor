const MOBILE_MEDIA_QUERY = '(max-width: 700px), (pointer: coarse)';

/**
 * Keeps a desktop tool window recoverable without forcing the entire frame
 * on-screen. The titlebar can never move above or fully below the viewport,
 * and at least minVisible horizontal pixels remain available to grab.
 *
 * @param {number} left
 * @param {number} top
 * @param {number} width
 * @param {number} height
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @param {number} [minVisible]
 * @returns {{left: number, top: number}}
 */
export function clampPosition(left, top, width, height, viewportWidth, viewportHeight, minVisible = 120) {
    const safeWidth = Math.max(0, width);
    const safeViewportWidth = Math.max(0, viewportWidth);
    const safeViewportHeight = Math.max(0, viewportHeight);
    const visibleX = Math.min(Math.max(0, minVisible), safeWidth || safeViewportWidth);
    const visibleY = Math.min(80, Math.max(0, minVisible), Math.max(0, height) || safeViewportHeight);
    const minimumLeft = -safeWidth + visibleX;
    const maximumLeft = safeViewportWidth - visibleX;
    const maximumTop = Math.max(0, safeViewportHeight - visibleY);

    return {
        left: Math.max(minimumLeft, Math.min(maximumLeft, left)),
        top: Math.max(0, Math.min(maximumTop, top)),
    };
}

/**
 * @param {(query: string) => {matches: boolean}} [matchMediaFn]
 * @returns {boolean}
 */
export function isMobileLayout(matchMediaFn = (query) => window.matchMedia(query)) {
    return matchMediaFn(MOBILE_MEDIA_QUERY).matches;
}

/**
 * Applies the current viewport clamp to an element.
 *
 * @param {HTMLElement} windowElement
 * @param {Window} [windowRef]
 * @returns {{left: number, top: number}}
 */
export function reclampElement(windowElement, windowRef = window) {
    const rect = windowElement.getBoundingClientRect();
    const position = clampPosition(
        rect.left,
        rect.top,
        rect.width,
        rect.height,
        windowRef.innerWidth,
        windowRef.innerHeight,
    );
    windowElement.style.left = `${position.left}px`;
    windowElement.style.top = `${position.top}px`;
    return position;
}

/**
 * Adds desktop mouse dragging to a titlebar. Interactive titlebar controls
 * never begin a drag. Every installed listener has a matching destroy path.
 *
 * @param {HTMLElement} handleElement
 * @param {HTMLElement} windowElement
 * @param {Window} [windowRef]
 * @returns {{destroy: () => void}}
 */
export function attachDragHandle(handleElement, windowElement, windowRef = window) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function onMouseDown(event) {
        const target = event.target instanceof Element ? event.target : null;
        if (event.button !== 0 || target?.closest('button, input, select, textarea, a, label')) return;

        const rect = windowElement.getBoundingClientRect();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        handleElement.classList.add('wim-is-dragging');
        event.preventDefault();
    }

    function onMouseMove(event) {
        if (!dragging) return;

        const rect = windowElement.getBoundingClientRect();
        const position = clampPosition(
            startLeft + event.clientX - startX,
            startTop + event.clientY - startY,
            rect.width,
            rect.height,
            windowRef.innerWidth,
            windowRef.innerHeight,
        );
        windowElement.style.left = `${position.left}px`;
        windowElement.style.top = `${position.top}px`;
    }

    function onMouseUp() {
        if (!dragging) return;
        dragging = false;
        handleElement.classList.remove('wim-is-dragging');
    }

    handleElement.addEventListener('mousedown', onMouseDown);
    windowRef.addEventListener('mousemove', onMouseMove);
    windowRef.addEventListener('mouseup', onMouseUp);

    return {
        destroy() {
            dragging = false;
            handleElement.classList.remove('wim-is-dragging');
            handleElement.removeEventListener('mousedown', onMouseDown);
            windowRef.removeEventListener('mousemove', onMouseMove);
            windowRef.removeEventListener('mouseup', onMouseUp);
        },
    };
}

/**
 * Re-clamps after viewport changes and native desktop resizing. ResizeObserver
 * is optional so the helper remains usable in older embedded browsers and in
 * pure unit tests.
 *
 * @param {HTMLElement} windowElement
 * @param {Window} [windowRef]
 * @param {typeof ResizeObserver|null} [ResizeObserverClass]
 * @returns {{reclamp: () => void, destroy: () => void}}
 */
export function attachViewportReclamp(
    windowElement,
    windowRef = window,
    ResizeObserverClass = windowRef.ResizeObserver ?? null,
) {
    function reclamp() {
        if (windowElement.hidden) return;
        reclampElement(windowElement, windowRef);
    }

    function onViewportResize() {
        reclamp();
    }

    const resizeObserver = ResizeObserverClass
        ? new ResizeObserverClass(() => reclamp())
        : null;

    windowRef.addEventListener('resize', onViewportResize);
    resizeObserver?.observe(windowElement);

    return {
        reclamp,
        destroy() {
            windowRef.removeEventListener('resize', onViewportResize);
            resizeObserver?.disconnect();
        },
    };
}

export { MOBILE_MEDIA_QUERY };
