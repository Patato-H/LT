/**
 *.解析式签到 追盘猫(CloudSave Pro) 自动签到 v2 -- 详细数据版 + 自动兑换PRO
 *
 * 流程: 签到 -> 拉登录/会员/邀请/状态 ->
 *       若 VIP 非活跃(或已过期) 且 积分>=80 -> 自动 POST /vip/point-redeem {plan_id:1}
 *       通知按 bilibili 风格罗列数据。
 * cron 建议: 0 8 * * *
 */
const $ = new Env("追盘猫 [签到]");

const TK_KEY = "zpan_token";
const UA_KEY  = "zpan_ua";
const BAL_KEY= "zpan_balance";
const BASE   = "https://zpanmao.com/api/v1";
const PRO_PLAN_ID = 1;   // PRO套餐
const PRO_PRICE   = 80;  // PRO所需积分

(function main() {
  // 实际签到延迟 0~180 秒(可在 08:00~08:03 随机执行), 需配合 cron timeout 覆盖
  var delayMs = Math.floor(Math.random() * 181) * 1000;
  setTimeout(run, delayMs);
})();
function run() {
  const token = ($.getdata(TK_KEY) || "").trim();
  if (!token) { $.msg("追盘猫", "❌ 未获取 Token", "请登录追盘猫打开一次触发抓取"); return; }
  const ua = ($.getdata(UA_KEY) || "").trim() ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const H = { "User-Agent": ua, "Authorization": "Bearer " + token, "Content-Type": "application/json" };
  const prev = safeParse($.getdata(BAL_KEY));

  // 1. 签到
  $.post(BASE + "/checkin", H, "{}", (ok, d) => {
    const signStatus = ok ? "成功" : getMsg(d);
    let status=null, bal=null, plan=null, invite=null, n=0;
    const fin = () => { if(++n>=4) handleAll(ok, signStatus, status, bal, plan, invite, prev); };
    $.get(BASE+"/checkin/status", H, (o,x)=>{ if(o) status=x.data;   fin(); });
    $.get(BASE+"/points/balance", H, (o,x)=>{ if(o) bal=x.data;     fin(); });
    $.get(BASE+"/vip/my-plan",    H, (o,x)=>{ if(o) plan=x.data;    fin(); });
    $.get(BASE+"/invite/info",    H, (o,x)=>{ if(o) invite=x.data;  fin(); });
  });
} // end run (延迟后执行签到)

