/**
 * 123panfx.com(123分享社区) 自动签到 v2.1 -- 详细数据版
 * Cookie 自动抓取，签到后展示经验/金币/等级/升级进度。
 */
const $ = new Env("123盘 [签到]");
const CK_KEY = "panfx_cookie", UA_KEY = "panfx_ua", BAL_KEY = "panfx_balance";
const SIGN_URL = "https://123panfx.com/my-sign.htm", INFO_URL = "https://123panfx.com/my-credits.htm";

(function main() {
  const cookie = ($.getdata(CK_KEY) || "").trim();
  if (!cookie) { $.msg("123盘", "❌ 未获取 Cookie", "请打开 123panfx.com 触发抓取"); return; }
  const ua = ($.getdata(UA_KEY) || "").trim() ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
  const H = { "User-Agent": ua, "Cookie": cookie, "Referer": "https://123panfx.com/", "X-Requested-With": "XMLHttpRequest" };
  var prev = safeParse($.getdata(BAL_KEY));

  $.post(SIGN_URL, H, "", function (ok, d) {
    var m = getMsg(d);
    var signed = /已签到|already/i.test(m);
    $.get(INFO_URL, { "User-Agent": ua, "Cookie": cookie, "Referer": "https://123panfx.com/" }, function (o2, html) {
      var info = parseInfo(html);
      var curE = info ? info.exp : null, curG = info ? info.gold : null;
      var gainE = null, gainG = null;
      if (prev) { if (curE != null && prev.e != null) gainE = curE - prev.e; if (curG != null && prev.g != null) gainG = curG - prev.g; }
      if (info && info.exp != null && info.gold != null) $.setdata(JSON.stringify({ e: info.exp, g: info.gold }), BAL_KEY);
      var L = [];
      L.push("状态: " + (signed ? "✅ 已签到" : "✅ 签到成功"));
      var parts = [];
      if (gainE && gainE !== 0) parts.push((gainE > 0 ? "+" : "") + gainE + "经验");
      if (gainG && gainG !== 0) parts.push((gainG > 0 ? "+" : "") + gainG + "金币");
      if (parts.length) L.push("本次获得: " + parts.join("、"));
      if (info) {
        L.push("经验: " + info.exp + (info.expMax ? " (距升级还差" + (info.expMax - info.exp) + ")" : ""));
        L.push("金币: " + info.gold);
        L.push("等级: Lv." + info.level + (info.rank ? "・" + info.rank : ""));
      }
      notify(L);
    });
  });
})();

function parseInfo(h) {
  if (!h) return null;
  var em = h.match(/经验[：:]\s*(\d+)\s*\/\s*(\d+)/);
  var gm = h.match(/wallet-value-2">\s*(\d+)/);
  var lm = h.match(/Lv\.(\d+)/);
  var rm = h.match(/user-level-card-groupname"[^>]*>([^<]+)/);
  return {
    exp: em ? parseInt(em[1]) : null,
    expMax: em ? parseInt(em[2]) : null,
    gold: gm ? parseInt(gm[1]) : null,
    level: lm ? parseInt(lm[1]) : null,
    rank: rm ? rm[1].trim() : null
  };
}
function notify(L) { $.msg("123盘", L.filter(Boolean).join("\n"), ""); $.done(); }
function getMsg(d) { try { var o = JSON.parse(d); return o.message || ""; } catch (e) { return String(d || ""); } }
function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function Env(name) {
  this.name = name;
  this.isSurge = function () { return typeof $httpClient !== "undefined"; };
  this.isQuanX = function () { return typeof $task !== "undefined"; };
  this.isLoon = function () { return typeof $loon !== "undefined"; };
  this.post = function (url, h, b, cb) { if (this.isSurge() || this.isLoon()) $httpClient.post({ url: url, headers: h, body: b || "" }, function (e, r, d) { cb(!e && (!r || r.status < 400), d); }); else if (this.isQuanX()) $task.fetch({ url: url, method: "POST", headers: h, body: b || "" }).then(function (r) { return r.text(); }).then(function (t) { cb(true, t); }).catch(function () { cb(false, ""); }); };
  this.get = function (url, h, cb) { if (this.isSurge() || this.isLoon()) $httpClient.get({ url: url, headers: h }, function (e, r, d) { cb(!e && (!r || r.status < 400), d); }); else if (this.isQuanX()) $task.fetch({ url: url, method: "GET", headers: h }).then(function (r) { return r.text(); }).then(function (t) { cb(true, t); }).catch(function (e) { cb(false, ""); }); };
  this.msg = function (t, s, b) { if (this.isSurge() || this.isLoon()) $notification.post(t, s, b); else if (this.isQuanX()) $notify(t, s, b); };
  this.getdata = function (k) { return (this.isSurge() || this.isLoon()) ? $persistentStore.read(k) : (this.isQuanX() ? $prefs.valueForKey(k) : null); };
  this.setdata = function (v, k) { return (this.isSurge() || this.isLoon()) ? $persistentStore.write(v, k) : (this.isQuanX() ? $prefs.setValueForKey(v, k) : false); };
  this.done = function () { if (typeof $done !== "undefined") $done(); };
}