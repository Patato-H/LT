/**
 * 123panfx.com 自动签到 -- Loon/QuanX/Surge 免填 Cookie 版
 *
 * Cookie 由 panfx_cookie.js 自动抓取到 $persistentStore("panfx_cookie"),
 * 本脚本取用后 POST 签到,无需手动维护。
 * cron 建议: 0 8 * * *
 * 同步抓到的 UA 也一并使用,降低风控概率。
 */

const $ = new Env("123PanFx [签到]");

const CK_KEY = "panfx_cookie";
const UA_KEY = "panfx_ua";
const URL    = "https://123panfx.com/my-sign.htm";

(function main() {
  const cookie = ($.getdata(CK_KEY) || "").trim();
  if (!cookie) {
    $.msg("123PanFx", "❌ 未找到 Cookie", "请用 Safari 打开一次 123panfx.com 触发抓取");
    $.done(); return;
  }
  const ua = ($.getdata(UA_KEY) || "").trim() ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  const opts = {
    url: URL,
    method: "POST",
    headers: {
      "User-Agent": ua,
      "Cookie": cookie,
      "Referer": "https://123panfx.com/",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: ""
  };

  $httpClient.post(opts, (error, response, data) => {
    if (error) { $.msg("123PanFx", "❌ 签到失败", "网络错误 " + error); $.done(); return; }
    let msg = data;
    try {
      const obj = JSON.parse(data);
      const code = obj.code;
      msg = obj.message || JSON.stringify(obj);
      if (code == 0)       { $.msg("123PanFx", "✅ 签到成功", msg + " 积分已到账"); }
      else if (/签到过/.test(msg)) { $.msg("123PanFx", "已签到", "今天已经签过啦"); }
      else                 { $.msg("123PanFx", "⚠ 签到异常", "code=" + code + " " + msg); }
    } catch (e) {
      $.msg("123PanFx", "⚠ 解析失败", data);
    }
    $.done();
  });
})();

// ======== 通用 Env 封装 ========
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