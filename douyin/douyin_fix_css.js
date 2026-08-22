// 抖音创作者中心登录弹窗自动适配（注入 CSS，解决 PC 弹窗在手机显示不全）
// 作者: @Patatooo

let headers = $response.headers || {};
let ct = headers["Content-Type"] || headers["content-type"] || "";

// 只处理 HTML 响应
if (ct.indexOf("text/html") === -1) {
    $done({});
}

let body = $response.body;
if (!body) {
    $done({});
}

// 登录弹窗固定 726px 宽（PC 设计），缩放到手机视口内并居中
const css =
    '<style id="patatooo-login-fix">' +
    '#douyin_login_landing_flat_container{' +
    'transform:translateX(-181.5px) scale(0.5)!important;' +
    'transform-origin:top left!important;' +
    '}' +
    "</style>";

if (body.indexOf("</head>") !== -1) {
    body = body.replace("</head>", css + "</head>");
} else {
    body = css + body;
}

$done({ body: body });
