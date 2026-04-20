// ============================================================
// DDAS - Data Download Duplication Alert System
// background.js (Service Worker)
// ============================================================

function getStorage(callback) {
    chrome.storage.local.get({ downloadLinksTable: {}, pendingDownloads: {} }, callback);
}

function setStorage(data, callback) {
    chrome.storage.local.set(data, callback);
}

function normalizeUrl(url) {
    try {
        const parsed = new URL(url);
        parsed.hash = '';
        parsed.protocol = 'https:';
        parsed.searchParams.sort();
        return parsed.toString().replace(/\/$/, '').toLowerCase();
    } catch (e) {
        return url.trim().toLowerCase();
    }
}

// -------------------------------------------------------
// Check if a tab URL is injectable (not a chrome:// page,
// not a PDF viewer, not a new tab, not an extension page)
// -------------------------------------------------------
function isInjectableUrl(url) {
    if (!url) return false;
    const blocked = ['chrome://', 'chrome-extension://', 'about:', 'data:', 'file://'];
    return !blocked.some(prefix => url.startsWith(prefix));
}

// -------------------------------------------------------
// Inject modal — with fallback: if active tab is not
// injectable, find the first normal tab and use that.
// -------------------------------------------------------
function showAlertInActiveTab(downloadId, downloadUrl) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        const activeTab = tabs && tabs[0];

        if (activeTab && isInjectableUrl(activeTab.url)) {
            // Happy path: active tab is a normal web page
            injectModal(activeTab.id, downloadId, downloadUrl);
        } else {
            // Fallback: active tab is chrome://, PDF viewer, new tab, etc.
            // Find the first normal web tab we can inject into
            console.warn('DDAS: Active tab is not injectable (url:', activeTab && activeTab.url, '). Searching for a fallback tab...');
            chrome.tabs.query({ currentWindow: true }, function (allTabs) {
                const injectableTab = allTabs.find(t => isInjectableUrl(t.url));
                if (injectableTab) {
                    // Focus that tab so the user sees the modal
                    chrome.tabs.update(injectableTab.id, { active: true }, function () {
                        injectModal(injectableTab.id, downloadId, downloadUrl);
                    });
                } else {
                    // No injectable tab at all — use Chrome notification as last resort
                    console.warn('DDAS: No injectable tab found. Showing notification instead.');
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icon.png',
                        title: '⚠️ DDAS — Duplicate Download Blocked',
                        message: `This file was already downloaded:\n${downloadUrl}`,
                        priority: 2
                    });
                }
            });
        }
    });
}

function injectModal(tabId, downloadId, downloadUrl) {
    chrome.scripting.executeScript({
        target: { tabId },
        func: showCustomModal,
        args: [downloadId, downloadUrl]
    }, function (results) {
        if (chrome.runtime.lastError) {
            console.error('DDAS: Script injection failed:', chrome.runtime.lastError.message);
        } else {
            console.log('DDAS: Modal injected successfully into tab', tabId);
        }
    });
}

