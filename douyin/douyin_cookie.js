// 抖音创作者中心 Cookie 自动抓取脚本
// 登录成功后（请求头 Cookie 含 sessionid）自动抓取并存入 persistentStore
// 作者: @Patatooo

let headers = $request.headers;
let cookie = headers["Cookie"] || headers["cookie"];

// 没有 Cookie 头，直接放行
if (!cookie) {
    $done({});
}

// 未登录（不含 sessionid 关键登录态），不抓
if (cookie.indexOf("sessionid") === -1) {
    $done({});
}

// 解析 Cookie 字符串为 JSON 数组（Playwright add_cookies 兼容格式）
let expires = Math.floor(Date.now() / 1000) + 30 * 24 * 3600; // 30 天后
let arr = cookie
    .split(/;\s*/)
    .map(function (pair) {
        let idx = pair.indexOf("=");
        if (idx <= 0) return null;
        return {
            name: pair.slice(0, idx),
            value: pair.slice(idx + 1),
            domain: ".douyin.com",
            path: "/",
            expires: expires,
        };
    })
    .filter(Boolean);

let json = JSON.stringify(arr);

// 存入 persistentStore，供后续复制
$persistentStore.write(json, "douyin_creator_cookies");

// 通知（完整 JSON 放消息体，方便直接复制）
$notification.post(
    "✅ 抖音 Cookie 已抓取",
    "共 " + arr.length + " 条，已存入 Loon 数据",
    json
);

$done({});
