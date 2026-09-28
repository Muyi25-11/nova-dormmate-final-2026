// DormMate M1 环境分析脚本

// 历史记录数组：只保存在内存中，页面刷新后自动清空（至少支持 5 条，实际无上限）
const history = [];

// 状态样式映射表：中文状态 -> CSS 类名和标签颜色
const STATUS_MAP = {
  '偏热': { cls: 'hot', color: '#cf1322' },
  '偏冷': { cls: 'cold', color: '#1d39c4' },
  '潮湿': { cls: 'humid', color: '#006d75' },
  '干燥': { cls: 'dry', color: '#ad6800' },
  '正常': { cls: 'normal', color: '#389e0d' }
};

// 获取页面元素
const tempInput = document.getElementById('tempInput');
const humidityInput = document.getElementById('humidityInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const result = document.getElementById('result');
const historyList = document.getElementById('historyList');
const exportBtn = document.getElementById('exportBtn');
const inputView = document.getElementById('inputView');
const reportView = document.getElementById('reportView');
const reportSummary = document.getElementById('reportSummary');
const trendCanvas = document.getElementById('trendCanvas');
const reportTableBody = document.getElementById('reportTableBody');
const backBtn = document.getElementById('backBtn');

// ===== M3 本机交互：摄像头 / 语音识别 ASR / 语音合成 TTS 相关元素 =====
const cameraBtn = document.getElementById('cameraBtn');
const snapshotBtn = document.getElementById('snapshotBtn');
const cameraVideo = document.getElementById('cameraVideo');
const snapshotImg = document.getElementById('snapshotImg');
const snapshotCanvas = document.getElementById('snapshotCanvas');
const cameraHint = document.getElementById('cameraHint');
const asrBtn = document.getElementById('asrBtn');
const asrResult = document.getElementById('asrResult');
const asrFallback = document.getElementById('asrFallback');
const asrManualInput = document.getElementById('asrManualInput');
const asrManualBtn = document.getElementById('asrManualBtn');
const ttsBtn = document.getElementById('ttsBtn');

// 摄像头视频流引用（开启后保存，快照时从视频帧截取单张）
let cameraStream = null;

// 当前环境状态文本：跟随最新分析结果动态变化，供语音合成 TTS 朗读
let currentStatusText = '';

// 补零函数：把个位数格式化为两位数，例如 9 -> 09
function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

// 用 Date 获取当前本地时间，格式化为 YYYY-MM-DD HH:mm:ss
function getNow() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
         pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// 用 innerHTML 渲染历史记录列表（最新在前）
function renderHistory() {
  let html = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const r = history[i];
    html += '<li><span class="time">' + r.time + '</span>' + r.temp + '℃ / ' + r.humidity + '% ' +
            '<span class="tag" style="background:' + r.color + '">' + r.status + '</span></li>';
  }
  historyList.innerHTML = html;
}

