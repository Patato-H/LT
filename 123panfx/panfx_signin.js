/**
 * 123panfx.com 自动签到 v2.0 -- Loon/QuanX/Surge 免填 Cookie 版
 *
 * Cookie 由 panfx_cookie.js 自动抓取存入 $persistentStore("panfx_cookie")
 * cron 签到后读取「会员中心」的经验/金币数值，并通过与上次差值计算本次获得。
 * 通知内容：版本号 + 本次获得(经验/金币) + 当前总数(经验/金币)
 * cron 建议: 0 8 * * *
 */
const $ = new Env("123PanFx [签到]");

const VERSION = "v2.0";
const CK_KEY   = "panfx_cookie";
const UA_KEY   = "panfx_ua";
const BAL_KEY  = "panfx_balance";   // 上次签到后的余额 {exp,gold}
const SIGN_URL = "https://123panfx.com/my-sign.htm";
const INFO_URL = "https://123panfx.com/my-credits.htm";

(function main() {
  const cookie = ($.getdata(CK_KEY) || "").trim();
  if (!cookie) {
    $.msg("123PanFx " + VERSION, "❌ 未找到 Cookie", "请用 Safari 打开 123panfx.com 触发抓取");
    $.done(); return;
  }
  const ua = ($.getdata(UA_KEY) || "").trim() ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  const headers = {
    "User-Agent": ua,
    "Cookie": cookie,
    "Referer": "https://123panfx.com/",
    "X-Requested-With": "XMLHttpRequest",
    "Content-Type": "application/x-www-form-urlencoded"
  };

  // 步骤1：签到
  $httpClient.post({ url: SIGN_URL, method: "POST", headers: headers, body: "" }, (error, res, data) => {
    if (error) { $.msg("123PanFx " + VERSION, "❌ 签到失败", "网络错误 " + error); $.done(); return; }
    let code, msg = data;
    try { let o = JSON.parse(data); code = o.code; msg = o.message || JSON.stringify(o); } catch(e){}

    // 步骤2：读经验/金币
    $httpClient.get({ url: INFO_URL, headers: { "User-Agent": ua, "Cookie": cookie, "Referer": "https://123panfx.com/" } }, (err2, res2, html) => {
      const bal = parseBalance(html);   // {exp, expMax, gold}
      const prev = readPrev();          // 上次 {exp,gold} 或 null

      let gainExp = null, gainGold = null;
      if (prev && bal) {
        gainExp  = bal.exp  - prev.exp;
        gainGold = bal.gold - prev.gold;
      }

      // 组装通知
      let title = "123盘签到";
      let subtitle = ""; let body2 = "";
      if (code == 0) {
        title = "✅ 签到成功";
      } else if (/签到过/.test(msg)) {
        title = "今天已签到";
      } else {
        title = "⚠️ 签到异常: " + msg;
      }

      let lines = [];
      if (bal) {
        lines.push("当前经验 " + bal.exp + "　金币 " + bal.gold);
      }
      if (gainExp !== null && gainGold !== null) {
        let de = gainExp !== 0 ? (gainExp > 0 ? "+" + gainExp : "" + gainExp) + " 经验" : "";
        let dg = gainGold !== 0 ? (gainGold > 0 ? "+" + gainGold : "" + gainGold) + " 金币" : "";
        if (de || dg) lines.unshift("本次获得 " + [de, dg].filter(Boolean).join("、"));
      }
      lines.push("版本 " + VERSION);

      // 存新余额 ▲ 用最新数值
      if (bal) savePrev(bal);

      $.msg(title, lines.join(" | "), body2);
      $.done();
    });
  });
})();

// 从 "我的积分" 页解析经验/金币
function parseBalance(html) {
  if (!html) return null;
  const expM = (html.match(/经验[：:]\s*(\d+)\s*\/\s*(\d+)/) || html.match(/经验值\s*<\/span>\s*(\d+)\s*\/\s*(\d+)/));
  const goldM = (html.match(/wallet-value-2">\s*(\d+)/) || html.match(/金币\s*<\s*\/div>\s*<div[^>]*>\s*(\d+)/));
  if (!expM && !goldM) return null;
  return {
    exp:  expM ? parseInt(expM[1]) : 0,
    expMax: expM ? parseInt(expM[2]) : 0,
    gold: goldM ? parseInt(goldM[1]) : 0
  };
}
function readPrev(){ try { return JSON.parse($.getdata(BAL_KEY) || "null"); } catch(e){ return null; } }
function savePrev(b){ $.setdata(JSON.stringify({ exp: b.exp, gold: b.gold }), BAL_KEY); }

// ======== 通用 Env 封装 ========
function Env(s) {
  this.name = s;
  this.isSurge = () => typeof $httpClient !== "undefined";
  this.isQuanX = () => typeof $task !== "undefined";
  this.isLoon = () => typeof $loon !== "undefined";
  this.log = (...a) => console.log(a.join("\n"));
  // 通知（兼容三端）
  this.Notify = function(title, subj, body) {
    const sub = Array.isArray(subj) ? subj.join(" | ") : subj;
    if (this.isSurge() || this.isLoon()) $notification.post(title, sub, body);
    else if (this.isQuanX()) $notify(title, sub, body);
  };
  this.msg = (t, s, b) => { this.Notify(t, s, b); };
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