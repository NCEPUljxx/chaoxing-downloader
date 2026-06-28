// ============================================================
// 超星课件下载助手 - Popup Script
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const hasPage = document.getElementById('hasPage');
  const noPage = document.getElementById('noPage');

  try {
    // Query current tab to check if we're on a chaoxing page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('chaoxing.com')) {
      hasPage.style.display = 'none';
      noPage.style.display = 'block';
      return;
    }

    // Send message to content script to get file stats
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getStats' });
    } catch (e) {
      // Content script might not be loaded yet
      hasPage.style.display = 'none';
      noPage.style.display = 'block';
      document.querySelector('#noPage .icon').textContent = '🔄';
      document.querySelector('#noPage p').textContent = '请刷新超星课程页面后重试';
      return;
    }

    if (response && response.filesCount > 0) {
      hasPage.style.display = 'block';
      noPage.style.display = 'none';

      document.getElementById('courseName').textContent = response.courseName || '当前课程';
      document.getElementById('totalFiles').textContent = response.filesCount;
      document.getElementById('restrictedFiles').textContent = response.restrictedCount;
      document.getElementById('allowedFiles').textContent = response.filesCount - response.restrictedCount;
    } else {
      hasPage.style.display = 'none';
      noPage.style.display = 'block';
    }
  } catch (e) {
    hasPage.style.display = 'none';
    noPage.style.display = 'block';
  }
});

// Listen for progress updates from background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadProgress') {
    const progressCard = document.getElementById('progressCard');
    const progressFill = document.getElementById('progressFill');
    const progressStatus = document.getElementById('progressStatus');
    const progressText = document.getElementById('progressText');

    if (!progressCard) return;

    progressCard.style.display = 'block';

    switch (request.status) {
      case 'started':
        progressStatus.textContent = '开始下载...';
        progressFill.style.width = '0%';
        progressText.textContent = `0 / ${request.total}`;
        break;

      case 'processing':
        const pct = request.total > 0
          ? Math.round((request.completed + request.failed) / request.total * 100)
          : 0;
        progressFill.style.width = pct + '%';
        progressStatus.textContent = request.currentFile
          ? `下载中: ${request.currentFile}`
          : '下载中...';
        progressText.textContent = `${request.completed + request.failed} / ${request.total} (失败 ${request.failed})`;
        break;

      case 'completed':
        progressFill.style.width = '100%';
        progressStatus.textContent = '✅ 下载完成!';
        progressText.textContent = `成功 ${request.completed} 个` +
          (request.failed > 0 ? `，失败 ${request.failed} 个` : '');
        break;
    }
  }
});