// 画一条折线（含数据点）
function drawLine(ctx, points, color) {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.stroke();
  ctx.fillStyle = color;
  points.forEach(function (p) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

// 用 Canvas 画温湿度双折线图（数据来自 history，每次导出重新绘制）
function drawTrendChart() {
  const ctx = trendCanvas.getContext('2d');
  const W = trendCanvas.width, H = trendCanvas.height;
  const left = 50, right = 50, top = 30, bottom = 60;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const n = history.length;

  ctx.clearRect(0, 0, W, H);

  // X 坐标：按记录索引均分（只有一条时居中）
  function x(i) {
    return n === 1 ? left + plotW / 2 : left + (plotW * i) / (n - 1);
  }
  // Y 坐标：温度左轴 0~60，湿度右轴 0~100
  function yTemp(v) { return top + plotH - (plotH * v) / 60; }
  function yHum(v) { return top + plotH - (plotH * v) / 100; }

  // 网格线 + 温度刻度（左轴）
  ctx.strokeStyle = '#eee';
  ctx.fillStyle = '#999';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  [0, 20, 40, 60].forEach(function (v) {
    const yy = yTemp(v);
    ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(left + plotW, yy); ctx.stroke();
    ctx.fillText(v + '℃', left - 8, yy);
  });

  // 湿度刻度（右轴）
  ctx.textAlign = 'left';
  [0, 50, 100].forEach(function (v) {
    const yy = yHum(v);
    ctx.fillText(v + '%', left + plotW + 8, yy);
  });

  // X 轴时间标签（HH:mm）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < n; i++) {
    ctx.fillText(history[i].time.slice(11, 16), x(i), top + plotH + 8);
  }

  // 温度折线（红）+ 湿度折线（蓝）
  drawLine(ctx, history.map(function (r, i) { return [x(i), yTemp(r.temp)]; }), '#e74c3c');
  drawLine(ctx, history.map(function (r, i) { return [x(i), yHum(r.humidity)]; }), '#3498db');

  // 图例
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(left, 8, 14, 14);
  ctx.fillStyle = '#333';
  ctx.fillText('温度(℃)', left + 20, 15);
  ctx.fillStyle = '#3498db';
  ctx.fillRect(left + 100, 8, 14, 14);
  ctx.fillStyle = '#333';
  ctx.fillText('湿度(%)', left + 120, 15);
}

// 生成报告：统计 + 关注记录 + 折线图（数据来自 history，每次导出重新生成）
function buildReport() {
  const total = history.length;
  let tempMax = -Infinity, tempMin = Infinity;
  let humMax = -Infinity, humMin = Infinity;
  const statusCount = {};
  const attention = [];

  history.forEach(function (r) {
    if (r.temp > tempMax) tempMax = r.temp;
    if (r.temp < tempMin) tempMin = r.temp;
    if (r.humidity > humMax) humMax = r.humidity;
    if (r.humidity < humMin) humMin = r.humidity;
    statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    if (r.status !== '正常') attention.push(r);
  });

  // 摘要
  let statusHtml = '';
  for (const st in statusCount) {
    statusHtml += '<span class="tag" style="background:' + STATUS_MAP[st].color + '">' +
                  st + ' ' + statusCount[st] + ' 条</span> ';
  }
  reportSummary.innerHTML =
    '<p>总记录数：<b>' + total + '</b></p>' +
    '<p>温度：最高 <b>' + tempMax + ' ℃</b> / 最低 <b>' + tempMin + ' ℃</b></p>' +
    '<p>湿度：最高 <b>' + humMax + ' %</b> / 最低 <b>' + humMin + ' %</b></p>' +
    '<p>状态分布：' + statusHtml + '</p>';

  // 关注记录表格
  let rowsHtml = '';
  if (attention.length === 0) {
    rowsHtml = '<tr><td colspan="4">无异常记录</td></tr>';
  } else {
    attention.forEach(function (r) {
      rowsHtml += '<tr><td>' + r.time + '</td><td>' + r.temp + '</td>' +
                  '<td>' + r.humidity + '</td><td class="bad">' + r.status + '</td></tr>';
    });
  }
  reportTableBody.innerHTML = rowsHtml;

  // 画折线图
  drawTrendChart();
}

// 点击按钮触发分析
analyzeBtn.addEventListener('click', function () {
  // ① 输入读取：读取输入框原始文本，再用 Number() 转成数字
  const tempRaw = tempInput.value.trim();
  const humidityRaw = humidityInput.value.trim();
  const temp = Number(tempRaw);
  const humidity = Number(humidityRaw);

  // 校验 1：空输入，弹窗提示并不进行分析
  if (tempRaw === '' || humidityRaw === '') {
    alert('请输入温度和湿度');
    return;
  }

  // 校验 2：非数字（isNaN 判断）
  if (isNaN(temp) || isNaN(humidity)) {
    alert('请输入有效数字');
    return;
  }

  // 校验 3：数值超出合理范围
  if (temp < 0 || temp > 60 || humidity < 0 || humidity > 100) {
    alert('数值不合理：温度需在 0~60℃，湿度需在 0~100%');
    return;
  }

  // ② 规则判断：多分支 if/else 判断环境状态
  let status;
  let advice;
  if (temp > 30) {
    status = '偏热';
    advice = '注意通风，开窗或风扇降温';
  } else if (temp < 10) {
    status = '偏冷';
    advice = '注意保暖，减少开窗';
  } else if (humidity > 70) {
    status = '潮湿';
    advice = '注意通风除湿';
  } else if (humidity < 30) {
    status = '干燥';
    advice = '适当加湿，多喝水';
  } else if (temp >= 28) {
    status = '偏热';
    advice = '体感偏热，可开窗通风';
  } else {
    status = '正常';
    advice = '环境舒适，无需调整';
  }

  // 渲染结果展示区（innerHTML）
  result.className = 'result ' + STATUS_MAP[status].cls;
  result.innerHTML = '<div class="status">' + status + '</div>' +
                     '<div class="advice">建议：' + advice + '</div>';

  // 更新当前状态文本，供语音合成 TTS 朗读（随最新结果动态变化）
  currentStatusText = '当前环境状态是' + status + '，建议' + advice;

  // ③ 历史记录追加：push 到内存数组，不覆盖旧记录
  history.push({
    time: getNow(),
    temp: temp,
    humidity: humidity,
    status: status,
    color: STATUS_MAP[status].color
  });

  // 重新渲染历史列表
  renderHistory();
});

// 导出 CSV：把内存里的历史记录通过 Blob 下载为 dormmate.csv
function exportCsv() {
  // 没有历史记录时提示，不生成空文件
  if (history.length === 0) {
    alert('暂无历史记录可导出，请先进行分析');
    return;
  }

  // CSV 表头（固定四列）
  const header = 'time,temperature,humidity,status';

  // 逐条把历史记录拼成 CSV 行；time 前加一个空格，强制 Excel 按文本显示时间
  //（否则 Excel 会把 2026-09-28 18:00:00 识别成日期时间，列宽不足时显示成 #####）
  const rows = history.map(function (r) {
    return ' ' + r.time + ',' + r.temp + ',' + r.humidity + ',' + r.status;
  });

  // 表头 + 数据行用换行连接；开头加 BOM 让 Excel 正确识别 UTF-8 中文
  const csv = '\uFEFF' + header + '\n' + rows.join('\n');

  // 用 Blob 生成 CSV 文件内容
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });

  // 用 URL.createObjectURL 生成临时链接并触发下载
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dormmate.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // 生成报告并切换到报告视图（数据来自当前 history，每次导出重新生成）
  buildReport();
  inputView.hidden = true;
  reportView.hidden = false;
}

