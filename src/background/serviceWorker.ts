// Background service worker (MV3).
//
// For this sprint its only job is to make clicking the toolbar icon open the
// Lengua side panel. State flows directly between the content script and the
// side panel via chrome.runtime messaging, so no relaying is needed here yet.

function enableActionOpensPanel(): void {
  chrome.sidePanel
    ?.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[Lengua] setPanelBehavior failed', err));
}

chrome.runtime.onInstalled.addListener(enableActionOpensPanel);
chrome.runtime.onStartup.addListener(enableActionOpensPanel);
