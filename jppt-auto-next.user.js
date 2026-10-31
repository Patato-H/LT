// ==UserScript==
// @name         轨道云课堂 · 自动连播 v2.9.8
// @namespace    patatooo.jppt
// @version      2.9.8
// @description  我的课程-自选课程队列驱动：自动 2 倍速、按剩余学时/2 定时到点检验、课程完成自动下一门、评估自动满分提交（问答留空）；不 seek、不跳秒、不碰考试
// @author       Patatooo
// @match        https://jppt.hfgdjt.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 最先执行：接管阻塞式原生弹窗 ----------
  // 平台的"登录已超时或账号在其他设备登录，是否确定继续浏览？"是原生 confirm，
  // 会阻塞整个 JS 线程让脚本彻底停摆。我们自动返回 true（=点"确定"），
  // 之后由掉线检测刷新重登。alert 同理静默，beforeunload 不拦。
  try {
    if (!window.__JPPT_DLG_HOOKED__) {
      window.__JPPT_DLG_HOOKED__ = true;
      var _origConfirm = window.confirm;
      window.confirm = function (msg) {
        // 登录超时/被顶号类 → 直接确定；其它确认框也放行（脚本场景无需人工确认）
        return true;
      };
      window.alert = function (msg) {
        // 记录到控制台，不弹阻塞框
        try { console.log('[jppt] alert suppressed:', msg); } catch (e) {}
      };
      window.onbeforeunload = null;
      window.addEventListener('beforeunload', function (e) {
        // 允许离开，不弹"确定要离开吗"
        try { delete e.returnValue; } catch (err) {}
      });
    }
  } catch (e) {}

  if (window.__JPPT_AUTO_NEXT__) return;
  window.__JPPT_AUTO_NEXT__ = true;

  // ---------- 配置 ----------
  var CFG = {
    pollMs: 1500,        // 轮询间隔（提速：4s→1.5s）
    hold: 1,             // 连续 N 次确认"已完成"才切换（✓ 是平台权威状态，1 轮即切）
    graceSec: 3,         // 视频播到 minStudyTime 前 3 秒即可返回（平台已打点）
    docExtraSec: 6,      // 课件型：墙钟到点后再等 6 秒返回
    rate: 2,             // 播放倍速（平台官方倍速能力）
    muted: true,         // 自动静音播放（移动端浏览器只有静音才允许无手势自动播放）
    checkpointZone: 2.5, // 距平台打点帧多少秒内降回 1 倍速（保证精确命中，避免跨帧漏报）
    stallSec: 30,        // 视频进度停滞多少秒判定掉线 → 刷新重登
    docStallSec: 90,     // PDF/文档课 studiedTime 停滞多少秒判定掉线（平台每 60s 才 +1，阈值需 >60）
    lmRounds: 8,         // 列表"加载更多"连续几轮无新增才认为到底（×pollMs≈秒数）
    listEmptySec: 5,     // 列表一直加载不出来多少秒后强制刷新
    corp: 'hfgdjt',      // 企业 ID（全站固定值，可分享）
    qq: '3183339668',    // QQ 号：浮窗缩小后的圆形头像（公开头像接口）
  };

  var state = {
    enabled: true,
    started: false,                    // 是否已点「开始拯救时间」（闸门）
    mini: false,                       // 浮窗是否缩小成头像小圆钮
    empId: '',                         // 工号（本机 localStorage，账号密码都用它）
    docOpenedAt: 0, docMinMs: 0,       // 课件型计时
    docHold: 0,                        // 文档课 studiedTime 达标后的等待起点
    lastClickId: '', lastClickAt: 0,
    holdCnt: 0,
    checkAt: 0,                        // 课程级"到点检验"时刻
    curMsSec: 0,                       // 当前节打点帧（秒），供倍速降挡
    courseTitle: '',                   // 当前课程名（完成时记入 doneCourses）
    startWall: 0,                      // 点「开始拯救时间」的时刻（算拯救时长）
    sessionStart: 0,                   // 本次连续运行起点（空闲断档>阈值则归零重算）
    lastActiveAt: 0,                   // 上次活跃时刻（判本次是否断档）
    lmLastN: -1, lmSameCnt: 0,         // 列表滚动加载
  };
  var doneCourses = {};                // 已确认结业的课程名（内存级）
  var doneEval = {};                   // 已提交过评估的课程名
  var doneStudy = {};                  // 学习已完成（含文档课读满学时）的课程名
  var progFn = null;                   // 浮窗进度文案函数（详情页赋值）

  // 跨整页跳转持久化「已开始/起始时间/已完成课程」。用 localStorage：Via WebView 在带 ?r= 的整页跳转里会清 sessionStorage，导致 started 丢失→反复要点开始的死循环
  try {
    var _p = JSON.parse(localStorage.getItem('jppt_state') || '{}');
    if (_p.started) { state.started = true; state.startWall = _p.startWall || 0; }
    if (_p.done) doneCourses = _p.done;
    if (_p.eval) doneEval = _p.eval;
    if (_p.study) doneStudy = _p.study;
  } catch (e) {}
  try { state.empId = localStorage.getItem('jppt_emp') || ''; } catch (e) {}
  // 本次运行时长持久化：sessionStart 本次起点；lastActiveAt 上次活跃（断档>3分钟则本次归零）
  var IDLE_GAP = 180000;
  try {
    var _t = JSON.parse(localStorage.getItem('jppt_time') || '{}');
    var _la = _t.last || 0, _now = Date.now();
    state.sessionStart = (_la && (_now - _la) > IDLE_GAP) ? _now : (_t.session || _now);
    state.lastActiveAt = _now;
  } catch (e) { state.sessionStart = Date.now(); state.lastActiveAt = Date.now(); }
  function persist() {
    try {
      localStorage.setItem('jppt_state', JSON.stringify({
        started: state.started, startWall: state.startWall, done: doneCourses, eval: doneEval, study: doneStudy,
        log: evLog.slice(-40)
      }));
    } catch (e) {}
  }
  function persistTime() {
    try {
      localStorage.setItem('jppt_time', JSON.stringify({
        last: state.lastActiveAt, session: state.sessionStart
      }));
    } catch (e) {}
  }

  // ---------- 工具 ----------
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function hash() { return location.hash || ''; }
  function inPlayer() { return /\/course\/detail\/[^/]+\/URL\//.test(hash()); }
  // 只有真正进入"文档阅读页"才算（URL 含 /ONLINEDOC/URL/）；详情页不是
  function inOnlineDoc() { return /\/ONLINEDOC\/URL\//i.test(hash()); }
  function inDetail() { return /\/course\/detail\/[A-Za-z_]+\/[0-9a-f]{32}\/?$/i.test(hash()); }
  function inMyList() { return /#\/course\/my/.test(hash()); }

  // 页面是否明确显示「已完成」角标（课程已结业的权威标志）
  function pageShowsFinished() {
    var els = [].slice.call(document.querySelectorAll('[class*=badge], [class*=tag], [class*=finish], [class*=status]'));
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e.offsetParent) continue;                       // 不可见不算
      var t = (e.textContent || '').replace(/\s/g, '');
      if (t === '已完成') return true;
    }
    return false;
  }

  // ONLINEDOC 文档课组件：持有 courseInfo.minStudyTime(分钟) / studiedTime / finishStatus
  function docVm() {
    var el = $('.online-doc') || $('.detail-online-doc') || $('.waterMarker');
    var p = el;
    for (var i = 0; i < 10 && p; i++) {
      if (p.__vue__) {
        var d = p.__vue__._data || {};
        if (d.courseInfo && d.studiedTime !== undefined) return p.__vue__;   // 两个特征都要有，防认错组件
      }
      p = p.parentElement;
    }
    // 兜底：遍历页面节点，找带 courseInfo+studiedTime 的组件
    var nodes = document.querySelectorAll('div,section,ul');
    for (var j = 0; j < nodes.length; j++) {
      var v = nodes[j].__vue__;
      if (v) {
        var dd = v._data || {};
        if (dd.courseInfo && dd.studiedTime !== undefined) return v;
      }
    }
    return null;
  }

  function minMsFromUrl() {
    var m = hash().match(/minStudyTime=(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  function nowHM() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }

  // 操作日志（环形，最多存 60 条，浮窗显示最近 N 条；持久化到 localStorage，刷新/掉线重登后仍可见）
  var evLog = [];
  try { var _lg = JSON.parse(localStorage.getItem('jppt_state') || '{}'); if (Array.isArray(_lg.log)) evLog = _lg.log; } catch (e) {}
  function logEvent(msg) {
    if (!msg) return;
    var last = evLog[evLog.length - 1];
    if (last && last.msg === msg) return;   // 连续相同事件跳过，保留首次那条
    evLog.push({ t: nowHM(), msg: msg });
    if (evLog.length > 60) evLog.shift();
    persist();                              // 落盘，刷新/跳转后日志不丢
  }

  function clickEl(el) {
    if (!el) return false;
    try {
      var r = el.getBoundingClientRect();
      if (window.PointerEvent && r && r.width) {
        var o = { bubbles: true, cancelable: true, view: window, pointerId: 1, isPrimary: true,
                  clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        el.dispatchEvent(new PointerEvent('pointerup', o));
      }
      el.click();
    } catch (e) {}
    return true;
  }

  var badgeEl = null;
  var BADGE_CSS = '.jp-badge{position:fixed;left:10px;bottom:96px;z-index:999999;width:min(72vw,320px);' +
    'padding:10px 14px 12px;border-radius:16px;cursor:pointer;font-family:-apple-system,"PingFang SC",sans-serif;' +
    'background:linear-gradient(135deg,rgba(18,28,58,.88),rgba(8,12,26,.92));' +
    'border:1px solid rgba(110,170,255,.35);box-shadow:0 0 18px rgba(70,130,255,.35),0 4px 20px rgba(0,0,0,.5);' +
    'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#eaf2ff;}' +
    '.jp-badge *{margin:0;padding:0;box-sizing:border-box;}' +
    '.jp-hd{display:flex;align-items:center;gap:7px;margin-bottom:6px;}' +
    '.jp-dot{width:9px;height:9px;border-radius:50%;background:#3dffa0;box-shadow:0 0 8px #3dffa0;animation:jpPulse 1.4s ease-in-out infinite;flex:none;}' +
    '.jp-badge.jp-off .jp-dot{background:#8a93a6;box-shadow:none;animation:none;}' +
    '.jp-title{font-size:12.5px;font-weight:700;letter-spacing:.5px;line-height:1.2;flex:1;' +
    'background:linear-gradient(90deg,#7cc4ff,#b388ff,#7cc4ff);-webkit-background-clip:text;background-clip:text;color:transparent;}' +
    '.jp-rate{font-size:11px;font-weight:800;color:#ffd76a;border:1px solid rgba(255,215,106,.5);border-radius:8px;padding:1px 6px;height:20px;line-height:18px;display:inline-flex;align-items:center;}' +
    '.jp-mute{font-size:12px;font-weight:800;color:#7cc4ff;border:1px solid rgba(124,196,255,.5);border-radius:8px;padding:0 5px;height:20px;line-height:18px;display:inline-flex;align-items:center;justify-content:center;}' +
    '.jp-mute.jp-unmute{color:#8a93a6;border-color:rgba(138,147,166,.4);}' +
    '.jp-main{font-size:17px;font-weight:700;line-height:1.35;text-shadow:0 0 10px rgba(120,180,255,.4);word-break:break-all;}' +
    '.jp-sub{font-size:12px;color:#9fb4d8;margin-top:3px;min-height:0;}' +
    '.jp-run{font-size:11px;color:#8fe3c0;margin-top:5px;letter-spacing:.3px;}' +
    '.jp-run b{color:#3dffa0;font-weight:700;font-variant-numeric:tabular-nums;}' +
    '.jp-badge.jp-off .jp-run b{color:#8a93a6;}' +
    '.jp-acct{font-size:11px;color:#9fb4d8;margin-top:4px;display:flex;align-items:center;gap:6px;}' +
    '.jp-acct-id{color:#ffd76a;font-weight:700;font-variant-numeric:tabular-nums;}' +
    '.jp-switch{margin-left:auto;font-size:10px;color:#7cc4ff;border:1px solid rgba(124,196,255,.45);border-radius:7px;padding:1px 7px;cursor:pointer;}' +
    '.jp-switch:active{background:rgba(124,196,255,.2);}' +
    '.jp-foot{font-size:10px;color:#6f83a8;margin-top:7px;padding-top:5px;letter-spacing:.3px;' +
    'border-top:1px solid rgba(120,160,255,.18);word-break:break-all;}' +
    '.jp-log{margin-top:6px;border-top:1px solid rgba(120,160,255,.15);padding-top:5px;max-height:0;overflow:hidden;' +
    'transition:max-height .25s ease;font-family:ui-monospace,Menlo,monospace;}' +
    '.jp-badge.jp-open .jp-log{max-height:220px;overflow-y:auto;}' +
    '.jp-log-hd{font-size:10px;color:#7cc4ff;letter-spacing:.5px;margin-bottom:3px;display:flex;justify-content:space-between;}' +
    '.jp-log-item{font-size:10.5px;color:#b9cdec;line-height:1.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.jp-log-item b{color:#ffd76a;font-weight:600;margin-right:5px;}' +
    '.jp-badge:not(.jp-open) .jp-log-item:nth-child(n+4){display:none;}' +
    '.jp-badge:not(.jp-open) .jp-log{max-height:none;}' +
    '.jp-badge:not(.jp-open) .jp-log-hd::after{content:" · 轻点展开 ▾";color:#5f7499;}' +
    '.jp-badge.jp-open .jp-log-hd::after{content:" · 收起 ▴";color:#5f7499;}' +
    '.jp-bar{height:4px;border-radius:2px;background:rgba(255,255,255,.12);margin-top:8px;overflow:hidden;}' +
    '.jp-bar i{display:block;height:100%;width:40%;border-radius:2px;' +
    'background:linear-gradient(90deg,#4f8dff,#b388ff);animation:jpSlide 2.2s ease-in-out infinite;}' +
    '.jp-badge.jp-off .jp-bar i{animation-play-state:paused;}' +
    '.jp-ctl{display:flex;align-items:center;gap:8px;margin-top:9px;}' +
    '.jp-btn{flex:none;font-size:12px;font-weight:700;color:#eaf2ff;padding:5px 14px;border-radius:10px;cursor:pointer;' +
    'border:1px solid rgba(124,196,255,.55);background:rgba(80,140,255,.16);' +
    'box-shadow:0 0 10px rgba(80,140,255,.25) inset;}' +
    '.jp-btn:active{background:rgba(80,140,255,.34);}' +
    '.jp-badge.jp-off .jp-btn{color:#ffd0d0;border-color:rgba(255,120,120,.55);background:rgba(255,90,90,.14);}' +
    '.jp-hint{font-size:10px;color:#5f7499;}' +
    '@keyframes jpPulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.45;transform:scale(.75);}}' +
    '@keyframes jpSlide{0%{margin-left:-40%;}100%{margin-left:100%;}}' +
    '.jp-fab{display:none;width:46px;height:46px;border-radius:50%;overflow:hidden;' +
    'border:2px solid rgba(124,196,255,.7);box-shadow:0 0 14px rgba(80,140,255,.5);}' +
    '.jp-fab img{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.jp-min{flex:none;font-size:10px;color:#7cc4ff;border:1px solid rgba(124,196,255,.5);border-radius:7px;' +
    'padding:0 6px;height:20px;display:inline-flex;align-items:center;cursor:pointer;}' +
    '.jp-badge.jp-mini{width:auto;padding:0;border-radius:50%;background:transparent;border:none;box-shadow:none;backdrop-filter:none;}' +
    '.jp-badge.jp-mini .jp-body{display:none;}' +
    '.jp-badge.jp-mini .jp-fab{display:block;}';

  // 设备信息（装逼用）：机型 · 系统 · 浏览器 · 屏幕 · 内核线程
  function deviceLine() {
    var ua = navigator.userAgent || '';
    var m, os = '', model = '', br = '';
    if ((m = ua.match(/Android\s+([\d.]+)/i))) { os = 'Android ' + m[1]; }
    else if ((m = ua.match(/(?:iPhone|iPad|iPod).*?OS\s+([\d_]+)/i))) { os = 'iOS ' + m[1].replace(/_/g, '.'); model = 'iOS'; }

    // 机型解析：兼容 "Android 14; 机型 Build/…"、"Android 14; 机型; wv)"、"Android 14) 机型"
    if ((m = ua.match(/Android\s+[\d.]+;\s*([^;)]+?)\s*(?:Build\/|; ?wv\)|\))/i))) {
      model = m[1].trim();
    }
    // 清洗：去掉残留的 Build 片段、纯代号
    model = model.replace(/\s*Build\/.*$/i, '').replace(/\s*;?\s*wv\s*\)?\s*$/i, '').trim();
    // 明显不是机型（如 Generic/Unknown 或平台串）→ 清空走兜底
    if (/^(generic|unknown|linux|android)/i.test(model) || model.length > 24) model = '';
    if (!model) {
      // 兜底：UA 无机型（Via 隐私模式抹掉）→ 用 UA-CH 高熵接口尝试
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        try {
          navigator.userAgentData.getHighEntropyValues(['model']).then(function (h) {
            if (h && h.model && badgeEl) {
              var f = badgeEl.querySelector('.jp-foot');
              if (f) f.textContent = deviceLine();   // 拿到后刷新
            }
          });
        } catch (e) {}
      }
      model = (navigator.platform && navigator.platform !== 'Linux') ? navigator.platform : '';
    }
    var brs = [];
    if ((m = ua.match(/Via\/([\d.]+)/i))) brs.push('Via ' + m[1]);
    if ((m = ua.match(/Kiwi\s?\/?([\d.]*)/i))) brs.push('Kiwi');
    if ((m = ua.match(/EdgA?\/([\d.]+)/i))) brs.push('Edge ' + m[1]);
    if ((m = ua.match(/Firefox\/([\d.]+)/i))) brs.push('Firefox ' + m[1]);
    if ((m = ua.match(/Chrome\/([\d.]+)/i))) brs.push('Chrome ' + m[1]);
    br = brs[0] || 'Browser';
    var parts = [];
    if (model) parts.push(model);
    if (os) parts.push(os);
    parts.push(br);
    parts.push(screen.width + '×' + screen.height);
    if (navigator.hardwareConcurrency) parts.push(navigator.hardwareConcurrency + '核');
    return '⌘ ' + parts.join(' · ');
  }

  function badge(text) {
    if (!badgeEl) {
      var st = document.createElement('style'); st.textContent = BADGE_CSS;
      (document.head || document.documentElement).appendChild(st);
      badgeEl = document.createElement('div');
      badgeEl.className = 'jp-badge';
      var qqAvatar = 'https://q1.qlogo.cn/g?b=qq&nk=' + CFG.qq + '&s=100';
      badgeEl.innerHTML =
        '<div class="jp-fab"><img src="' + qqAvatar + '" alt="" onerror="this.style.display=\'none\'"></div>' +
        '<div class="jp-body">' +
        '<div class="jp-hd"><span class="jp-dot"></span><span class="jp-title">云课堂<br>史上最浪费时间之物</span><span class="jp-mute"></span><span class="jp-rate"></span><span class="jp-min">隐藏</span></div>' +
        '<div class="jp-main"></div><div class="jp-sub"></div>' +
        '<div class="jp-run">⏱ 本次稳定运行 <b class="jp-run-sess"></b></div>' +
        '<div class="jp-acct">👤 当前账号 <b class="jp-acct-id"></b><span class="jp-switch">切换账号</span></div>' +
        '<div class="jp-bar"><i></i></div>' +
        '<div class="jp-ctl"><span class="jp-btn"></span><span class="jp-hint">点按钮暂停/继续</span></div>' +
        '<div class="jp-log"><div class="jp-log-hd"><span>操作日志</span></div><div class="jp-log-body"></div></div>' +
        '<div class="jp-foot"></div>' +
        '</div>';
      badgeEl.querySelector('.jp-foot').textContent = deviceLine();
      // 只点「暂停/继续」按钮才切换；点日志区展开/收起；点其它区域不响应（防误触）
      badgeEl.querySelector('.jp-btn').addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (!state.started) {
          state.started = true; state.startWall = Date.now(); logEvent('开始拯救时间'); persist();
          try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {}
          keepAwake();
          goList();   // 点开始后立即强制跳到学习列表
        }
        else {
          state.enabled = !state.enabled; persist();
          if (state.enabled) keepAwake(); else releaseAwake();
        }
      });
      badgeEl.querySelector('.jp-log').addEventListener('click', function (ev) {
        ev.stopPropagation();
        badgeEl.classList.toggle('jp-open');
      });
      // 缩小按钮 → 折叠成头像小圆钮；点小圆钮 → 展开
      badgeEl.querySelector('.jp-min').addEventListener('click', function (ev) {
        ev.stopPropagation(); state.mini = true;
      });
      badgeEl.querySelector('.jp-fab').addEventListener('click', function (ev) {
        ev.stopPropagation(); state.mini = false;
      });
      // 切换账号：清本机工号与进度 → 退出登录 → 重新询问新工号
      badgeEl.querySelector('.jp-switch').addEventListener('click', function (ev) {
        ev.stopPropagation(); switchAccount();
      });
      // 拖标题栏可移动到任意位置（拖过后不再自动重定位）
      (function () {
        var hd = badgeEl.querySelector('.jp-hd');
        var sx, sy, ox, oy, dragging = false;
        function down(x, y) {
          dragging = true;
          var r = badgeEl.getBoundingClientRect();
          ox = r.left; oy = r.top; sx = x; sy = y;
          badgeEl.style.right = 'auto'; badgeEl.style.bottom = 'auto';
          badgeEl.style.left = ox + 'px'; badgeEl.style.top = oy + 'px';
        }
        function move(x, y) {
          if (!dragging) return;
          state._dragged = true;
          var nl = Math.max(2, Math.min(window.innerWidth - 60, ox + (x - sx)));
          var nt = Math.max(2, Math.min(window.innerHeight - 40, oy + (y - sy)));
          badgeEl.style.left = nl + 'px'; badgeEl.style.top = nt + 'px';
        }
        function up() { dragging = false; }
        hd.addEventListener('touchstart', function (e) { var t = e.touches[0]; down(t.clientX, t.clientY); }, { passive: true });
        hd.addEventListener('touchmove', function (e) { var t = e.touches[0]; move(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
        hd.addEventListener('touchend', up);
        hd.addEventListener('mousedown', function (e) { down(e.clientX, e.clientY); e.preventDefault(); });
        window.addEventListener('mousemove', function (e) { move(e.clientX, e.clientY); });
        window.addEventListener('mouseup', up);
      })();
      (document.body || document.documentElement).appendChild(badgeEl);
    }
    // 拆主/副信息：首段大字，其余小字
    var segs = String(text || '').split(' · ');
    var running = state.started && state.enabled;
    badgeEl.querySelector('.jp-main').textContent = (running ? '▶ ' : '⏸ ') + (segs[0] || '');
    badgeEl.querySelector('.jp-sub').textContent = segs.slice(1).join('  ·  ');
    badgeEl.querySelector('.jp-rate').textContent = CFG.rate + 'x';
    updateRunLine();
    var btnEl = badgeEl.querySelector('.jp-btn');
    if (btnEl) btnEl.textContent = !state.started ? '▶ 开始拯救时间' : (state.enabled ? '⏸ 暂停' : '▶ 继续');
    var hintEl = badgeEl.querySelector('.jp-hint');
    if (hintEl) hintEl.textContent = !state.started ? '进入列表后点开始' : '点按钮暂停/继续';
    var mb = badgeEl.querySelector('.jp-mute');
    if (mb) { mb.textContent = CFG.muted ? '🔇' : '🔊'; mb.className = 'jp-mute' + (CFG.muted ? '' : ' jp-unmute'); }
    var acctEl = badgeEl.querySelector('.jp-acct-id');
    if (acctEl) acctEl.textContent = state.empId || '未登录';
    var wasOpen = badgeEl.classList.contains('jp-open');
    badgeEl.className = 'jp-badge' + (running ? '' : ' jp-off') + (wasOpen ? ' jp-open' : '') + (state.mini ? ' jp-mini' : '');
    badgeEl.style.display = text ? 'block' : 'none';
    // 渲染最近日志（倒序，最新在上）
    var lb = badgeEl.querySelector('.jp-log-body');
    if (lb) {
      var html = '';
      for (var i = evLog.length - 1, n = 0; i >= 0 && n < 40; i--, n++) {
        var e = evLog[i];
        html += '<div class="jp-log-item"><b>' + e.t + '</b>' + esc(e.msg) + '</div>';
      }
      lb.innerHTML = html || '<div class="jp-log-item" style="color:#5f7499">暂无操作</div>';
    }
    positionBadge();
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---------- 屏幕常亮（Wake Lock API，Chrome 84+）----------
  var _wakeLock = null, _wakeTried = false;
  function keepAwake() {
    if (_wakeLock) return;
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      navigator.wakeLock.request('screen').then(function (wl) {
        _wakeLock = wl;
        if (!_wakeTried) { _wakeTried = true; logEvent('屏幕常亮已开启'); }
        wl.addEventListener('release', function () { _wakeLock = null; });
      }).catch(function () { /* 页面不可见时会失败，下次可见再试 */ });
    } catch (e) {}
  }
  function releaseAwake() {
    try { if (_wakeLock) { _wakeLock.release(); _wakeLock = null; } } catch (e) {}
  }

  // 本次稳定运行时长（距上次断档的连续时间）。每秒由快刷定时器驱动
  var _timePersistCnt = 0;
  function updateRunLine() {
    if (!badgeEl) return;
    var sessEl = badgeEl.querySelector('.jp-run-sess');
    if (!sessEl) return;

    var now = Date.now();
    if (state.started && state.enabled) {
      var delta = state.lastActiveAt ? (now - state.lastActiveAt) : 0;
      if (delta > IDLE_GAP) { state.sessionStart = now; }   // 断档太久 → 本次重新计时
      state.lastActiveAt = now;
      sessEl.textContent = fmtUptime(now - state.sessionStart);
      if (++_timePersistCnt >= 5) { _timePersistCnt = 0; persistTime(); }  // 每 5 秒落盘
    } else {
      // 未运行（未开始/暂停）：不计时，但推进 lastActiveAt 以免暂停期被算进本次
      state.lastActiveAt = now;
      sessEl.textContent = state.started ? '（已暂停）' : '—';
    }
  }

  // 进课程先确保：在「目录」tab + 「课程学习」已展开（直接设 Vue 状态，比点箭头稳）
  function ensureCatalog() {
    var vm = detailVm();
    if (!vm) return false;
    var acted = false;
    try {
      if (vm.selected === 'tab-summary') { vm.selected = 'tab-units'; acted = true; }
      var cu = vm.$refs && vm.$refs.courseUnits;
      if (cu && cu.isStudyListShow === false) { cu.isStudyListShow = true; acted = true; }
    } catch (e) {}
    if (acted) logEvent('切到目录并展开课程学习');
    return acted;
  }

  function tryPlay(v) {
    try { v.playbackRate = CFG.rate; } catch (e) {}
    if (CFG.muted) { try { v.muted = true; } catch (e) {} }   // 静音解锁无手势自动播放
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        // 播放被拦 → 优先走平台自己的"继续学习"逻辑（Vue 方法），再退化为点封面/按钮
        var d = detailVm();
        if (d && typeof d.handlePlayer === 'function') { try { d.handlePlayer('IN_PROGESS'); return; } catch (e) {} }
        var cover = $('.course-bg') || $('.prism-big-play-btn');
        if (cover) { clickEl(cover); return; }
        clickStudyBtn();
      });
      return false; // 播放请求未确认成功
    }
    return true;
  }

  // 封面上的"自动学习/继续学习/开始学习"（点了才开始播/才收起封面）
  function clickStudyBtn() {
    var now = Date.now();
    if (state._studyBtnAt && now - state._studyBtnAt < 15000) return false;  // 15s 冷却

    // 课程已完成 / 评估已完成 / 本会话已判定结业 → 绝不再点
    // （否则 handlePlayer 遇到 currentStep=评估 会跳到评估页，评估页又退回，形成死循环）
    if (doneCourses[state.courseTitle] || doneEval[state.courseTitle] || evalDone()) return false;
    // 只有"整门课已完成"角标才拦；不能用正文里某章节的"已完成"字样
    if (pageShowsFinished()) return false;

    // 首选：直接调用平台按钮的 Vue 处理器（不依赖文字匹配）
    var d = detailVm();
    if (d && typeof d.handlePlayer === 'function') {
      try { d.handlePlayer('IN_PROGESS'); state._studyBtnAt = now; logEvent('点击「继续学习」(Vue)'); return true; } catch (e) {}
    }
    // 退化：DOM 文字匹配
    var btn = [].slice.call(document.querySelectorAll('button,div,span,p,a,li'))
      .filter(function (e) {
        var r = e.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;   // fixed 元素 offsetParent 为 null，改用几何判定
        if (e.children.length > 1) return false;             // 只认叶子级，避免命中大容器
        var t = (e.textContent || '').replace(/\s/g, '');
        return t.length <= 8 && /(自动学习|继续学习|开始学习|继续播放|点击学习|开始播放|立即学习|去学习)/.test(t);
      })
      .sort(function (a, b) { return a.textContent.length - b.textContent.length; })[0];  // 取最具体的
    if (btn) {
      state._studyBtnAt = now;
      clickEl(btn);
      logEvent('点击「继续学习」(按钮)');
      return true;
    }
    return false;
  }

  function goBack() {
    var btn = $$('button.btn-menu').filter(function (b) { return /返\s*回/.test(b.textContent); })[0];
    if (btn) { clickEl(btn); logEvent('返回上一页'); return; }
    history.back();
  }

  // 列表页干净 URL：只到 #/course/my（不带 type 参数，避免平台 router 拼成 ?type=optional?type=h5_new 坏 URL）；自选课程 tab 由 myListTick 用 DOM 点
  function listHref() {
    return location.origin + '/courseCenter/?r=' + Date.now() + '#/course/my';
  }
  // 跳回课程列表（整页重载，路由干净初始化）
  function goList() {
    logEvent('返回课程列表');
    location.href = listHref();
  }
  // 带节流的跳转（6 秒内不重复，防列表加载失败时死循环）
  function safeGoList() {
    var now = Date.now();
    if (state._lastGoList && now - state._lastGoList < 6000) return false;
    state._lastGoList = now;
    location.href = listHref();
    return true;
  }

  // 毫秒 → 人类可读时长
  function fmtDur(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分';
    if (m > 0) return m + ' 分 ' + sec + ' 秒';
    return sec + ' 秒';
  }
  // 不间断运行时长：<60 分显示「X 分 X 秒」，≥60 分显示「X 小时 X 分 X 秒」
  function fmtUptime(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + ' 小时 ' + m + ' 分 ' + sec + ' 秒';
    return m + ' 分 ' + sec + ' 秒';
  }

  // 全部完成通知：系统通知 + 页面大弹窗 + 震动 + 提示音，多层兜底
  function notifyAllDone(count) {
    var saved = state.sessionStart ? fmtDur(Date.now() - state.sessionStart) : (count + ' 门课程');
    var msg = '本次共拯救 ' + saved;
    var title = '大哥，都学完啦';
    logEvent('🎉 ' + title + ' · ' + msg);
    // 1) 系统通知
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(title, { body: msg });
      } else if (window.Notification && Notification.permission !== 'denied') {
        Notification.requestPermission();
      }
    } catch (e) {}
    // 2) 震动
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]); } catch (e) {}
    // 3) 提示音
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      [660, 880, 990].forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        g.gain.setValueAtTime(0.001, ac.currentTime);
        o.start(ac.currentTime + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + i * 0.18 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + i * 0.18 + 0.16);
        o.stop(ac.currentTime + i * 0.18 + 0.18);
      });
    } catch (e) {}
    // 4) 页面大弹窗（最稳，一定看得见）
    if (document.getElementById('jp-done-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'jp-done-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999999;background:rgba(6,10,24,.92);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;' +
      'font-family:-apple-system,"PingFang SC",sans-serif;text-align:center;padding:24px;';
    ov.innerHTML = '<div style="font-size:64px;margin-bottom:10px">🎉</div>' +
      '<div style="font-size:24px;font-weight:800;margin-bottom:8px">' + esc(title) + '</div>' +
      '<div style="font-size:15px;color:#9fb4d8;margin-bottom:22px">' + esc(msg) + '</div>' +
      '<div style="font-size:13px;color:#7cc4ff;border:1px solid rgba(124,196,255,.5);border-radius:12px;padding:8px 20px">点任意处关闭</div>';
    ov.addEventListener('click', function () { ov.remove(); });
    (document.body || document.documentElement).appendChild(ov);
  }

  function dismissPopups() {
    var pb = $('.mint-popup .popupBtn');
    if (pb && pb.offsetParent) { clickEl(pb); return; }
    // 纯"知道啦"确认弹窗（无星级）→ 关闭；有星级的留给 starEvalTick
    var bf = $('.mint-popup .btn-finish');
    if (bf && bf.offsetParent && !$('.mint-popup .star-list')) { clickEl(bf); return; }

    // 平台自绘的"登录已超时…是否确定继续浏览？"类弹窗 → 自动点确定/继续
    var txt = (document.body && document.body.textContent) || '';
    if (/登录已超时|在其他设备登录|是否确定继续浏览/.test(txt)) {
      var btns = [].slice.call(document.querySelectorAll('button, .mint-msgbox-confirm, [class*=confirm], [class*=btn]'));
      var ok = btns.filter(function (b) {
        var t = (b.textContent || '').replace(/\s/g, '');
        return b.offsetParent && (t === '确定' || t === '继续' || t === '继续浏览' || t === '确定继续');
      })[0];
      if (ok) { clickEl(ok); logEvent('自动确认"登录超时"弹窗'); return; }
    }
  }

  // 登录页：只自动填企业 ID（全站固定值，可分享），账号密码留给用户输自己的工号
  function isLoginPage() { return !!document.getElementById('corpCode'); }
  function setNativeValue(el, val) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fillInput(id, val) {
    var el = document.getElementById(id);
    if (!el || el.value || !val) return false;
    setNativeValue(el, val);
    return true;
  }

  // 自动登录：填企业ID + 工号(账号) + 工号(密码)。
  // 有验证码 → 只填不提交，等用户输验证码自己点登录；无验证码 → 提交一次（防刷屏触发风控）
  function doAutoLogin() {
    var emp = state.empId;
    if (!emp) return false;

    // 兼容多种登录页形态：完整表单 / 只记密码的简化页 / 微信授权页
    fillInput('corpCode', CFG.corp);
    fillInput('userName', emp);
    fillInput('password', emp);
    fillInput('userPwd', emp);          // 部分版本密码框 id 不同
    // 简化页：只有密码框（账号已记住）→ 也要填
    var pwdInputs = [].slice.call(document.querySelectorAll('input[type=password]')).filter(function (el) {
      return el.offsetParent !== null && !el.value && el.id !== 'newPwd';
    });
    pwdInputs.forEach(function (el) { try { setNativeValue(el, emp); } catch (e) {} });

    // 检测验证码框（存在且可见）→ 不自动提交，交给用户
    var vc = document.getElementById('validateCode');
    if (vc && vc.offsetParent !== null) {
      if (!state._captchaHinted) {
        state._captchaHinted = true;
        logEvent('需要验证码：已填账号密码，请输验证码后点登录');
      }
      return 'captcha';
    }

    // 提交：带 20 秒间隔重试（防风控，又不至于一次失败就永远卡住）
    var now = Date.now();
    if (state._loginTried && now - (state._loginAt || 0) < 20000) return true;
    var btn = document.getElementById('wxLoginBtn') ||
      [].slice.call(document.querySelectorAll('button, .mint-button, [class*=btn]')).filter(function (b) {
        return b.offsetParent && /登\s*录|登\s*入/.test(b.textContent || '');
      })[0];
    if (btn) {
      state._loginTried = true; state._loginAt = now;
      clickEl(btn);
      logEvent('自动登录中…');
      return true;
    }
    // 没找到登录按钮 → 可能是微信授权页，无法自动处理
    state._noLoginBtn = (state._noLoginBtn || 0) + 1;
    if (state._noLoginBtn === 4) logEvent('未找到登录按钮，可能需要手动操作');
    return false;
  }

  // 首次使用：必须输入工号才能用；输入后自动登录，工号存本机（不写进脚本，可分享）
  function askEmpId() {
    if (document.getElementById('jp-emp-dialog')) return;
    var ov = document.createElement('div');
    ov.id = 'jp-emp-dialog';
    ov.style.cssText = 'position:fixed;inset:0;z-index:9999998;background:rgba(6,10,24,.94);display:flex;align-items:center;justify-content:center;font-family:-apple-system,"PingFang SC",sans-serif;padding:20px;';
    ov.innerHTML = '<div style="width:min(88vw,340px);background:linear-gradient(135deg,#141c34,#0a0f1a);border:1px solid rgba(124,196,255,.4);border-radius:16px;padding:22px;color:#eaf2ff;box-shadow:0 0 24px rgba(70,130,255,.35);">' +
      '<div style="font-size:18px;font-weight:800;margin-bottom:8px">输入工号，自动登录</div>' +
      '<div style="font-size:12.5px;color:#9fb4d8;margin-bottom:14px;line-height:1.6">输入一次你的工号，脚本会自动填好企业 ID 和账号密码并登录，之后每次都会自动登录。工号只存这台手机。</div>' +
      '<input id="jp-emp-input" type="text" inputmode="numeric" placeholder="请输入工号" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid rgba(124,196,255,.4);background:rgba(255,255,255,.06);color:#fff;font-size:16px;outline:none;">' +
      '<button id="jp-emp-ok" style="width:100%;margin-top:16px;padding:12px;border:none;border-radius:10px;background:#4f8dff;color:#fff;font-size:15px;font-weight:700;cursor:pointer">自动登录</button>' +
      '<div id="jp-emp-tip" style="font-size:11px;color:#ff9b9b;margin-top:8px;text-align:center;display:none">请先输入工号</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(ov);
    var inp = document.getElementById('jp-emp-input');
    if (inp) inp.focus();
    document.getElementById('jp-emp-ok').addEventListener('click', function () {
      var v = (inp.value || '').trim();
      if (!v) { var tip = document.getElementById('jp-emp-tip'); if (tip) tip.style.display = 'block'; inp.focus(); return; }
      state.empId = v;
      try { localStorage.setItem('jppt_emp', v); } catch (e) {}
      ov.remove();
      logEvent('已保存工号，自动登录');
      doAutoLogin();
    });
  }

  // 切换账号：清掉本机工号 + 进度/日志/计时 → 退出登录回登录页 → 重新输入新工号
  function switchAccount() {
    try {
      localStorage.removeItem('jppt_emp');
      localStorage.removeItem('jppt_state');
      localStorage.removeItem('jppt_time');
    } catch (e) {}
    logEvent('切换账号，退出登录');
    // 走平台退出登录页；清 cookie 后需重新登录
    location.href = location.origin + '/wx/loginOut.do?functionName=checkLogin';
  }

  // 倍速目标：接近平台打点帧（minStudyTime / duration-3）时降回 1 倍速，
  // 让 currentTime 精确路过检查点（平台的打勾是精确帧匹配，2 倍速会跨帧漏报）
  function rateTarget(v) {
    if (!v || !v.duration) return CFG.rate;
    var ms = state.curMsSec || 0;
    var t = v.currentTime;
    var nearMin = ms && t >= ms - CFG.checkpointZone && t <= ms + 2;
    var nearEnd = t >= v.duration - 5;
    return (nearMin || nearEnd) ? 1 : CFG.rate;
  }

  // ---------- 课程详情页内部逻辑 ----------
  function allItems() { return $$('.units div.list'); }
  function isDone(el) { return !!el.querySelector('.status-finish'); }
  function firstTodo() {
    var l = allItems();
    for (var i = 0; i < l.length; i++) if (!isDone(l[i])) return l[i];
    return null;
  }
  function playingEl() { return $('.units div.list.is-playing'); }

  // 学习完成判定：章节 ✓ 是平台确认（用户明确"显示勾选就是平台确认了"），有章节就以此为准
  function studyDone() {
    if (doneStudy[state.courseTitle]) return true;   // 文档课读满学时等已标记
    var l = allItems();
    if (l.length) return l.every(function (e) { return isDone(e); });
    // 单视频/无章节列表课程：看平台状态
    var d = detailVm();
    if (d && d.courseDetail) {
      var st = d.courseDetail.courseStatus;
      if (st === 'FINISHED' || st === 'COMPLETED') return true;
      if (st === 'STUDYING' || st === 'NOT_STARTED' || st === 'UNFINISHED') return false;
    }
    if (d) {
      try {
        var steps = (d.courseStepAndItems && d.courseStepAndItems.step) || [];
        for (var i = 0; i < steps.length; i++) {
          if (steps[i].appType === 'COURSE_COURSE_STUDY') return steps[i].finishStatus === 'COMPLETE';
        }
      } catch (e) {}
    }
    var l = allItems();
    return l.length > 0 && l.every(function (e) { return isDone(e); });
  }

  // 评估是否已完成（Vue 权威字段）
  function evalDone() {
    var d = detailVm();
    if (!d) return false;
    try {
      var cd = d.courseDetail || {};
      if (cd.finishStatus) return true;
      if (cd.getScore != null) return true;
      if (cd.courseStatus === 'COMPLETED') return true;
      var steps = (d.courseStepAndItems && d.courseStepAndItems.step) || [];
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].appType === 'COURSE_EVALUATE') return steps[i].finishStatus === 'COMPLETE';
      }
    } catch (e) {}
    return false;
  }

  function detailVm() {
    var el = $('.units');
    if (!el) return null;
    var p = el;
    for (var i = 0; i < 8 && p; i++) {
      if (p.__vue__) {
        var d = p.__vue__._data || {};
        // 放宽：不同课程类型组件名不同，认数据特征
        if (p.__vue__.$options.name === 'detail-course' || d.courseStepAndItems || d.unitList) return p.__vue__;
      }
      p = p.parentElement;
    }
    return null;
  }

  // 课程是否结业：「课程学习」✔ + 评估 COMPLETE
  function courseFinished(vm) {
    if (!studyDone()) return false;
    var d = vm || detailVm();
    if (!d) return false;
    try {
      var steps = (d.courseStepAndItems && d.courseStepAndItems.step) || [];
      var hasEval = false;
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].appType === 'COURSE_EVALUATE') {
          hasEval = true;
          if (steps[i].finishStatus !== 'COMPLETE') return false;
        }
      }
      if (!hasEval) return true;   // 无评估步骤：学习完成即结业
      return evalDone();
    } catch (e) {}
    return false;
  }

  // 剩余学时（毫秒，真实时长）：未完成章节 minStudyTime 之和
  function remainMs(vm) {
    var total = 0;
    try {
      var ul = vm.unitList || [];
      var doneMap = {};
      allItems().forEach(function (el) { if (isDone(el)) doneMap[el.id] = 1; });
      var curEl = playingEl();
      var curId = curEl ? curEl.id : '';
      var v = $('video');
      var watched = (v && curId) ? v.currentTime * 1000 : 0;  // 当前节已看毫秒
      ul.forEach(function (u) {
        if (!doneMap[u.scoId] && u.minStudyTime) {
          var ms = u.minStudyTime;
          if (u.scoId === curId && watched) ms = Math.max(0, ms - watched);
          total += ms;
        }
      });
    } catch (e) {}
    return total;
  }

  // scheduleCheck 已废弃：改为纯反应式（每轮直接看 ✓，认系统判定不等定时）

  // ---------- 我的课程列表页 ----------
  // 列表检查阶段（持久化，整页刷新后能接上）：
  // 0=查未学习 1=未学习已刷新 2=查进行中 3=进行中已刷新 4=全部完成待命
  function getStage() { try { return parseInt(localStorage.getItem('jppt_stage') || '0', 10) || 0; } catch (e) { return 0; } }
  function setStage(v) { try { localStorage.setItem('jppt_stage', String(v)); } catch (e) {} }
  function refreshList() {
    // 整页重载 = 等价"下滑刷新"，拿到平台最新列表数据
    location.href = location.origin + '/courseCenter/?r=' + Date.now() + '#/course/my';
  }

  function myListTick() {
    state.docOpenedAt = 0; state.checkAt = 0;
    var stage = getStage();

    // 全部完成待命：60 秒后再从「未学习」复查有无新课
    if (stage === 4) {
      var at = 0;
      try { at = parseInt(localStorage.getItem('jppt_stageAt') || '0', 10) || 0; } catch (e) {}
      if (!at) { at = Date.now(); try { localStorage.setItem('jppt_stageAt', String(at)); } catch (e) {} }
      if (Date.now() - at < 60000) { badge('待学课程全部完成 🎉（待命复查中）'); return; }
      try { localStorage.setItem('jppt_stageAt', '0'); } catch (e) {}
      setStage(0); stage = 0;
    }

    // 1) 确保在「自选课程」tab（默认停在安排课程）
    var hasFilter = $$('li, .mint-tab-item, [class*=tab]').some(function (t) {
      var s = (t.textContent || '').trim();
      return s === '未学习' || s === '进行中';
    });
    if (!hasFilter) {
      var optTab = $$('li, .mint-tab-item, [class*=tab], div, span').filter(function (t) {
        return t.children.length === 0 && (t.textContent || '').trim() === '自选课程';
      })[0];
      if (optTab) { clickEl(optTab); badge('切到「自选课程」…'); logEvent('切换到「自选课程」'); return; }
    }

    // 2) 按阶段确定目标筛选：未学习(0,1) / 进行中(2,3)
    var wantFilter = (stage >= 2) ? '进行中' : '未学习';
    var tabs = $$('li, .mint-tab-item, [class*=tab]');
    var activeEl = tabs.filter(function (t) {
      var s = (t.textContent || '').trim();
      return (s === '未学习' || s === '进行中') && /active|selected/i.test(String(t.className));
    })[0];
    var curName = activeEl ? (activeEl.textContent || '').trim() : '';
    if (curName !== wantFilter) {
      var wantTab = tabs.filter(function (t) { return (t.textContent || '').trim() === wantFilter; })[0];
      if (wantTab) { clickEl(wantTab); badge('筛选「' + wantFilter + '」…'); logEvent('切换到「' + wantFilter + '」'); return; }
    }

    var cells = $$('.data-cell').filter(function (c) {
      return /当前进度/.test(c.textContent) && c.querySelector('img');
    });
    // 区分「空态」和「还在加载」：平台空态会显示"暂无课程"
    var isEmpty = /暂无课程|暂无数据|没有课程|暂无内容/.test((document.body && document.body.textContent) || '');
    if (!cells.length && !isEmpty) {
      // 真在加载：5 秒还出不来就强制刷新
      if (!state._emptyAt) state._emptyAt = Date.now();
      if (Date.now() - state._emptyAt > CFG.listEmptySec * 1000) {
        state._emptyAt = 0;
        logEvent('列表 ' + CFG.listEmptySec + ' 秒未加载出来，强制刷新');
        refreshList();
        return;
      }
      badge(wantFilter + '加载中…');
      return;
    }
    state._emptyAt = 0;

    // 3) 找第一门可学课程（跳过已完成 / 结业条件=课后测试且学习已完成）
    var todo = null, todoTitle = '', finished = 0;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var tEl = c.querySelector('h3,h4,[class*=title]');
      var title = tEl ? tEl.textContent.replace(/\s+/g, ' ').trim() : '';
      if (!title) continue;
      var txt = c.textContent || '';
      var prog = (txt.match(/当前进度\s*[:：]\s*([^\s结]+)/) || [])[1] || '';
      if (doneCourses[title] || /已完成/.test(prog)) { doneCourses[title] = 1; finished++; continue; }
      if (/课后测试/.test(prog)) {
        if (!doneCourses[title]) logEvent('跳过课后测试课：' + title.slice(0, 14));
        doneCourses[title] = 1; finished++; continue;
      }
      todo = c; todoTitle = title; break;
    }

    if (todo) {
      var now = Date.now();
      if (todoTitle === state.lastClickId && now - state.lastClickAt < 25000) { badge('等待课程页打开…'); return; }
      state.lastClickId = todoTitle; state.lastClickAt = now;
      setStage(0);
      try { localStorage.setItem('jppt_doneNotified', '0'); } catch (e) {}
      state.lmSameCnt = 0; state.lmLastN = -1;
      logEvent('打开课程：' + todoTitle.slice(0, 16));
      clickEl(todo);
      badge('打开下一门：' + todoTitle.slice(0, 12));
      return;
    }

    // 4) 本页没有可学课程 → 先滚到底加载更多
    if (cells.length && loadMore(cells.length)) { badge('加载更多…(' + cells.length + ' 已扫)'); return; }
    if (/加载中|正在加载/i.test(document.body.textContent || '')) { badge('列表加载中…'); return; }

    // 5) 按阶段推进：刷新确认 → 转进行中 → 再刷新确认 → 真完成
    if (stage === 0) { setStage(1); logEvent('「未学习」已空，刷新确认'); badge('刷新确认「未学习」…'); refreshList(); return; }
    if (stage === 1) { setStage(2); logEvent('「未学习」刷新后仍空，转「进行中」'); badge('转「进行中」…'); return; }
    if (stage === 2) { setStage(3); logEvent('「进行中」已空，刷新确认'); badge('刷新确认「进行中」…'); refreshList(); return; }

    // stage 3：两边都刷新确认过，确实没了
    var notified = '0';
    try { notified = localStorage.getItem('jppt_doneNotified') || '0'; } catch (e) {}
    if (notified !== '1') {
      try { localStorage.setItem('jppt_doneNotified', '1'); } catch (e) {}
      notifyAllDone(finished);
      logEvent('未学习+进行中均确认清空，判定全部学完（共 ' + finished + ' 门）');
    }
    badge('待学课程全部完成 🎉（共 ' + finished + ' 门已结业）');
    setStage(4);
    try { localStorage.setItem('jppt_stageAt', String(Date.now())); } catch (e) {}
  }

  function loadMore(n) {
    if (n === state.lmLastN) state.lmSameCnt++; else { state.lmSameCnt = 0; state.lmLastN = n; }
    // 真正把列表容器滚到底（平台用 minirefresh 下拉刷新列表，滚动容器可能是多层）
    var sels = ['.minirefresh-scroll', '.minirefresh-wrap', '.mint-content', '#app .page', 'body'];
    sels.forEach(function (s) {
      var el = document.querySelector(s);
      if (el && el.scrollHeight > el.clientHeight) {
        try { el.scrollTop = el.scrollHeight; } catch (e) {}
      }
    });
    window.scrollTo(0, document.body.scrollHeight);
    // 触发一次上拉加载（部分实现监听 touchmove 到边界）
    var wrap = $('.minirefresh-wrap');
    if (wrap) {
      try {
        wrap.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
        wrap.dispatchEvent(new TouchEvent('touchmove', { bubbles: true }));
        wrap.dispatchEvent(new TouchEvent('touchend', { bubbles: true }));
      } catch (e) {}
    }
    // 数量连续 8 轮无增长才认为真到底（原 4 轮太急，加载慢会误判"全部学完"）
    return state.lmSameCnt < CFG.lmRounds;
  }

  // ---------- 评估页：自动满分（问答留空） ----------
  var evalTried = false;
  var POS = ['非常满意','十分满意','很满意','完全同意','非常同意','完全符合','非常符合','非常好','很好','特别好','帮助很大','收获很大','非常认可','完全能','5分','满分'];
  var MID = ['满意','同意','符合','认可','有帮助','基本'];
  function scoreText(t) {
    t = (t || '').replace(/\s/g, '');
    for (var i = 0; i < POS.length; i++) if (t.indexOf(POS[i]) >= 0) return 100 - i;
    for (var j = 0; j < MID.length; j++) if (t.indexOf(MID[j]) >= 0) return 60 - j;
    return 0;
  }
  function evalVm() {
    var el = $('.pretest-list');
    if (!el) return null;
    var p = el;
    for (var i = 0; i < 8 && p; i++) {
      if (p.__vue__ && p.__vue__.$options.name === 'course-evaluate') return p.__vue__;
      p = p.parentElement;
    }
    return null;
  }
  function evalTick() {
    var vm = evalVm();
    if (!vm || !vm.questionList || !vm.questionList.length) { badge('评估加载中…'); return; }

    // 已提交过评估 → 不再重复提交，直接回列表并排除这门课（否则会和详情页来回跳）
    if (vm.hasAnswers) {
      doneEval[state.courseTitle] = 1;
      doneCourses[state.courseTitle] = 1;
      persist();
      logEvent('评估已完成过，跳过并排除该课');
      badge('评估已完成过，回列表下一门');
      goList();
      return;
    }

    // 星级满 5
    try { if (vm.score !== 5) vm.goStar(4); } catch (e) {}

    var qaRequired = false;
    vm.questionList.forEach(function (q) {
      var items = q.questionItems || [];
      if (q.itemType === 'MULTIPLE') {
        // 多选题：按用户要求留空不选
        return;
      } else if (q.itemType === 'SINGLE' || q.itemType === 'TRUE_FALSE') {
        if (vm.selected[q.questionId] == null) {
          // 单选：优先选 E（E=5分满分）；无 E 退 D；再没有取最后一项
          var pick = null;
          items.forEach(function (it) { if (String(it.identifier).toUpperCase() === 'E') pick = it; });
          if (!pick) items.forEach(function (it) { if (String(it.identifier).toUpperCase() === 'D') pick = it; });
          if (!pick) pick = items[items.length - 1];
          // 注意：平台签名是 handleSelect(题目, 选项)
          try { vm.handleSelect(q, pick); } catch (e) {}
        }
      } else {
        // 问答类：按约定留空；必填则无法提交
        var has = (vm.answersList || []).some(function (a) {
          return a.questionId === q.questionId && a.answer && String(a.answer).trim();
        });
        if (!has && q.required === 1) qaRequired = true;
      }
    });

    if (qaRequired) {
      logEvent('评估：问答题必填，留空提交不了');
      badge('问答题平台必填，留空提交不了——请手写一句，我下轮自动提交'); return;
    }

    if (!evalTried) {
      evalTried = true;
      logEvent('提交课程评估（星5/单选E/多选空）');
      try { vm.handleSubmitAnswer(); } catch (e) {}
      setTimeout(function () {
        var btn = $('.mint-msgbox-confirm');
        if (btn && btn.offsetParent) { btn.click(); doneEval[state.courseTitle] = 1; }
      }, 900);
      badge('评估已作答（星5/单选D/多选空），提交中…');
    } else {
      badge('评估提交中…（若弹"未完成"请检查必答题）');
      var mb = $('.mint-msgbox-confirm');
      if (mb && mb.offsetParent) { mb.click(); doneEval[state.courseTitle] = 1; }
    }
  }

  // ---------- 星级评估弹窗（简版评估：弹窗内 5 星 + 知道啦/提交）----------
  var starClicked = false;
  function starEvalTick() {
    var sl = $('.mint-popup .star-list');
    if (!sl || !sl.offsetParent) { starClicked = false; return false; }
    var stars = sl.querySelectorAll('li');
    if (!stars.length) return false;
    if (!starClicked) {
      clickEl(stars[stars.length - 1]);   // 点第 5 星
      starClicked = true;
      logEvent('星级评估：点满 5 星');
      badge('评估：已点 5 星，等待提交');
      return true;
    }
    // 第二轮：点确认/提交
    var conf = $('.btn-finish') || $('.mint-popup .popupBtn');
    if (!conf) {
      conf = [].slice.call(document.querySelectorAll('button, .popupBtn, [class*=btn]')).filter(function (b) {
        return /知道啦|提交|确定|确认/.test(b.textContent) && b.offsetParent;
      })[0];
    }
    if (conf && conf.offsetParent) {
      clickEl(conf);
      doneEval[state.courseTitle] = 1;
      logEvent('星级评估已提交');
      badge('评估已提交（5星），返回列表');
      setTimeout(function () { try { history.back(); } catch (e) {} }, 1500);
    }
    return true;
  }

  // ---------- 主状态机 ----------
  function tick() {
    try { run(); } catch (e) { badge('脚本异常: ' + e.message); }
  }

  // 浮窗定位：登录页挪到右上角避开表单；其它页回左下角（用户手动拖过后不再自动挪）
  function positionBadge() {
    if (!badgeEl || state._dragged) return;
    if (isLoginPage()) {
      badgeEl.style.left = 'auto'; badgeEl.style.right = '8px';
      badgeEl.style.top = '8px'; badgeEl.style.bottom = 'auto';
    } else {
      badgeEl.style.left = '10px'; badgeEl.style.right = 'auto';
      badgeEl.style.bottom = '96px'; badgeEl.style.top = 'auto';
    }
  }

  function run() {
    dismissPopups();

    // 坏 URL 自愈：平台 router 可能把 ?type=optional 拼成 ?type=optional?type=h5_new 导致卡死，检测到就刷回干净列表
    if (/\?[^#]*\?/.test(location.hash)) {
      if (safeGoList()) { badge('修复坏链接…'); return; }
    }

    // ============ 登录页：全自动登录（企业ID+工号+工号，首次问一次工号）============
    if (isLoginPage()) {
      // 登录页：浮窗缩成小圆钮，绝不遮挡输入框
      state.mini = true;
      if (state.empId) {
        var lr = doAutoLogin();
        badge(lr === 'captcha' ? '已填账号密码，请输验证码点登录' : '自动登录中…');
      } else if (!document.getElementById('jp-emp-dialog')) {
        askEmpId();   // 首次：弹框问工号
        badge('首次使用：请输入工号');
      }
      state._wasLogin = true;
      return;
    }

    if (/loginOut/.test(location.href)) {
      // 已在登录页但 isLoginPage 没识别到（页面未渲染完）：稍后再试
      badge('登录已失效，正在重新登录…');
      return;
    }
    if (!/jppt\.hfgdjt\.com/.test(location.href)) {
      badge('登录已失效，请重新登录'); return;
    }
    if (state._wasLogin) { state._wasLogin = false; state.mini = false; logEvent('✓ 登录成功'); }

    var onEval = !!($('.pretest-list') && evalVm());
    var inCourse = onEval || inMyList() || inOnlineDoc() || inPlayer() || inDetail();

    // ============ 闸门：未点「开始拯救时间」 ============
    if (!state.started) {
      if (!inCourse && safeGoList()) { badge('自动前往课程列表…'); return; }
      badge('是否开始拯救时间？点下方按钮'); return;
    }
    if (!state.enabled) {
      // 暂停中：不自动动作，但维持已加载视频的倍速/静音无意义，直接显示
      badge('已暂停（点按钮继续）'); return;
    }

    // ============ 强制守卫：平台显示「已完成」就直接排除该课 ============
    // 防止"详情页以为没完成 → 点继续学习 → 评估页说已完成 → 退回 → 再点"的死循环
    if ((inDetail() || inOnlineDoc() || inPlayer()) && pageShowsFinished()) {
      if (!doneCourses[state.courseTitle]) {
        doneCourses[state.courseTitle] = 1;
        persist();
        logEvent('平台显示「已完成」，排除该课：' + (state.courseTitle || '').slice(0, 14));
      }
      badge('✓ 该课已完成，返回列表下一门');
      goList();
      return;
    }

    // 全局倍速/静音兜底：接近平台打点帧自动降 1 倍速，其余时间保持 2 倍速
    var anyV = $('video');
    if (anyV) {
      var want = rateTarget(anyV);
      if (anyV.playbackRate !== want) { try { anyV.playbackRate = want; } catch (e) {} }
      if (CFG.muted && !anyV.muted) { try { anyV.muted = true; } catch (e) {} }
    }

    // ============ 已开始：不在任何课程页（首页/课程中心等）→ 跳回列表 ============
    if (!inCourse) { if (safeGoList()) { badge('返回课程列表…'); return; } }

    // ============ 评估页 ============
    if ($('.pretest-list') && evalVm()) { state.curMsSec = 0; evalTick(); return; }
    if (!$('.pretest-list')) evalTried = false;

    // ============ 我的课程列表（队列入口）============
    if (inMyList()) { state.curMsSec = 0; state.checkAt = 0; myListTick(); return; }

    // ============ ONLINEDOC 文档/PDF 课（无视频，墙钟计时）============
    if (inOnlineDoc()) {
      // 有「继续学习」封面按钮先点它
      if (clickStudyBtn()) { badge('点击「继续学习」…'); return; }
      if (!state.docOpenedAt) logEvent('进入文档/PDF 课，开始计时');
      state.docOpenedAt = state.docOpenedAt || Date.now();
      var dv = docVm();
      var needMin = dv && dv.courseInfo ? (dv.courseInfo.minStudyTime || 0) : 0;   // 平台要求：分钟
      var studied = dv && dv.studiedTime !== undefined ? dv.studiedTime : null;      // 已累计分钟
      var fin = dv && (dv.finishStatus === 'true' || dv.finishStatus === true);

      // 平台已判完成 → 若还有评估就回课程页走评估；否则直接排除该课回列表
      if (fin) {
        var evH3doc = $$('.units h3').filter(function (h) { return /评估/.test(h.textContent); })[0];
        if (evH3doc && !evalDone() && !doneEval[state.courseTitle]) {
          logEvent('文档学时已满 ✓，回去做评估');
          badge('✓ 文档学时已满，进入评估');
          goBack();
        } else {
          doneCourses[state.courseTitle] = 1; persist();
          logEvent('文档课完成，排除该课');
          badge('✓ 文档课完成，下一门');
          goList();
        }
        return;
      }
      // 读得到 studiedTime：等它 >= minStudyTime
      if (studied !== null && needMin) {
        if (studied >= needMin) {
          // 学时已满 → 标记该课"学习完成"，回课程页（详情页据此去评估或结业，不会再来回进阅读页）
          badge('✓ 文档学时已满 ' + studied + '/' + needMin + '，回课程页');
          if (!doneStudy[state.courseTitle]) {
            doneStudy[state.courseTitle] = 1;
            persist();
            logEvent('文档学时已满 ' + studied + '/' + needMin + ' 分钟');
          }
          state.docHold = 0;
          goBack();
          return;
        }
        badge('文档阅读中 ' + studied + '/' + needMin + ' 分钟');
        return;
      }
      // 读不到 Vue：纯墙钟兜底（URL 无 minStudyTime，用默认 15 分钟/页估算）
      var el0 = Date.now() - state.docOpenedAt;
      if (el0 >= 15 * 60000) {
        if (!doneStudy[state.courseTitle]) {
          doneStudy[state.courseTitle] = 1; persist();
          logEvent('文档墙钟已满 15 分钟');
        }
        badge('✓ 文档墙钟已满，回课程页');
        goBack();
        return;
      }
      badge('文档阅读中（墙钟 ' + fmt(el0 / 1000) + '，未能读取平台计时）');
      return;
    }

    // ============ 独立播放页 ============
    if (inPlayer()) {
      state.docOpenedAt = 0; state.docHold = 0;
      var ms = minMsFromUrl();
      state.curMsSec = ms ? ms / 1000 : 0;
      var v = $('video');
      if (v) {
        state.docOpenedAt = 0;
        if (v.paused && !v.ended) { tryPlay(v); badge('自动播放中…'); return; }
        var hitMin = ms ? (v.currentTime >= ms / 1000 - CFG.graceSec) : v.ended;
        if (hitMin || v.ended) {
          badge('本节学时已满，返回'); state.holdCnt = CFG.hold; goBack(); return;
        }
        badge('播放中 ' + fmt(v.currentTime) + ' / ' + fmt(ms ? ms / 1000 : v.duration || 0));
        return;
      }
      if (!state.docOpenedAt) { state.docOpenedAt = Date.now(); state.docMinMs = ms; }
      var el2 = Date.now() - state.docOpenedAt;
      if (state.docMinMs && el2 >= state.docMinMs + CFG.docExtraSec * 1000) {
        badge('课件计时已满，返回'); state.holdCnt = CFG.hold; goBack(); return;
      }
      badge(state.docMinMs ? ('课件 ' + Math.floor(el2 / 1000) + 's / ' + Math.floor(state.docMinMs / 1000) + 's')
                           : '课件页面（无定时参数，请手动确认）');
      return;
    }

    // ============ 课程详情页（主战场）============
    if (inDetail()) {
      state.docOpenedAt = 0; state.docMinMs = 0;
      var vm = detailVm();
      var iv = $('video');
      var cur = playingEl();
      var items = allItems();
      var doneN = items.filter(function (e) { return isDone(e); }).length;
      if (document.title && !/轨道云课堂|课程中心|登录/.test(document.title)) {
        state.courseTitle = document.title;
      }

      // 星级评估弹窗（简版评估）：出现就处理，优先于其它逻辑
      if (starEvalTick()) return;

      // 封面「继续学习/自动学习」按钮：只要可见就点（按钮消失即不再触发，自带 15s 冷却）
      if (clickStudyBtn()) { badge('点击「继续学习」…'); return; }

      // 进课程先确保在「目录」tab 且「课程学习」已展开
      if (ensureCatalog()) { badge('切换目录 / 展开课程学习…'); return; }

      // 浮窗状态：优先显示真实播放进度（UI 定时器每秒也会刷新）
      progFn = function () {
        if (iv && !items.length) {
          return '▶ 单视频 ' + (iv.paused ? '⏸ ' : '') + fmt(iv.currentTime) + '/' + fmt(iv.duration || 0);
        }
        if (!items.length) return '课程加载中…';
        var p = iv && iv.duration ? (fmt(iv.currentTime) + '/' + fmt(iv.duration) + (iv.paused ? '（暂停）' : '')) : '';
        return (p ? '▶ ' + p : '▶ 学习中') + ' · 章节 ' + doneN + '/' + items.length;
      };

      // ========== 学习已完成优先：直接评估 / 跳过课后测试 / 返回 ==========
      if (studyDone()) {
        if (evalDone() || doneEval[state.courseTitle]) {
          badge('✓ 学习与评估均完成，返回列表');
          doneCourses[state.courseTitle] = 1; state.checkAt = 0;
          goList();
          return;
        }
        // 课后测试类：学习已完成即可，测试不答、直接排除出队列
        var examH3pre = $$('.units h3').filter(function (h) { return /测验|考试|测试/.test(h.textContent); })[0];
        if (examH3pre) {
          doneCourses[state.courseTitle] = 1; state.checkAt = 0;
          logEvent('学习完成，课后测试跳过（结业条件=课后测试）');
          badge('学习完成 ✓ 课后测试跳过，下一门');
          goList();
          return;
        }
        var evH3pre = $$('.units h3').filter(function (h) { return /评估/.test(h.textContent); })[0];
        if (evH3pre) {
          badge('课程学习已完成 ✓，进入评估');
          switchTodo(evH3pre); return;
        }
        // 无评估、无测试（结业条件=课程学习）→ 直接结业
        logEvent('学习完成，无评估/测试步骤，直接结业');
        badge('✓ 本课程结业，返回列表');
        doneCourses[state.courseTitle] = 1; state.checkAt = 0;
        goList();
        return;
      }

      // ========== 单视频课程（无章节列表，video 即全部学习内容）==========
      if (!items.length) {
        if (!iv) {
          // 既无章节也无视频（可能是未展开/结构不同）：给 20 秒机会，仍无内容就跳过，避免死等
          if (!state._noContentAt) state._noContentAt = Date.now();
          if (Date.now() - state._noContentAt > 20000) {
            state._noContentAt = 0;
            doneCourses[state.courseTitle] = 1; persist();
            logEvent('20 秒未发现可学内容，跳过该课：' + (state.courseTitle || '').slice(0, 14));
            badge('未发现内容，跳过该课');
            goList();
            return;
          }
          badge('课程加载中…');
          return;
        }
        state._noContentAt = 0;
        state.courseTitle = document.title || state.courseTitle;

        // 视频停着就自动播
        if (iv.paused && !iv.ended) {
          var okp2 = tryPlay(iv);
          if (!okp2) clickStudyBtn();
          badge(progFn()); return;
        }

        // 视频播完/接近结束：到这里说明 studyDone() 仍为 false（上面的"学习已完成优先"块已处理完成态），
        // 即"进度条走完但平台未判完成"→ 重播补真实学时，绝不提前进评估
        if (iv.ended || (iv.duration && iv.currentTime >= iv.duration - 5)) {
          badge('视频播完但学时未满，重播补时长…');
          try { iv.currentTime = 0; } catch (e) {}
          if (!tryPlay(iv)) clickStudyBtn();
          return;
        }
        badge(progFn());
        return;
      }

      if (!items.length) { badge('课程加载中…'); return; }
      state.courseTitle = document.title || state.courseTitle;

      // 当前节的打点帧位置（供倍速降挡用）
      if (vm && vm.unitList && cur && cur.id) {
        for (var ui = 0; ui < vm.unitList.length; ui++) {
          if (vm.unitList[ui].scoId === cur.id) {
            state.curMsSec = (vm.unitList[ui].minStudyTime || 0) / 1000;
            break;
          }
        }
      }

      // 内嵌视频：停着就播；播完没打勾就重播（章节型课程）
      // 但若本节平台已打勾，则不在此纠缠播放状态，交给下面的"完成→切换"
      var curDone = cur && isDone(cur);
      if (!curDone && iv && iv.paused && !iv.ended) {
        if (!tryPlay(iv)) clickStudyBtn();
        badge(progFn()); return;
      }
      if (!curDone && iv && iv.ended && cur && !isDone(cur)) {
        tryPlay(iv); badge('本节学时未记满，自动重播…'); return;
      }

      // ---- 纯反应式：每轮直接看真实状态，不等定时 ----
      // （✓ 亮了立刻切，认系统判定；checkAt 仅作 badge 预估显示）
      if (courseFinished(vm)) {
        doneCourses[state.courseTitle] = 1;
        state.checkAt = 0;
        badge('✓ 本课程结业，返回列表取下一门');
        goList();
        return;
      }

      // 未结业：章节内继续推进
      var todo = firstTodo();
      if (!todo) { badge('章节已完成，等待平台更新…'); return; }

      if (cur && !isDone(cur)) {
        // 正在学：显示实时进度与预估剩余（纯信息，不阻塞）
        var remain = remainMs(vm) / CFG.rate;
        badge(progFn() + (remain > 30000 ? ' · 剩余≈' + Math.ceil(remain / 60000) + ' 分钟' : (remain > 1000 ? ' · 即将学完' : '')));
        return;
      }
      if (cur && isDone(cur)) {
        state.holdCnt++;
        if (state.holdCnt >= CFG.hold) {
          state.holdCnt = 0;
          badge('本节完成，切下一节');
          switchTodo(todo);
        } else {
          badge('本节完成，确认中(' + state.holdCnt + '/' + CFG.hold + ')');
        }
        return;
      }
      badge('自动开始学习');
      switchTodo(todo);
      return;
    }

    badge('待机（打开「我的课程→自选课程」后自动运行）');
  }

  function switchTodo(el, label) {
    var id = el.id || el.textContent.trim().slice(0, 24);
    var now = Date.now();
    if (id === state.lastClickId && now - state.lastClickAt < 20000) return;
    state.lastClickId = id; state.lastClickAt = now;
    logEvent(label || ('切换到：' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16)));
    clickEl(el);
  }

  setInterval(tick, CFG.pollMs);
  setTimeout(tick, 1500);

  // 视频播完即时触发检测（不等轮询）：给当前 video 元素挂 ended 监听，元素变了重挂
  var boundVideo = null;
  setInterval(function () {
    try {
      var v = $('video');
      if (v && v !== boundVideo) {
        boundVideo = v;
        v.addEventListener('ended', function () { setTimeout(tick, 120); });
        v.addEventListener('timeupdate', function () {
          // 接近打点帧/结尾时提前触发一次，避免卡在轮询间隙
          if (v.duration && v.currentTime >= v.duration - 6 && !v.__jpFired) {
            v.__jpFired = 1; setTimeout(tick, 120);
          }
        });
      }
    } catch (e) {}
  }, 800);

  // 浮窗快刷：每秒刷新进度文案 + 不间断运行时长（状态机仍是 1.5s，动作不受影响）
  var _lastVT = -1, _lastVAt = 0;
  var _lastStudied = -1, _lastStudiedAt = 0;
  setInterval(function () {
    try {
      updateRunLine();

      // 掉线检测：视频在播但进度长时间不动 → 判定 cookie 过期/被顶号 → 整页刷新（刷新后若掉登录会走自动登录）
      if (state.started && state.enabled && (inDetail() || inPlayer())) {
        var sv = $('video');
        if (sv && sv.duration && !sv.paused && !sv.ended) {
          if (sv.currentTime === _lastVT) {
            if (_lastVAt && Date.now() - _lastVAt > CFG.stallSec * 1000) {
              logEvent('进度停滞 ' + CFG.stallSec + 's，判定掉线，刷新重登');
              _lastVAt = Date.now();                 // 防刷新前重复触发
              location.reload();
              return;
            }
          } else {
            _lastVT = sv.currentTime; _lastVAt = Date.now();
          }
        }
      }

      // 掉线检测（PDF/文档课）：studiedTime 长时间不增长 → 刷新重登
      if (state.started && state.enabled && inOnlineDoc()) {
        var dv = docVm();
        var st = dv && dv.studiedTime !== undefined ? dv.studiedTime : null;
        if (st !== null) {
          if (st === _lastStudied) {
            if (_lastStudiedAt && Date.now() - _lastStudiedAt > CFG.docStallSec * 1000) {
              logEvent('文档计时停滞 ' + CFG.docStallSec + 's，判定掉线，刷新重登');
              _lastStudiedAt = Date.now();
              location.reload();
              return;
            }
          } else {
            _lastStudied = st; _lastStudiedAt = Date.now();
          }
        }
      }

      if (!state.enabled) return;
      if (inDetail() && progFn) {
        var iv = $('video');
        if (iv && !iv.paused && !iv.ended) {
          badge(progFn());
        }
      }
      // 运行中保持屏幕常亮（页面可见时才有效，切走会自动释放）
      if (state.started && state.enabled) keepAwake();
    } catch (e) {}
  }, 1000);

  // 切回前台时重新申请屏幕常亮（系统在页面隐藏时会自动释放唤醒锁）
  document.addEventListener('visibilitychange', function () {
    try { if (!document.hidden && state.started && state.enabled) keepAwake(); } catch (e) {}
  });
})();