// 点击导出按钮触发导出
exportBtn.addEventListener('click', exportCsv);

// 返回录入视图
backBtn.addEventListener('click', function () {
  reportView.hidden = true;
  inputView.hidden = false;
});

// ===================== M3 本机交互模块 =====================

// 语音合成 TTS：朗读传入的文本
function speak(text) {
  if (!('speechSynthesis' in window)) {
    alert('当前浏览器不支持语音合成（speechSynthesis）');
    return;
  }
  // 取消上一次未读完的朗读，避免叠加
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  window.speechSynthesis.speak(utter);
}

// 执行指令：命中固定语音指令则触发对应功能，其余文字仅展示不触发
// 返回执行反馈文字（未命中指令返回空字符串），便于在页面上展示「指令已触发」
function executeCommand(text) {
  if (!text) return '';
  if (text.indexOf('朗读状态') !== -1) {
    // 触发 TTS：朗读内容跟随当前环境状态动态变化
    speak(currentStatusText || '当前还没有分析结果，请先录入温湿度并点击分析环境');
    return '已执行指令「朗读状态」，正在朗读当前状态';
  }
  if (text.indexOf('拍照') !== -1) {
    // 触发 Camera：复用快照按钮，截取单张现场快照
    if (!cameraStream) {
      return '摄像头未开启，请先点击「开启摄像头」';
    }
    snapshotBtn.click();
    return '已执行指令「拍照」，快照已生成';
  }
  return '';
}

