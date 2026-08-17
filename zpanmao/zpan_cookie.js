/**
 * zpanmao.com · Token 抓取
 *
 * 用法：登录 zpanmao.com 后,用 Safari/浏览器打开站内任意页面，
 * 从请求头自动抓取 Authorization: Bearer <access_token> 保存。
 * 收到 "✅ Token 已保存" 即完成，之后每天自动签到。
 *
 * 模式：http-request
 * 兼容 Loon / Surge / QuantumultX / Shadowrocket
 */
const $ = new Env("追盘猫 [Token]");

const TK_KEY = "zpan_token";   // access_token
const UA_KEY  = "zpan_ua";     // User-Agent

(function main() {
  const h = $request.headers || {};
  const ua = (h["User-Agent"] || h["user-agent"] || "").trim();
  const auth = (h["Authorization"] || h["authorization"] || "").trim();
  // 需要 Bearer token
  const m = auth.match(/[Bb]earer\s+(.+)/);
  if (!m || !m[1]) { $.log("zpanmao: 无 Authorization"); $.done(); return; }
  const token = m[1].trim();

  if (ua) $.setdata(ua, UA_KEY);

  const old = $.getdata(TK_KEY) || "";
  if (old === token) { $.log("token 未变化"); $.done(); return; }

  $.setdata(token, TK_KEY);
  $.msg("追盘猫", "✅ 登录 Token 已保存", "自动签到已就绪");
  $.log("已保存 token，长度 " + token.length);
  $.done();
})();

// ======== 通用 Env（兼容 Surge/Loon/QuanX） ========
function Env(s) {
  this.name = s;
  this.isSurge = () => typeof $httpClient !== "undefined";
  this.isQuanX = () => typeof $task !== "undefined";
  this.isLoon = () => typeof $loon !== "undefined";
  this.log = (...a) => { try{console.log(a.join(" "));}catch(e){} };
  this.msg = (t = this.name, s = "", b = "") => {
    if (this.isSurge() || this.isLoon()) $notification.post(t, s, b);
    else if (this.isQuanX()) $notify(t, s, b);
    else { try{console.log("【"+t+"】"+s+" "+b);}catch(e){} }
  };
  this.getdata = (k) => (this.isSurge()||this.isLoon()) ? $persistentStore.read(k) : (this.isQuanX() ? $prefs.valueForKey(k) : null);
  this.setdata = (v,k) => (this.isSurge()||this.isLoon()) ? $persistentStore.write(v,k) : (this.isQuanX() ? $prefs.setValueForKey(v,k) : false);
  this.done = () => { if (typeof $done !== "undefined") $done(); };
}