// -------------------------------------------------------
// Modal UI injected into the page
// -------------------------------------------------------
function showCustomModal(downloadId, downloadUrl) {
    const existingModal = document.getElementById('ddas-duplicate-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'ddas-duplicate-modal';
    Object.assign(modal.style, {
        position: 'fixed', left: '0', top: '0',
        width: '100vw', height: '100vh',
        backgroundColor: 'rgba(0,0,0,0.55)',
        zIndex: '2147483647',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        fontFamily: 'sans-serif'
    });

    const card = document.createElement('div');
    Object.assign(card.style, {
        backgroundColor: '#fff', padding: '28px 32px',
        borderRadius: '12px', boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        maxWidth: '420px', width: '90%', textAlign: 'center'
    });

    const header = document.createElement('h2');
    header.textContent = '⚠️ DDAS — Duplicate Download Detected';
    Object.assign(header.style, { margin: '0 0 12px', fontSize: '18px', color: '#b45309' });
    card.appendChild(header);

    const message = document.createElement('p');
    message.textContent = 'This file has already been downloaded before:';
    Object.assign(message.style, { margin: '0 0 6px', color: '#444' });
    card.appendChild(message);

    const urlBox = document.createElement('p');
    urlBox.textContent = downloadUrl;
    Object.assign(urlBox.style, {
        wordBreak: 'break-all', fontSize: '12px', color: '#666',
        background: '#f3f4f6', padding: '8px', borderRadius: '6px',
        margin: '0 0 20px'
    });
    card.appendChild(urlBox);

    const hint = document.createElement('p');
    hint.textContent = 'Do you still want to download it?';
    Object.assign(hint.style, { margin: '0 0 20px', fontWeight: 'bold', color: '#222' });
    card.appendChild(hint);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '12px', justifyContent: 'center' });

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel Download';
    Object.assign(cancelButton.style, {
        padding: '10px 20px', borderRadius: '8px', border: 'none',
        backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer', fontWeight: 'bold'
    });
    cancelButton.onclick = function () {
        modal.remove();
        console.log('DDAS: User chose to cancel duplicate download.');
    };
    btnRow.appendChild(cancelButton);

    const continueButton = document.createElement('button');
    continueButton.textContent = 'Continue Download';
    Object.assign(continueButton.style, {
        padding: '10px 20px', borderRadius: '8px', border: 'none',
        backgroundColor: '#22c55e', color: '#fff', cursor: 'pointer', fontWeight: 'bold'
    });
    continueButton.onclick = function () {
        continueButton.textContent = 'Downloading...';
        continueButton.disabled = true;
        chrome.runtime.sendMessage(
            { action: 'continueDownload', downloadId, downloadUrl },
            function (response) {
                if (response && response.success) {
                    continueButton.textContent = 'Download Started ✓';
                    setTimeout(() => modal.remove(), 1000);
                } else {
                    continueButton.textContent = 'Failed ✗';
                    continueButton.style.backgroundColor = '#ef4444';
                    console.warn('DDAS: Re-download failed:', response);
                }
            }
        );
    };
    btnRow.appendChild(continueButton);

    card.appendChild(btnRow);
    modal.appendChild(card);
    document.body.appendChild(modal);
}

// -------------------------------------------------------
// Listen for new downloads
// -------------------------------------------------------
chrome.downloads.onCreated.addListener(function (downloadItem) {
    const downloadId = downloadItem.id;
    const rawUrl = downloadItem.url;
    const downloadUrl = normalizeUrl(rawUrl);

    getStorage(function (result) {
        const downloadLinksTable = result.downloadLinksTable;
        const pendingDownloads = result.pendingDownloads;

        if (downloadLinksTable[downloadUrl]) {
            // Duplicate — cancel immediately (works even for tiny files)
            chrome.downloads.cancel(downloadId, function () {
                if (chrome.runtime.lastError) {
                    console.warn('DDAS: Could not cancel (already done):', chrome.runtime.lastError.message);
                }
                console.log('DDAS: Duplicate detected, alerting user:', downloadUrl);
                showAlertInActiveTab(downloadId, rawUrl);
            });
        } else {
            pendingDownloads[downloadId] = downloadUrl;
            setStorage({ pendingDownloads }, function () {
                console.log('DDAS: Tracking pending download:', downloadUrl);
            });
        }
    });
});

// -------------------------------------------------------
// Listen for download state changes
// -------------------------------------------------------
chrome.downloads.onChanged.addListener(function (downloadDelta) {
    const downloadId = downloadDelta.id;
    if (!downloadDelta.state) return;

    const currentState = downloadDelta.state.current;

    getStorage(function (result) {
        let { downloadLinksTable, pendingDownloads } = result;
        const downloadUrl = pendingDownloads[downloadId];

        if (!downloadUrl) return;

        if (currentState === 'complete') {
            downloadLinksTable[downloadUrl] = {
                downloadId,
                timestamp: new Date().toISOString()
            };
            delete pendingDownloads[downloadId];
            setStorage({ downloadLinksTable, pendingDownloads }, function () {
                console.log('DDAS: Download complete, saved to table:', downloadUrl);
            });

        } else if (currentState === 'interrupted') {
            delete pendingDownloads[downloadId];
            setStorage({ pendingDownloads }, function () {
                console.log('DDAS: Download interrupted, removed from pending:', downloadUrl);
            });
        }
    });
});

// -------------------------------------------------------
// Message listener
// -------------------------------------------------------
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.action === 'cancelDownload') {
        console.log('DDAS: User confirmed cancel for download:', message.downloadId);
        sendResponse({ success: true });
        return true;

    } else if (message.action === 'continueDownload') {
        if (!message.downloadUrl) {
            sendResponse({ success: false, error: 'No URL provided' });
            return true;
        }
        chrome.downloads.download({ url: message.downloadUrl }, function (newDownloadId) {
            if (chrome.runtime.lastError) {
                console.warn('DDAS: Re-download error:', chrome.runtime.lastError.message);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log('DDAS: Re-download started, new ID:', newDownloadId);
                sendResponse({ success: true });
            }
        });
        return true;
    }
});
