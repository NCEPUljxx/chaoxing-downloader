// ============================================================
// 超星课件下载助手 v7.0 — Background Service Worker
// 多级 fallback：直链 → 预览解析（原文件→PDF版→试svw版本）
// ============================================================

var C = console.log.bind(console, '[CX BG]');

// ====== 解析预览页 → 提取下载 URL ======
async function resolveUrlFromPreview(file, params) {
  var ext = (file.t || '').toLowerCase();
  // Step 1: get-preview-url
  var pu = 'https://mooc2-ans.chaoxing.com/mooc2-ans/coursedata/get-preview-url'
    + '?dataId=' + file.did + '&cpi=' + params.cpi + '&clazzid=' + params.cl + '&ut=s&courseid=' + params.cid;
  var r1 = await fetch(pu, {
    headers: { 'Referer': params.ref || 'https://mooc2-ans.chaoxing.com/', 'X-Requested-With': 'XMLHttpRequest' }
  });
  if (!r1.ok) throw Error('get-preview-url HTTP ' + r1.status);
  var data = await r1.json();
  if (!data.url) throw Error('no preview url in response');
  var previewUrl = data.url;

  // Step 2: 获取预览页 HTML
  var r2 = await fetch(previewUrl, {
    headers: { 'Referer': params.ref || 'https://mooc2-ans.chaoxing.com/' }
  });
  if (!r2.ok) throw Error('preview page HTTP ' + r2.status);
  var html = await r2.text();

  // 提取 CDN 前缀（兼容多种域名和路径格式）
  var cdnPrefix = extractCdnPrefix(html, file.oid);
  if (!cdnPrefix) throw Error('CDN prefix not found in preview page');

  // 尝试列表（按优先级）:
  //   PDF类型       → 直接用 pdf 子目录
  //   非PDF文档     → 先试原格式，再试 PDF 渲染版
  //   sv-w 版本     → w7, w8, w9
  var candidates = [];

  if (ext === 'pdf') {
    // PDF: 只用 PDF 渲染版（经过验证可靠）
    candidates.push(cdnPrefix.host + '/sv-w' + cdnPrefix.sv + '/doc/' + cdnPrefix.pf + '/' + file.oid + '/pdf/' + file.oid + '.pdf');
    // 也试试原版
    candidates.push(cdnPrefix.host + '/sv-w' + cdnPrefix.sv + '/doc/' + cdnPrefix.pf + '/' + file.oid + '/' + file.oid + '.pdf');
  } else {
    // 非 PDF: 优先原格式，然后 PDF 渲染版
    candidates.push(cdnPrefix.host + '/sv-w' + cdnPrefix.sv + '/doc/' + cdnPrefix.pf + '/' + file.oid + '/' + file.oid + '.' + ext);
    candidates.push(cdnPrefix.host + '/sv-w' + cdnPrefix.sv + '/doc/' + cdnPrefix.pf + '/' + file.oid + '/pdf/' + file.oid + '.pdf');
  }

  // 为每个候选生成 sv-w7/8/9 变体
  var allCandidates = [];
  var svVersions = [cdnPrefix.sv, '7', '8', '9'].filter(function (v, i, a) { return a.indexOf(v) === i; });
  for (var c = 0; c < candidates.length; c++) {
    for (var s = 0; s < svVersions.length; s++) {
      allCandidates.push(candidates[c].replace('/sv-w' + cdnPrefix.sv + '/', '/sv-w' + svVersions[s] + '/'));
    }
  }

  // 直接返回第一个候选（有最高概率成功）
  return { url: allCandidates[0], type: 'doc' };
}