// 判断当前是否运行在 localhost / HTTPS（摄像头 getUserMedia 需要安全上下文）
function isCameraEnvSupported() {
  return location.protocol === 'https:' ||
         location.hostname === 'localhost' ||
         location.hostname === '127.0.0.1';
}

// 页面加载时按当前环境更新摄像头提示与按钮可用状态
(function initCameraEnv() {
  if (isCameraEnvSupported()) {
    cameraHint.textContent = '提示：当前为 localhost 环境，摄像头功能可用。首次使用请在浏览器弹窗中允许摄像头权限。';
  } else {
    cameraHint.textContent = '提示：当前不是 localhost 环境（' + location.protocol + '），摄像头不可用。请在项目目录运行 python -m http.server，再访问 http://localhost:8000。';
    cameraBtn.disabled = true;
    snapshotBtn.disabled = true;
  }
})();

// 摄像头：开启摄像头申请权限并显示视频预览
cameraBtn.addEventListener('click', async function () {
  // getUserMedia 需要安全上下文（localhost 或 HTTPS），file:// 下可能不可用
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('当前环境不支持摄像头：请通过 localhost 访问本页（如运行 python -m http.server），并使用 Chrome/Edge 浏览器');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    cameraVideo.srcObject = cameraStream;
    cameraVideo.style.display = 'block';
    snapshotImg.style.display = 'none';
  } catch (err) {
    alert('摄像头开启失败：' + err.message + '。请确认已授予摄像头权限，并通过 localhost 访问。');
  }
});

// 现场快照：从视频流截取单帧保存为图片（只截一张，不做连续采集）
snapshotBtn.addEventListener('click', function () {
  if (!cameraStream) {
    alert('请先点击「开启摄像头」');
    return;
  }
  snapshotCanvas.width = cameraVideo.videoWidth;
  snapshotCanvas.height = cameraVideo.videoHeight;
  snapshotCanvas.getContext('2d').drawImage(cameraVideo, 0, 0);
  snapshotImg.src = snapshotCanvas.toDataURL('image/png');
  snapshotImg.style.display = 'block';
});

// 语音识别 ASR：优先用 Web Speech API，不支持时降级为手动输入（指令触发逻辑保留）
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  recognition.lang = 'zh-CN';       // 识别中文
  recognition.continuous = false;   // 单次识别，说完即停
  recognition.interimResults = false; // 只要最终结果
  recognition.onresult = function (event) {
    const text = event.results[0][0].transcript;
    const feedback = executeCommand(text);
    asrResult.textContent = '识别结果：' + text + (feedback ? '（' + feedback + '）' : '');
  };
  recognition.onerror = function (event) {
    asrResult.textContent = '识别出错：' + event.error + '（请确认已授予麦克风权限）';
    asrBtn.disabled = false;
  };
  recognition.onend = function () {
    asrBtn.disabled = false;
  };
  asrBtn.addEventListener('click', function () {
    try {
      recognition.start();
      asrBtn.disabled = true;
      asrResult.textContent = '正在聆听，请说话…';
    } catch (err) {
      asrResult.textContent = '启动识别失败：' + err.message;
      asrBtn.disabled = false;
    }
  });
} else {
  // 兼容方案：浏览器不支持 Web Speech API 时，保留文字展示区与指令触发逻辑，改用手动输入
  asrBtn.addEventListener('click', function () {
    asrResult.textContent = '当前浏览器不支持语音识别（Web Speech API），请使用下方输入框手动输入指令。';
  });
  asrFallback.hidden = false;
  asrManualBtn.addEventListener('click', function () {
    const text = asrManualInput.value.trim();
    if (!text) {
      alert('请输入指令，例如「朗读状态」或「拍照」');
      return;
    }
    const feedback = executeCommand(text);
    asrResult.textContent = '手动指令：' + text + (feedback ? '（' + feedback + '）' : '');
    asrManualInput.value = '';
  });
}

// TTS 按钮：朗读当前环境状态
ttsBtn.addEventListener('click', function () {
  speak(currentStatusText || '当前还没有分析结果，请先录入温湿度并点击分析环境');
});
