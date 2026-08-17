/**
 * 123panfx · Cookie 抓取
 *
 * 用法：登录 123panfx.com 后,用 Safari/浏览器打开任意站内页面,
 * 自动从请求头抓取 bbs_sid / bbs_token 并保存。
 * 收到 "✅ Cookie 已保存" 即完成,之后每天自动签到。
 *
 * 兼容 Loon / Surge / QuantumultX / Shadowrocket
 * 模式：http-request
 */

const $ = new Env("123PanFx [Cookie]");

const CK_KEY = "panfx_cookie";   // 完整 Cookie
const UA_KEY = "panfx_ua";       // User-Agent(防风控)

(function main() {
  // 兼容不同工具取请求头
  const h = $request.headers || {};
  const cookie = (h["Cookie"] || h["cookie"] || "").trim();
  const ua = (h["User-Agent"] || h["user-agent"] || "").trim();

  // 调试日志：确认脚本已被调用
  $.log("触发抓取检测 | cookie长度=" + cookie.length + " | 含bbs_sid=" + /bbs_sid=/.test(cookie) + " | 含bbs_token=" + /bbs_token=/.test(cookie));

  if (!cookie || !/bbs_sid=/.test(cookie)) {
    // cookie 不在请求头(用户可能未登录/未走Loon) —— 只记日志，不打扰
    $.done(); return;
  }

  if (ua) $.setdata(ua, UA_KEY);

  const old = $.getdata(CK_KEY) || "";
  // 用 bbs_sid+token 变化来判断是否需要更新(避免 token 周期替换误报警)
  const newSig = (cookie.match(/bbs_sid=[^;]+/) || [""])[0] +
                 (cookie.match(/bbs_token=[^;]+/) || [""])[0];
  const oldSig = (old.match(/bbs_sid=[^;]+/) || [""])[0] +
                 (old.match(/bbs_token=[^;]+/) || [""])[0];

  // 已存且未变 => 静默，防止每次刷页都弹通知
  if (old && oldSig === newSig) {
    $.log("Cookie 未变化,跳过");
    $.done(); return;
  }

  $.setdata(cookie, CK_KEY);
  $.msg("123PanFx", "✅ 123盘 Cookie 已保存", "自动签到已就绪");
  $.log("已保存 Cookie");
  $.done();
})();

// ======== 通用 Env 封装（兼容 Surge/Loon/QuanX/Shadowrocket） ========
function Env(s) {
  this.name = s;
  this.isSurge = () => typeof $httpClient !== "undefined";
  this.isNode = () => typeof require !== "undefined" && typeof $httpClient === "undefined";
  this.isQuanX = () => typeof $task !== "undefined";
  this.isLoon = () => typeof $loon !== "undefined";
  this.log = (...a) => { try { console.log(a.join(" ")); } catch(e){} };
  this.msg = (t = this.name, s = "", b = "") => {
    if (this.isSurge() || this.isLoon()) { $notification.post(t, s, b); }
    else if (this.isQuanX()) { $notify(t, s, b); }
    else { try { console.log("【" + t + "】" + s + " " + b); } catch(e){} }
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
  this.done = () => { if (typeof $done !== "undefined") $done(); };
}