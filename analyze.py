# -*- coding: utf-8 -*-
"""
DormMate M2 数据分析脚本
功能：读取 dormmate.csv -> 校验数据 -> 基础统计 -> 环境状态判断 ->
      绘制温湿度趋势图 trend.png -> 生成 report.html 报告。
每次运行都会重新计算并覆盖旧的结果文件，更换 CSV 后无需手动修改。
"""

import csv
import os
import base64
import sys
from collections import Counter

# 让控制台输出使用 UTF-8，避免 Windows 下中文打印乱码
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

import matplotlib
matplotlib.use('Agg')  # 使用无界面后端，只保存图片不弹窗
import matplotlib.pyplot as plt

# 设置中文字体，避免趋势图和报告里中文乱码
plt.rcParams['font.sans-serif'] = ['Microsoft YaHei', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False  # 正确显示负号

CSV_FILE = 'dormmate.csv'    # 输入：网页导出的 CSV
IMG_FILE = 'trend.png'       # 输出：趋势图
REPORT_FILE = 'report.html'  # 输出：报告页面


def judge(temp, humidity):
    """环境判断规则：与 M1 网页版完全一致，返回状态字符串。"""
    if temp > 30:
        return '偏热'
    elif temp < 10:
        return '偏冷'
    elif humidity > 70:
        return '潮湿'
    elif humidity < 30:
        return '干燥'
    elif temp >= 28:
        return '偏热'
    else:
        return '正常'


def load_records():
    """读取并校验 CSV，返回 (有效记录列表, 校验错误列表)。"""
    records = []
    errors = []
    if not os.path.exists(CSV_FILE):
        print(f'[错误] 找不到输入文件 {CSV_FILE}，请先在网页导出 CSV。')
        return records, errors

    with open(CSV_FILE, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        header = next(reader, None)
        expected = ['time', 'temperature', 'humidity', 'status']
        if header is None or [h.strip() for h in header] != expected:
            print(f'[警告] 表头不是标准的 {expected}，仍尝试按列读取。')

        for line_no, row in enumerate(reader, start=2):
            # 列数校验
            if len(row) < 4:
                errors.append(f'第 {line_no} 行：列数不足，已跳过')
                continue
            time_str = row[0].strip()
            # 数字解析校验
            try:
                temp = float(row[1])
                hum = float(row[2])
            except ValueError:
                errors.append(f'第 {line_no} 行：温度/湿度不是数字，已跳过')
                continue
            # 范围校验（与 M1 一致：温度 0~60，湿度 0~100）
            if temp < 0 or temp > 60 or hum < 0 or hum > 100:
                errors.append(f'第 {line_no} 行：数值超出合理范围，已跳过')
                continue
            # status 用同一套规则重新计算，保证与 M1 一致
            records.append({
                'time': time_str,
                'temp': temp,
                'hum': hum,
                'status': judge(temp, hum),
            })
    return records, errors


def compute_stats(records):
    """基础统计：总数、温度/湿度极值、状态计数、异常记录筛选。"""
    temps = [r['temp'] for r in records]
    hums = [r['hum'] for r in records]
    status_counter = Counter(r['status'] for r in records)
    abnormal = [r for r in records if r['status'] != '正常']
    return {
        'total': len(records),
        'temp_max': max(temps),
        'temp_min': min(temps),
        'hum_max': max(hums),
        'hum_min': min(hums),
        'status_counter': status_counter,
        'abnormal': abnormal,
    }


def fmt_num(v):
    """数字格式化：整数去掉 .0，浮点数保留一位小数。"""
    return str(int(v)) if float(v).is_integer() else f'{v:.1f}'


def plot_trend(records):
    """绘制温湿度趋势图：X 轴时间，左轴温度（红）、右轴湿度（蓝）。"""
    times = [r['time'] for r in records]
    temps = [r['temp'] for r in records]
    hums = [r['hum'] for r in records]

    fig, ax1 = plt.subplots(figsize=(11, 5.5))
    # 温度曲线
    ax1.plot(times, temps, color='tab:red', marker='o', linewidth=2, label='温度 (℃)')
    ax1.set_xlabel('时间')
    ax1.set_ylabel('温度 (℃)', color='tab:red')
    ax1.tick_params(axis='y', labelcolor='tab:red')
    ax1.grid(True, linestyle='--', alpha=0.3)

    # 湿度曲线（共享 X 轴，独立右轴）
    ax2 = ax1.twinx()
    ax2.plot(times, hums, color='tab:blue', marker='s', linewidth=2, label='湿度 (%)')
    ax2.set_ylabel('湿度 (%)', color='tab:blue')
    ax2.tick_params(axis='y', labelcolor='tab:blue')

    # 时间标签旋转，避免重叠
    plt.setp(ax1.get_xticklabels(), rotation=45, ha='right')
    fig.tight_layout()
    fig.savefig(IMG_FILE, dpi=120)
    plt.close(fig)
    print(f'[完成] 趋势图已保存到 {IMG_FILE}')


def gen_report(stats, errors):
    """生成 report.html：摘要 + 异常记录 + 内嵌趋势图（base64）。"""
    b64 = ''
    if os.path.exists(IMG_FILE):
        with open(IMG_FILE, 'rb') as f:
            b64 = base64.b64encode(f.read()).decode('utf-8')

    # 各状态数量统计
    status_items = ''.join(
        f'<li><b>{st}</b>：{cnt} 条</li>'
        for st, cnt in stats['status_counter'].most_common()
    )

    # 异常记录表格行
    abnormal_rows = ''.join(
        f'<tr><td>{r["time"]}</td><td>{fmt_num(r["temp"])}</td>'
        f'<td>{fmt_num(r["hum"])}</td><td class="bad">{r["status"]}</td></tr>'
        for r in stats['abnormal']
    )
    if not abnormal_rows:
        abnormal_rows = '<tr><td colspan="4">无异常记录</td></tr>'

    # 校验提示
    err_html = ''
    if errors:
        err_items = ''.join(f'<li>{e}</li>' for e in errors)
        err_html = f'<div class="warn"><h3>校验提示</h3><ul>{err_items}</ul></div>'

    # 页面样式（独立常量，避免在 f-string 中转义大括号）
    style = """
    <style>
      body { font-family: "Microsoft YaHei", sans-serif; margin: 24px; color: #333; background: #f5f6fa; }
      h1 { color: #667eea; }
      h2 { margin-top: 24px; }
      .summary { background: #fff; padding: 16px 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
      .summary ul { list-style: none; padding: 0; }
      .summary li { padding: 4px 0; }
      table { border-collapse: collapse; width: 100%; background: #fff; }
      th, td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: center; }
      th { background: #667eea; color: #fff; }
      .bad { color: #cf1322; font-weight: bold; }
      .warn { background: #fffbe6; padding: 12px 16px; border-radius: 8px; margin-top: 16px; }
      img { max-width: 100%; margin-top: 16px; border-radius: 8px; }
    </style>
    """

    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>DormMate 环境分析报告</title>
{style}
</head>
<body>
<h1>DormMate 环境分析报告</h1>

<div class="summary">
<h2>摘要信息</h2>
<ul>
  <li>总记录条数：<b>{stats['total']}</b></li>
  <li>温度最大值：<b>{fmt_num(stats['temp_max'])} ℃</b> / 最小值：<b>{fmt_num(stats['temp_min'])} ℃</b></li>
  <li>湿度最大值：<b>{fmt_num(stats['hum_max'])} %</b> / 最小值：<b>{fmt_num(stats['hum_min'])} %</b></li>
</ul>
<h3>状态分布</h3>
<ul>{status_items}</ul>
</div>

{err_html}

<h2>需要关注的异常记录（非正常状态）</h2>
<table>
<tr><th>时间</th><th>温度 (℃)</th><th>湿度 (%)</th><th>状态</th></tr>
{abnormal_rows}
</table>

<h2>温湿度趋势图</h2>
<img src="data:image/png;base64,{b64}" alt="趋势图">
</body>
</html>"""

    with open(REPORT_FILE, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'[完成] 报告已保存到 {REPORT_FILE}')


def main():
    print('===== DormMate M2 数据分析 =====')

    # 步骤1：读取 CSV 并确认 Python 能读（读不到或全无效则直接停止）
    records, errors = load_records()
    if not records:
        print('[步骤1] CSV 无法读取或没有有效记录，已停止，不做后续处理。')
        return
    print(f'[步骤1] CSV 读取成功：{len(records)} 条有效记录'
          + (f'（跳过 {len(errors)} 条）' if errors else ''))
    for e in errors:
        print('  跳过：' + e)

    # 步骤2：统计
    stats = compute_stats(records)
    print(f'[步骤2] 统计完成：记录数 {stats["total"]} 条，'
          f'温度 {fmt_num(stats["temp_min"])}~{fmt_num(stats["temp_max"])} ℃，'
          f'湿度 {fmt_num(stats["hum_min"])}~{fmt_num(stats["hum_max"])} %')
    print('  状态分布：' + '，'.join(f'{st} {cnt} 条' for st, cnt in stats['status_counter'].most_common()))

    # 步骤3：绘制温湿度趋势图（温度、湿度两条曲线）
    plot_trend(records)

    # 步骤4：生成 HTML 报告
    gen_report(stats, errors)

    # 关注记录
    print(f'[关注记录] {len(stats["abnormal"])} 条（非正常状态）：')
    for r in stats['abnormal']:
        print(f'  {r["time"]}  温度 {fmt_num(r["temp"])} ℃  湿度 {fmt_num(r["hum"])} %  -> {r["status"]}')
    print('[完成] 全部结果已生成：trend.png、report.html')


if __name__ == '__main__':
    main()
