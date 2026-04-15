document.addEventListener('DOMContentLoaded', function () {

    chrome.storage.local.get({ downloadLinksTable: {} }, function (result) {
        const downloadLinksTable = result.downloadLinksTable;
        const linkList = document.getElementById('downloadLinks');
        const emptyMsg = document.getElementById('emptyMsg');

        const entries = Object.entries(downloadLinksTable);

        if (entries.length === 0) {
            emptyMsg.style.display = 'block';
            return;
        }

        emptyMsg.style.display = 'none';

       
        entries.forEach(([url, meta]) => {
            const li = document.createElement('li');

            const urlSpan = document.createElement('span');
            urlSpan.className = 'url';
            urlSpan.textContent = url;

            const metaSpan = document.createElement('span');
            metaSpan.className = 'meta';
            const date = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : 'Unknown time';
            metaSpan.textContent = `Downloaded: ${date}`;

            li.appendChild(urlSpan);
            li.appendChild(metaSpan);
            linkList.appendChild(li);
        });
    });


    document.getElementById('clearAll').addEventListener('click', function () {
       
        chrome.storage.local.set({ downloadLinksTable: {}, pendingDownloads: {} }, function () {
            console.log('DDAS: Download history cleared.');
        });

        const linkList = document.getElementById('downloadLinks');
        linkList.innerHTML = '';

        document.getElementById('emptyMsg').style.display = 'block';
        document.getElementById('clearAll').textContent = 'Cleared ✓';
        setTimeout(() => {
            document.getElementById('clearAll').textContent = 'Clear History';
        }, 1500);
    });
});
