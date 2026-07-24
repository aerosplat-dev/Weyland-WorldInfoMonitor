export const TOOLBAR_BUTTON_ID = 'wim-toolbar-button';

let clickCallback = null;
let panelObserver = null;

function handleButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    clickCallback?.();
}

function createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = TOOLBAR_BUTTON_ID;
    button.className = 'menu_button menu_button_icon wim-toolbar-button';
    button.setAttribute('aria-label', 'Open World Info Monitor');
    button.setAttribute('aria-haspopup', 'dialog');

    const icon = document.createElement('span');
    icon.className = 'fa-solid fa-chart-line fa-fw wim-toolbar-icon';
    icon.setAttribute('aria-hidden', 'true');
    button.append(icon);

    const label = document.createElement('span');
    label.className = 'wim-toolbar-label';
    label.textContent = 'Monitor';
    button.append(label);

    button.addEventListener('click', handleButtonClick);
    return button;
}

function placeButton() {
    const anchor = document.getElementById('WI_panel_pin_div');
    if (!anchor || !anchor.closest('#WorldInfo')) return null;
    const title = anchor.nextElementSibling;
    const headerRow = anchor.parentElement;
    if (!title || !headerRow) return null;

    let button = document.getElementById(TOOLBAR_BUTTON_ID);
    if (!button) {
        button = createButton();
    }

    if (title.nextElementSibling !== button) {
        title.after(button);
    }

    panelObserver?.disconnect();
    panelObserver = null;
    return button;
}

function watchForPanel() {
    if (panelObserver || !document.documentElement) return;

    panelObserver = new MutationObserver(() => {
        placeButton();
    });
    panelObserver.observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Inserts the World Info Monitor button after the title in the row containing
 * #WI_panel_pin_div. Repeated calls update the callback without adding a
 * second button. If SillyTavern has not built the panel yet, a temporary
 * MutationObserver performs the insertion once the anchor appears.
 *
 * @param {() => void} onClick
 * @returns {{getElement: () => HTMLButtonElement|null, destroy: () => void}}
 */
export function injectToolbarButton(onClick) {
    clickCallback = onClick;

    if (!placeButton()) {
        watchForPanel();
    }

    return {
        getElement() {
            return /** @type {HTMLButtonElement|null} */ (document.getElementById(TOOLBAR_BUTTON_ID));
        },
        destroy() {
            panelObserver?.disconnect();
            panelObserver = null;
            const button = document.getElementById(TOOLBAR_BUTTON_ID);
            button?.removeEventListener('click', handleButtonClick);
            button?.remove();
            clickCallback = null;
        },
    };
}