// 提取 CDN 前缀
function extractCdnPrefix(html, oid) {
  // 模式1: 完整 URL（含 https://s2.cldisk.com 或 s3.cldisk.com）
  var m1 = html.match(/https:\/\/s([23])\.cldisk\.com\/sv-w(\d+)\/(doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})\//);
  if (m1) return { host: 'https://s' + m1[1] + '.cldisk.com', sv: m1[2], type: m1[3], pf: m1[4] };

  // 模式2: 缩略图 URL（thumb/png 路径）
  var m2 = html.match(/https:\/\/s([23])\.cldisk\.com\/sv-w(\d+)\/(doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})\/thumb\//);
  if (m2) return { host: 'https://s' + m2[1] + '.cldisk.com', sv: m2[2], type: m2[3], pf: m2[4] };

  // 模式3: pdf 子目录路径
  var m3 = html.match(/https:\/\/s([23])\.cldisk\.com\/sv-w(\d+)\/(doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})\/pdf\//);
  if (m3) return { host: 'https://s' + m3[1] + '.cldisk.com', sv: m3[2], type: m3[3], pf: m3[4] };

  // 模式4: fileinfo.download URL
  var m4 = html.match(/https:\/\/d(\d)\.cldisk\.com\/download\/([a-f0-9]{32})/);
  if (m4) return { host: 'https://s' + m4[1] + '.cldisk.com', sv: '7', type: 'doc', pf: oid.slice(0, 2) + '/' + oid.slice(2, 4) + '/' + oid.slice(4, 6) };

  // 模式5: p.cldisk.com 或其他域名（不带 sv-w 版本号，默认 sv-w7）
  var m5 = html.match(/https:\/\/([a-z0-9]+)\.cldisk\.com\/([^"'\s]*)/);
  if (m5 && (m5[1].startsWith('s') || m5[1].startsWith('d') || m5[1].startsWith('p'))) {
    // 尝试从路径中提取 sv-w 信息
    var svMatch = m5[2].match(/sv-w(\d+)/);
    var pfMatch = m5[2].match(/(?:doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})/);
    var hostBase = 'https://s' + (m5[1].charAt(0) === 'd' ? '2' : '3') + '.cldisk.com';
    return { host: hostBase, sv: svMatch ? svMatch[1] : '7', type: 'doc', pf: pfMatch ? pfMatch[1] : (oid.slice(0, 2) + '/' + oid.slice(2, 4) + '/' + oid.slice(4, 6)) };
  }

  return null;
}

// ====== 解析预览URL（课程页：无 dataId，使用 screen/file + ext）======
async function resolveUrlFromScreen(file, params) {
  var ext = (file.ext || '');

  // 构造 screen/file URL
  var screenUrl = 'https://mooc1.chaoxing.com/mooc-ans/screen/file?objectid=' + file.oid;
  if (ext) screenUrl += '&ext=' + encodeURIComponent(ext);

  // 获取 screen 页面（会自动重定向到 pan-yz）
  var r = await fetch(screenUrl, {
    headers: { 'Referer': params.ref || 'https://mooc1.chaoxing.com/' },
    redirect: 'follow'
  });
  if (!r.ok) throw Error('screen/file HTTP ' + r.status);
  var html = await r.text();

  // 提取 CDN 前缀（从缩略图 URL）
  var thumbMatch = html.match(/https:\/\/s([23])\.cldisk\.com\/sv-w(\d+)\/(doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})\/thumb\//);
  if (!thumbMatch) {
    // 尝试其他 CDN URL 模式
    thumbMatch = html.match(/https:\/\/s([23])\.cldisk\.com\/sv-w(\d+)\/(doc|video)\/([a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2,})\//);
  }
  if (!thumbMatch) throw Error('CDN prefix not found in screen page');

  var host = 'https://s' + thumbMatch[1] + '.cldisk.com';
  var sv = thumbMatch[2];
  var type = thumbMatch[3];
  var pf = thumbMatch[4];
  var oid = file.oid;
  var fileExt = (file.t || 'pdf').toLowerCase();

  // 构造下载 URL
  return {
    url: host + '/sv-w' + sv + '/' + type + '/' + pf + '/' + oid + '/pdf/' + oid + '.pdf',
    type: 'doc'
  };
}

// ====== 下载单个文件 ======
async function downloadOne(file, params) {
  // 课程页文件：使用 screen/file 端点
  if (file.did === '0' || file.did === 0) {
    return await resolveUrlFromScreen(file, params);
  }

  // 非受限文件：先试直接下载 API
  if (!file.dis) {
    try {
      var du = 'https://mooc1.chaoxing.com/coursedata/downloadData'
        + '?dataId=' + file.did + '&classId=' + params.cl + '&cpi=' + params.cpi + '&courseId=' + params.cid + '&ut=s';
      var dr = await fetch(du, {
        headers: { 'Referer': params.ref || 'https://mooc2-ans.chaoxing.com/' }
      });
      var contentType = dr.headers.get('content-type') || '';
      // 检查是否是有效文件（非 JSON 错误响应）
      var isJson = contentType.includes('json') || contentType.includes('javascript');
      if (!isJson && dr.ok) {
        var blob = await dr.blob();
        if (blob.size > 200) {
          // 直接下载可用 — 用 chrome.downloads 下载
          return { url: du, type: 'direct' };
        }
      }
    } catch (e) { /* fall through */ }
  }

  // 受限文件或直接下载失败 → 预览页解析
  return await resolveUrlFromPreview(file, params);
}

// ====== 执行下载 ======
async function executeDownload(resolved, file) {
  var safe = (file.n || 'file').replace(/[\\/:*?"<>|]/g, '_');
  // 如果是原格式非 pdf，保持扩展名
  var ext = (file.t || '').toLowerCase();
  if (ext && !safe.toLowerCase().endsWith('.' + ext)) {
    safe = safe + '.' + ext;
  }

  // 文档：chrome.downloads
  return new Promise(function (rs, rj) {
    chrome.downloads.download({
      url: resolved.url,
      filename: safe,
      saveAs: false,
      conflictAction: 'uniquify'
    }, function (id) {
      if (chrome.runtime.lastError) {
        // 如果失败，给出清晰的错误信息
        rj(new Error(chrome.runtime.lastError.message || 'Download blocked'));
      } else {
        rs({ ok: true, name: safe, id: id });
      }
    });
  });
}

// ====== 消息处理 ======
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.action !== 'dl') return;

  var files = msg.files, params = msg.params;
  if (!params.ref && sender.tab) params.ref = sender.tab.url;
  if (!params.ref) params.ref = 'https://mooc2-ans.chaoxing.com/';

  processFiles(files, params, sender.tab ? sender.tab.id : null);
  sendResponse({ accepted: true });
});

async function processFiles(files, params, tabId) {
  var total = files.length, ok = 0, fail = 0;

  for (var j = 0; j < files.length; j++) {
    var f = files[j];
    notify(tabId, { ev: 'prog', f: f.n || f.name || 'file', j: j, total: total, ok: ok, fail: fail });

    try {
      var resolved = await downloadOne(f, params);
      C('resolved:', (f.n || 'file'), '→', resolved.type, resolved.url ? resolved.url.slice(0, 80) : '');
      var result = await executeDownload(resolved, f);

      ok++;
      notify(tabId, { ev: 'ok', f: f.n || f.name, ok: ok, fail: fail, total: total });
    } catch (e) {
      fail++;
      C('FAIL:', f.n || f.name, e.message);
      notify(tabId, { ev: 'fail', f: f.n || f.name, ok: ok, fail: fail, total: total, err: e.message });
    }
  }

  notify(tabId, { ev: 'done', ok: ok, fail: fail, total: total });
}

function notify(tabId, data) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, { action: 'cxProg', data: data }).catch(function () { });
  }
}
