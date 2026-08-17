/**
 * 123panfx · Cookie 抓取
 *
 * 用法：登录 123panfx.com 后,用 Safari/浏览器打开任意站内页面,
 * 自动抓取请求头的 bbs_sid / bbs_token 并保存。
 * 收到 "✅ Cookie 获取成功" 即完成,之后每天自动签到。
 *
 * 兼容 Loon / Surge / QuantumultX / Shadowrocket
 * 模式：http-request
 */

const $ = new Env("123PanFx [Cookie]");

const CK_KEY   = "panfx_cookie";   // 完整 Cookie
const UA_KEY   = "panfx_ua";       // User-Agent(跟随同步,防风控)

(function main() {
  const cookie = ($request.headers["Cookie"] || $request.headers["cookie"] || "").trim();
  if (!cookie) { $.done(); return; }
  // 只需含登录态关键字段才存
  if (!/bbs_sid=/.test(cookie)) { $.done(); return; }

  const ua = ($request.headers["User-Agent"] || $request.headers["user-agent"] || "").trim();
  const old = $.getdata(CK_KEY) || "";
  // 只监控关键 cookie 段的变化,避免 bbs_token 周期性换导致误报
  const sig = (cookie.match(/bbs_sid=[^;]+/) || [""])[0];

  if (ua) $.setdata(ua, UA_KEY);

  // 若 sid 未变,静默跳过(防每次刷页都弹通知)
  if (old.indexOf(sig) !== -1 && old.indexOf("bbs_token") !== -1) {
    $.done(); return;
  }

  $.setdata(cookie, CK_KEY);
  $.msg("123PanFx", "✅ 123盘 Cookie 已获取", "自动签到已就绪");
  $.done();
})();

// ======== 通用 Env 封装（兼容 Surge/Loon/QuanX） ========
function Env(s) {
  this.name = s;
  this.isSurge = () => typeof $httpClient !== "undefined";
  this.isQuanX = () => typeof $task !== "undefined";
  this.isLoon = () => typeof $loon !== "undefined";
  this.log = (...a) => console.log(a.join("\n"));
  this.msg = (t = this.name, s = "", b = "") => {
    if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
    else if (this.isQuanX()) $notify(t, s, b);
    console.log(["", "====📣" + t + "====", s, b].filter(Boolean).join("\n"));
  };
  this.getdata = (k) => {
    if (this.isSurge() || this.isLoon()) return $persistentStore.read(k);
    if (this.isQuanX()) return $prefs.valueForKey(k);
    return null;
  };
  this.setdata = (v, k) => {
    if (this.isSurge() || this.isLoon()) return $persistentStore.write(v, k);
    if (this.isQuanX()) return $prefs.setValueForKey(v, k);
    return false;
  };
  this.done = (v = {}) => { if (typeof $done !== "undefined") $done(v); };
}