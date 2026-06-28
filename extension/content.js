// ================================================================
// 超星课件下载助手 v7.0 — Content Script
// 全页面兼容（资料页 + 课程学习页），复选框修复，按 objectId 去重
// ================================================================
(function () {
  'use strict';
  if (window.top !== window.self) return;

  // ====== 状态 ======
  var files = [], params = {}, sel = {}, show = false, busy = false;
  var lastHref = location.href;
  var started = false;
  var courseName = '';

  // ====== 辅助 ======
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function $(id) { return document.getElementById(id); }

  // ====== 提取参数 ======
  function extractParams(p) {
    document.querySelectorAll('input[type="hidden"]').forEach(function (inp) {
      var id = (inp.id || inp.name || '').toLowerCase();
      if (id === 'courseid' || id === 'course_id') p.cid = inp.value;
      if (id === 'classid' || id === 'clazzid') p.cl = inp.value;
      if (id === 'cpi') p.cpi = inp.value;
      if (id === 'coursename') courseName = inp.value;
    });
    // 从 URL 提取
    var um = location.href.match(/courseid[=:](\d+)/i); if (!p.cid && um) p.cid = um[1];
    var cm = location.href.match(/clazzid[=:](\d+)/i); if (!p.cl && cm) p.cl = cm[1];
    var pm = location.href.match(/cpi[=:](\d+)/i); if (!p.cpi && pm) p.cpi = pm[1];
  }

  // ====== 扫描：资料页（新版，无iframe） ======
  function scanDataPage() {
    var nodes = document.querySelectorAll('li.dataBody_file[onclick*="toOpen"]');
    if (!nodes.length) {
      // 也试试 DT 元素（某些版本页面结构不同）
      nodes = document.querySelectorAll('dt[onclick*="toOpen"]');
    }
    if (!nodes.length) return null;

    var list = [], p = {}, seen = {};
    extractParams(p);

    for (var i = 0; i < nodes.length; i++) {
      var oc = nodes[i].getAttribute('onclick').replace(/\n\s*/g, '');
      // 兼容不同参数个数的 toOpen
      var m = oc.match(/toOpen\('([^']*)','([^']*)',(\d+),'([^']*)','([^']*)'/);
      if (!m) continue;

      var oid = m[5], did = m[3];
      var dedupKey = did + '_' + oid;
      if (seen[dedupKey]) continue;
      seen[dedupKey] = true;

      // 检测 disabled 状态
      var isDisabled = false;
      var option = nodes[i].closest('[role="option"]');
      if (option) {
        isDisabled = !!option.querySelector('li.dataBody_disabled');
      }
      // 也检查兄弟/父级
      if (!isDisabled) {
        var li = nodes[i].closest('li') || nodes[i];
        var parent = li.parentElement;
        if (parent) {
          isDisabled = !!parent.querySelector('.dataBody_disabled');
        }
      }

      // 跳过视频文件
      var ft = (m[2] || '').toLowerCase();
      if (ft === 'mp4' || ft === 'mp3' || ft === 'm4a' || ft === 'flv') continue;

      list.push({
        n: decodeURIComponent(m[1]).replace(/\+/g, ' '),
        t: ft,
        did: m[3],
        oid: oid,
        dis: isDisabled
      });
    }

    return list.length > 0 ? { list: list, p: p } : null;
  }

  // ====== 扫描：资料页（旧版，iframe） ======
  function scanDataPageLegacy() {
    var ifr = document.querySelector('iframe[name="frame_content-zl"]');
    if (!ifr) return null;
    var doc;
    try { doc = ifr.contentDocument || ifr.contentWindow.document; } catch (_) { return null; }
    if (!doc) return null;

    var nodes = doc.querySelectorAll('[onclick*="toOpen"]');
    if (!nodes.length) return null;

    var list = [], p = {}, seen = {};
    doc.querySelectorAll('input[type="hidden"]').forEach(function (inp) {
      var id = (inp.id || inp.name || '').toLowerCase();
      if (id === 'courseid' || id === 'course_id') p.cid = inp.value;
      if (id === 'classid' || id === 'clazzid') p.cl = inp.value;
      if (id === 'cpi') p.cpi = inp.value;
    });

    for (var i = 0; i < nodes.length; i++) {
      var oc = nodes[i].getAttribute('onclick').replace(/\n\s*/g, '');
      var m = oc.match(/toOpen\('([^']*)','([^']*)',(\d+),'([^']*)','([^']*)'/);
      if (!m) continue;

      // 跳过视频文件
      var tt = (m[2] || '').toLowerCase();
      if (tt === 'mp4' || tt === 'mp3' || tt === 'm4a' || tt === 'flv') continue;

      var dedupKey = m[3] + '_' + m[5];
      if (seen[dedupKey]) continue;
      seen[dedupKey] = true;
      var td = nodes[i].closest('[id]');
      list.push({
        n: decodeURIComponent(m[1]).replace(/\+/g, ' '),
        t: tt,
        did: m[3], oid: m[5],
        dis: !!(td && td.querySelector('.dataBody_disabled'))
      });
    }
    return list.length > 0 ? { list: list, p: p } : null;
  }

  // ====== 扫描：课程学习页面 ======
  function scanCoursePage() {
    var p = {};
    extractParams(p);
    if (!p.cid) return null;

    var list = [], seen = {};

    // 进入主 iframe（knowledge/cards）
    var mainIframe = document.querySelector('iframe[src*="knowledge/cards"], iframe[id="iframe"][src*="mooc-ans"]');
    var doc = null;
    if (mainIframe) {
      try { doc = mainIframe.contentDocument || mainIframe.contentWindow.document; } catch (_) {}
    }

    // 从主 iframe 找课件资源
    if (doc) {
      findCoursewareInDoc(doc, list, seen, p, mainIframe);
    }

    // 如果主 iframe 没内容，扫描所有同源 iframe
    if (list.length === 0) {
      var allFrames = document.querySelectorAll('iframe');
      for (var f = 0; f < allFrames.length && list.length === 0; f++) {
        try {
          var fdoc = allFrames[f].contentDocument || allFrames[f].contentWindow.document;
          if (fdoc) findCoursewareInDoc(fdoc, list, seen, p, allFrames[f]);
        } catch (_) {}
      }
    }

    // 获取章节名
    var chapterName = extractChapterName();

    // 对每个文件附上章节名（仅当文件没有自带名字时）
    for (var i = 0; i < list.length; i++) {
      if (chapterName) list[i].chapter = chapterName;
      // 只在文件名为空或为占位符时用章节名
      if ((!list[i].n || list[i].n.indexOf('课件_') === 0) && chapterName) {
        list[i].n = chapterName + (list[i].t ? '.' + list[i].t : '');
      }
    }

    return list.length > 0 ? { list: list, p: p } : null;
  }

  // 在文档中查找课件 iframe（带 objectid 或 data JSON）
  function findCoursewareInDoc(doc, list, seen, p, parentIframe) {
    if (!doc) return;
    var frames = doc.querySelectorAll('iframe[objectid], iframe[data*="objectid"]');
    if (!frames.length) frames = doc.querySelectorAll('iframe');

    for (var j = 0; j < frames.length; j++) {
      var f = frames[j];
      var oid = f.getAttribute('objectid') || '';
      var dataStr = f.getAttribute('data') || '';

      // 从 data JSON 提取信息
      if (!oid && dataStr) {
        try {
          var dataObj = JSON.parse(dataStr);
          oid = dataObj.objectid || dataObj.objectId || '';
        } catch (_) {}
      }

      if (!oid) continue;
      if (seen[oid]) continue;
      seen[oid] = true;

      // 从 data JSON 或 src 提取文件信息
      var name = '', type = '', src = f.src || '', extParam = '';

      if (dataStr) {
        try {
          var d = JSON.parse(dataStr);
          name = d.name || d.title || '';
          type = (d.type || '').replace(/^\./, '').toLowerCase();
        } catch (_) {}
      }

      // 跳过视频文件（视频下载已禁用）
      if (type === 'mp4' || type === 'mp3' || type === 'm4a' || type === 'flv') continue;
      if (!type && (src.indexOf('/video/') > -1 || src.indexOf('/modules/video/') > -1)) continue;

      // 从 src 推断类型
      if (!type) {
        if (src.indexOf('/pdf/') > -1) type = 'pdf';
      }

      // 从 data name 生成名称
      if (!name) name = '课件_' + (list.length + 1);
      if (type && !name.toLowerCase().endsWith('.' + type)) name = name + '.' + type;

      // 尝试找对应的 screen/file iframe 获取 ext 参数
      if (oid) {
        var screenFrames = doc.querySelectorAll('iframe[src*="screen/file"][src*="' + oid + '"]');
        for (var s = 0; s < screenFrames.length; s++) {
          var sfSrc = screenFrames[s].src || '';
          var em = sfSrc.match(/ext=([^&]+)/);
          if (em) { extParam = decodeURIComponent(em[1]); break; }
        }
        // 也尝试从当前页面或主 iframe 的 iframe 中找
        if (!extParam) {
          var allScreenFrames = document.querySelectorAll('iframe[src*="screen/file"]');
          for (var as = 0; as < allScreenFrames.length; as++) {
            var asSrc = allScreenFrames[as].src || '';
            if (asSrc.indexOf(oid) > -1) {
              var em2 = asSrc.match(/ext=([^&]+)/);
              if (em2) { extParam = decodeURIComponent(em2[1]); break; }
            }
          }
        }
        // 如果还是没找到 ext，构造一个（用于视频等无 screen/file 的文件）
        if (!extParam && p.cid && p.cl) {
          // ext = {"_from_":"courseId_classId_userId_enc"}
          // 尝试从页面获取 userId 和 enc
          var userId = '';
          var enc = '';
          document.querySelectorAll('input[type="hidden"]').forEach(function (inp) {
            var id = (inp.id || inp.name || '').toLowerCase();
            if (id === 'userid') userId = inp.value;
          });
          // 从 URL 获取 enc
          var encMatch = location.href.match(/[?&]enc=([^&]+)/);
          if (encMatch) enc = encMatch[1];
          if (!enc) {
            var encMatch2 = (parentIframe && parentIframe.src || '').match(/enc=([^&]+)/);
            if (encMatch2) enc = encMatch2[1];
          }
          if (userId && enc) {
            extParam = JSON.stringify({ _from_: p.cid + '_' + p.cl + '_' + userId + '_' + enc });
          }
        }
      }

      list.push({
        n: name,
        t: type,
        did: '0',
        oid: oid,
        dis: true,
        ext: extParam
      });
    }
  }

  // 提取章节名称
  function extractChapterName() {
    // 从左侧目录高亮项
    var sel = document.querySelector('.catalog_section .current, [class*="chapter_item"].current, [class*="chapter"][class*="active"], .chapterName_current');
    if (sel) return cleanChapterName(sel.textContent);

    // 从页面标题
    var h2 = document.querySelector('h2');
    if (h2) return cleanChapterName(h2.textContent);

    // 从 URL 参数
    var cm = location.href.match(/chapterId=(\d+)/);
    if (cm) return '章节_' + cm[1];

    return '';
  }

  function cleanChapterName(txt) {
    // 过滤通用占位文本
    var generic = ['章节详情', '学生学习页面', '正文', '课程'];
    var cleaned = (txt || '').replace(/^[\d.\s]+/, '').replace(/\s+/g, ' ').trim();
    if (generic.indexOf(cleaned) > -1 || cleaned.length < 2) return '';
    return cleaned.slice(0, 60);
  }

  // ====== 统一扫描入口 ======
  function scan() {
    var d;
    d = scanDataPage();    if (d) return d;
    d = scanDataPageLegacy(); if (d) return d;
    d = scanCoursePage();  if (d) return d;
    return null;
  }

  // ====== UI 构建 ======
  function buildUI() {
    if ($('__cx0')) return;
    var r = document.createElement('div'); r.id = '__cx0';
    r.innerHTML =
      '<div id="__cxP" class="cx-pnl" style="display:none">' +
        '<div id="__cxH" class="cx-hd"><span class="cx-tt">📚 课件助手</span><span id="__cxN"></span><button class="cx-x" id="__cxX">×</button></div>' +
        '<div class="cx-body">' +
          '<div class="cx-bar">' +
            '<button class="cx-b" id="__cxSA">☐ 全选</button>' +
            '<button class="cx-b cx-br" id="__cxSR">🔒 仅限</button>' +
            '<button class="cx-b cx-bl" id="__cxDL" disabled>⬇ 下载 (0)</button>' +
          '</div>' +
          '<div class="cx-lst" id="__cxL"></div>' +
          '<div class="cx-st" id="__cxSt"></div>' +
        '</div>' +
      '</div>' +
      '<button class="cx-flt" id="__cxF">📥</button>';
    document.body.appendChild(r);

    var flt = $('__cxF'), pnl = $('__cxP');

    // 浮动按钮：点击=切换，拖动=移动
    var drag = null;
    flt.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
      var rect = flt.getBoundingClientRect();
      drag = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, m: false };
    });
    document.addEventListener('mousemove', function (e) {
      if (!drag) return;
      if (!drag.m && (Math.abs(e.clientX - drag.sx) > 3 || Math.abs(e.clientY - drag.sy) > 3)) drag.m = true;
      if (!drag.m) return;
      flt.style.left = Math.max(0, Math.min(drag.ox + e.clientX - drag.sx, innerWidth - 48)) + 'px';
      flt.style.top = Math.max(0, Math.min(drag.oy + e.clientY - drag.sy, innerHeight - 48)) + 'px';
      flt.style.right = 'auto'; flt.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () {
      if (!drag) return;
      if (!drag.m) toggle();
      drag = null;
    });

    $('__cxX').addEventListener('click', function (e) { e.stopPropagation(); hide(); });

    // 面板拖动
    var pd = null;
    $('__cxH').addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      e.preventDefault(); e.stopPropagation();
      pd = { sx: e.clientX, sy: e.clientY, ox: pnl.getBoundingClientRect().left, oy: pnl.getBoundingClientRect().top };
    });
    document.addEventListener('mousemove', function (e) {
      if (!pd) return;
      pnl.style.left = Math.max(0, Math.min(pd.ox + e.clientX - pd.sx, innerWidth - 410)) + 'px';
      pnl.style.top = Math.max(0, Math.min(pd.oy + e.clientY - pd.sy, innerHeight - 510)) + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { pd = null; });

    // 按钮事件
    $('__cxSA').addEventListener('click', function (e) { e.stopPropagation(); toggleAll(); });
    $('__cxSR').addEventListener('click', function (e) { e.stopPropagation(); selRestricted(); });
    $('__cxDL').addEventListener('click', function (e) { e.stopPropagation(); startDownload(); });

    // 文件列表事件委托
    $('__cxL').addEventListener('click', function (e) {
      // 让 checkbox 原生处理 + change 事件同步
      if (e.target.tagName === 'INPUT' && e.target.type === 'checkbox') return;
      var row = e.target.closest('[data-i]');
      if (!row) return;
      var i = parseInt(row.dataset.i);
      if (isNaN(i)) return;
      sel[i] = !sel[i];
      var cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = sel[i];
      updateBtn();
    });
    $('__cxL').addEventListener('change', function (e) {
      if (e.target.type !== 'checkbox') return;
      var row = e.target.closest('[data-i]');
      if (!row) return;
      var i = parseInt(row.dataset.i);
      if (isNaN(i)) return;
      sel[i] = e.target.checked;
      updateBtn();
    });
  }

  function toggle() {
    show = !show;
    var pnl = $('__cxP'), flt = $('__cxF');
    if (!pnl || !flt) return;
    // 先读取按钮坐标（隐藏元素返回全零）
    var r = flt.getBoundingClientRect();
    pnl.style.display = show ? 'flex' : 'none';
    flt.style.display = show ? 'none' : 'flex';
    if (show) {
      var l = r.right + 8, t = r.top;
      if (l + 410 > innerWidth - 8) l = r.left - 418;
      if (l < 8) l = 8;
      if (t + 510 > innerHeight - 8) t = innerHeight - 518;
      if (t < 8) t = 8;
      pnl.style.left = l + 'px'; pnl.style.top = t + 'px';
      pnl.style.right = 'auto'; pnl.style.bottom = 'auto';
    }
  }
  function hide() {
    show = false;
    if ($('__cxP')) $('__cxP').style.display = 'none';
    if ($('__cxF')) $('__cxF').style.display = 'flex';
  }

  // ====== 渲染 ======
  function render() {
    var lst = $('__cxL');
    if (!lst) return;
    var icons = { pdf: '📄', pptx: '📊', ppt: '📊', doc: '📝', docx: '📝', mp4: '🎬', mp3: '🎵', m4a: '🎵', flv: '🎬', png: '🖼', jpg: '🖼', jpeg: '🖼' };
    var h = '';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      // 确保 checkbox 直接可见（不用 label 包裹导致样式问题）
      h += '<div class="cx-row ' + (f.dis ? 'cx-lk' : 'cx-ok') + '" data-i="' + i + '">' +
        '<input type="checkbox" class="cx-cb" ' + (sel[i] ? 'checked' : '') + '>' +
        '<span class="cx-ico">' + (icons[f.t] || '📎') + '</span>' +
        '<span class="cx-nm" title="' + esc(f.n) + '">' + esc(f.n) + '</span>' +
        '<span class="cx-tg ' + (f.dis ? 'cx-tl' : 'cx-to') + '">' + (f.dis ? '🔒' : '✅') + '</span>' +
        '</div>';
    }
    lst.innerHTML = h || '<div class="cx-emp">等待文件列表...</div>';
    $('__cxN').textContent = files.length + ' 文件';
    updateBtn();
  }

  function updateBtn() {
    var sc = 0;
    for (var k in sel) if (sel[k]) sc++;
    $('__cxSA').textContent = (sc === files.length && files.length > 0) ? '☑ 全不选' : '☐ 全选';
    $('__cxDL').disabled = sc === 0 || busy;
    $('__cxDL').textContent = '⬇ 下载 (' + sc + ')';
  }

  function toggleAll() {
    var allSel = true;
    for (var i = 0; i < files.length; i++) if (!sel[i]) { allSel = false; break; }
    if (allSel && files.length > 0) sel = {};
    else for (var i = 0; i < files.length; i++) sel[i] = true;
    render();
  }
  function selRestricted() {
    sel = {};
    for (var i = 0; i < files.length; i++) if (files[i].dis) sel[i] = true;
    render();
  }

  // ====== 下载 ======
  function startDownload() {
    if (busy) return;
    var list = [];
    for (var i = 0; i < files.length; i++) if (sel[i]) list.push(files[i]);
    if (!list.length) return;
    busy = true; render();
    $('__cxSt').textContent = '⏳ 共 ' + list.length + ' 文件...'; $('__cxSt').className = 'cx-st';

    chrome.runtime.sendMessage(null, {
      action: 'dl',
      files: list.map(function (f) {
        var name = f.n;
        if (f.chapter && f.chapter.trim()) name = f.chapter + (f.t ? '.' + f.t : '');
        return { n: name, t: f.t, did: f.did, oid: f.oid, dis: f.dis, ext: f.ext || '' };
      }),
      params: { cpi: params.cpi, cid: params.cid, cl: params.cl, ref: location.href }
    });
  }

  // ====== 消息处理 ======
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg.action === 'getStats') {
      var restricted = 0;
      for (var i = 0; i < files.length; i++) if (files[i].dis) restricted++;
      sendResponse({ filesCount: files.length, restrictedCount: restricted, courseName: courseName || document.title || '当前课程' });
      return;
    }
    if (msg.action === 'cxProg') {
      var d = msg.data;
      if (d.ev === 'prog') {
        $('__cxSt').textContent = '⬇ ' + (d.j + 1) + '/' + d.total + ': ' + (d.f.length > 30 ? d.f.slice(0, 28) + '..' : d.f);
        $('__cxSt').className = 'cx-st';
        $('__cxDL').textContent = '⏳ ' + (d.j + 1) + '/' + d.total;
      } else if (d.ev === 'ok') {
        $('__cxSt').textContent = '✅ ' + d.ok + '/' + d.total + ': ' + (d.f.length > 25 ? d.f.slice(0, 23) + '..' : d.f);
        $('__cxSt').className = 'cx-st cx-ss';
      } else if (d.ev === 'fail') {
        $('__cxSt').textContent = '❌ ' + (d.f.length > 25 ? d.f.slice(0, 23) + '..' : d.f) + ': ' + (d.err || '');
        $('__cxSt').className = 'cx-st cx-se';
      } else if (d.ev === 'done') {
        $('__cxSt').textContent = d.fail ? '⚠️ 完成: ' + d.ok + '成功, ' + d.fail + '失败' : '✅ 全部完成! ' + d.ok + ' 文件';
        $('__cxSt').className = 'cx-st ' + (d.fail ? 'cx-sw' : 'cx-ss');
        busy = false; render();
      }
    }
  });

  // ====== 轮询 ======
  function poll() {
    if (location.href !== lastHref) { lastHref = location.href; files = []; sel = {}; courseName = ''; }
    var d = scan();
    if (d && d.list.length > 0) {
      params = d.p;
      // 保留旧选择（按 oid 匹配）
      var old = {};
      for (var i = 0; i < files.length; i++) old[files[i].oid] = !!sel[i];
      files = d.list;
      sel = {};
      for (var i = 0; i < files.length; i++) sel[i] = old[files[i].oid] || false;
      render();
    }
  }

  // ====== 启动 ======
  function boot() {
    if (started) return;
    started = true;
    buildUI();
    poll();
    setInterval(poll, 2000);
    console.log('[CX] v7.0 ready — url:', location.href);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
  setTimeout(function () { if (!started) boot(); }, 3000);
})();