/* ---------- 核心: 汇总 + 自动兑换 ---------- */
function handleAll(signOk, signStatus, status, bal, plan, invite, prev) {
  const cur = bal ? (bal.balance ?? bal.available_points ?? null) : null;
  const prevB = prev && typeof prev.b === "number" ? prev.b : null;
  const gain = (cur != null && prevB != null) ? cur - prevB : null;
  if (cur != null) $.setdata(JSON.stringify({b:cur}), BAL_KEY);

  const L = [];
  L.push("签到: " + (signOk ? "✅ 成功" : "⚠ " + signStatus));
  if (status) {
    L.push("连续 " + (status.streak_days??"-") + " 天・最长 " + (status.max_streak??"-") + " 天・本月 " + (status.monthly_checkins??"-") + " 次");
    if (status.next_milestone) L.push("下里程碑: 再签" + status.next_milestone.remaining + "次 → +" + status.next_milestone.bonus + "分");
  }
  if (cur != null) {
    let s = "当前积分: " + cur;
    if (gain != null && gain !== 0) s += " (本次" + (gain>0?"+":"") + gain + ")";
    L.push(s);
  }
  if (cur != null && cur < PRO_PRICE) {} // 距离提示统一在会员块里算
  if (invite && invite.stats) {
    L.push("邀请码 " + (invite.invite_code||"-") + "・已邀 " + (invite.stats.total_invites||0) + " 人");
    if (invite.milestone_info && invite.milestone_info.next_count)
      L.push("下阶段: 达" + invite.milestone_info.next_count + "人 → 每邀+" + invite.milestone_info.next_per_invite + "分");
  }

  // 会员状态
  let vipExp = null, isVip = false;
  if (plan) {
    vipExp = plan.vip_expires_at ? String(plan.vip_expires_at).slice(0,10) : null;
    isVip  = (plan.is_vip === true) || (plan.current_plan && plan.current_plan.id !== 0);
  }
  L.push("会员: " + (isVip ? ("VIP 有效期至 " + vipExp + " · 续费模式") : ("免费版 → PRO 需 " + PRO_PRICE + " 分/30天")));

  // ---- 自动兑换 PRO(积分够即兑, 已是VIP也兑以延长时长) ----
  const canRedeem = (cur != null && cur >= PRO_PRICE);
  if (canRedeem) {
    const preBal = cur, preExp = vipExp, preTier = isVip ? "VIP" : "免费版";
    L.push("→ 积分已够 " + PRO_PRICE + "，自动兑换 PRO …");
    $.post(BASE + "/vip/point-redeem", H, JSON.stringify({ plan_id: PRO_PLAN_ID }), (ok, d) => {
      if (!ok) { L.push("⚠ 兑换失败: " + getMsg(d)); notify(L); return; }
      // 兑换成功 → 回读新余额 & 新到期日
      let _n = 0;
      const fin = () => { if (++_n >= 2) { notify(L); } };
      $.get(BASE+"/points/balance", H, (o,x)=>{ if(o&&x.data) { const nb=x.data.balance!=null?x.data.balance:x.data.available_points; L.push("🎉 兑换成功: 余额 " + preBal + " → " + nb + " 分"); } fin(); });
      $.get(BASE+"/vip/my-plan", H, (o,x)=>{ if(o&&x.data) { const ne=x.data.vip_expires_at?String(x.data.vip_expires_at).slice(0,10):"?"; L.push("会员: " + (preTier==="VIP"?"VIP":"免费版") + " → PRO, 有效期至 " + ne); L.push("时长: 原到期" + (preExp||"—") + " → " + ne + " (+30天)"); } fin(); });
    });
  } else {
    if (cur != null) L.push("距下次兑换(" + PRO_PRICE + "分)还差 " + (PRO_PRICE - cur) + " 分");
    notify(L);
  }
}

function notify(lines){ $.msg("追盘猫", lines.filter(Boolean).join("\n"), ""); $.done(); }
function getMsg(d){ try{ return (JSON.parse(d).message)||"未知"; }catch(e){ return d||"err"; } }
function safeParse(s){ try{ return JSON.parse(s); }catch(e){ return null; } }

function Env(name){
  this.name = name;
  this.isSurge = () => typeof $httpClient !== "undefined";
  this.isQuanX = () => typeof $task !== "undefined";
  this.isLoon  = () => typeof $loon  !== "undefined";
  // 封装 request
  this.post = (url,H,b,cb)=>{ if(this.isSurge()||this.isLoon()) $httpClient.post({url,headers:H,body:b},(e,r,d)=>cb(!e&&(r&&r.statusCode<400),parseResp(d))); };
  this.get  = (url,H,cb)=>{ if(this.isSurge()||this.isLoon()) $httpClient.get({url,headers:H},(e,r,d)=>cb(!e&&(r&&r.statusCode<400),parseResp(d))); };
  this.msg = (t,s,b)=>{ if(this.isSurge()||this.isLoon()) $notification.post(t,s,b); else if(this.isQuanX()) $notify(t,s,b); };
  this.getdata=(k)=>(this.isSurge()||this.isLoon())?$persistentStore.read(k):(this.isQuanX()?$prefs.valueForKey(k):null);
  this.setdata=(v,k)=>(this.isSurge()||this.isLoon())?$persistentStore.write(v,k):(this.isQuanX()?$prefs.setValueForKey(v,k):false);
  this.done=()=>{ if(typeof $done!=="undefined") $done(); };
}
function parseResp(d){ try{ return JSON.parse(d); }catch(e){ return {_raw:d}; } }
