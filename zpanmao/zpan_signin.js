/**
 * 追盘猫(zpanmao.com, CloudSave Pro) 自动签到 -- Loon/QuanX/Surge
 *
 * Token 由 zpan_cookie.js 自动抓取存 $persistentStore("zpan_token")
 * cron 签到 POST /api/v1/checkin,读取返回的积分与连续天数，
 * 再取当前积分余额，一条通知汇报。
 * cron 建议: 0 8 * * *
 */
const $ = new Env("追盘猫 [签到]");

const TK_KEY  = "zpan_token";
const UA_KEY  = "zpan_ua";
const BASE    = "https://zpanmao.com/api/v1";

(function main() {
  const token = ($.getdata(TK_KEY) || "").trim();
  if (!token) {
    $.msg("追盘猫", "❌ 未找到 Token", "请登录 zpanmao.com 打开一次触发抓取");
    $.done(); return;
  }
  const ua = ($.getdata(UA_KEY) || "").trim() ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

  const H = {
    "User-Agent": ua,
    "Authorization": "Bearer " + token,
    "Referer": "https://zpanmao.com/",
    "Accept": "application/json",
    "Content-Type": "application/json"
  };

  // 1. 签到
  $httpClient.post({ url: BASE + "/checkin", headers: H, body: "{}" }, (err, res, data) => {
    if (err) { $.msg("追盘猫", "❌ 签到失败", "网络错误 " + err); $.done(); return; }
    let code, msg = data;
    try { const o = JSON.parse(data); code = o.code; msg = o.message || JSON.stringify(o); } catch(e){}
    // 部分实现 code=0 成功 / code!=0 失败或用 HTTP 状态码。宽松处理：
    const ok = (code === 0) || (code === undefined && !/already|已|fail|error/i.test(msg));
    const doneToday = /already|today.*sign|已签到|今天.*签/i.test(msg) || !ok;

    // 2. 拉余额 + 状态
    $httpClient.get({ url: BASE + "/points/balance", headers: H }, (e2, r2, bdata) => {
      let balance = null;
      try { const o = JSON.parse(bdata); balance = o.data?.available_points ?? o.available_points ?? o.data?.balance ?? null; } catch(_){}
      const bal = balance === null ? "" : ("当前余额 " + balance + " 积分");

      // 解析签到返回的积分明细
      let detail = "";
      try {
        const o = JSON.parse(data);
        const d = o.data || o;
        let parts = [];
        if (d.total_points != null) parts.push("+" + d.total_points + " 积分");
        if (d.base_points != null)  parts.push("基础" + d.base_points);
        if (d.streak_bonus > 0)     parts.push("连续加成+" + d.streak_bonus);
        if (d.is_critical > 10)     parts.push("暴击×" + (d.is_critical / 10).toFixed(1));
        if (d.streak_days != null)  parts.push("连续" + d.streak_days + "天");
        detail = parts.join("、");
      } catch(_){}

      const title = ok ? "✅ 签到成功" : "今天已签到";
      const subj = [detail, bal].filter(Boolean).join(" | ");
      $.msg("追盘猫", title, subj || msg);
      $.done();
    });
  });
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