# Vega · 期刊收录标签

**v1.0.1** · 在学术检索页面直接查看期刊的公开收录信息。

Vega 会在刊名旁显示 CSSCI、CSCD、北大核心、中科院分区、Top 及国际期刊预警标签。数据内置，匹配在本地完成，不上传检索记录。

[下载安装包](https://github.com/xby0328/vega-journal-tags/releases/latest/download/vega-journal-tags-v1.0.1.zip) · [版本发布页](https://github.com/xby0328/vega-journal-tags/releases/latest) · [安装说明](INSTALL.md) · [隐私说明](PRIVACY.md)

![Vega 圆角设置面板与公开收录标签](assets/vega-public.png)

v1.0.1 修复未适配页面中工具栏弹窗收缩为窄条的问题，原生弹窗恢复为 336px 宽。已安装用户在扩展管理页重新加载扩展，再刷新检索页面。

## 能做什么

- 显示 CSSCI 来源版 / 扩展版、CSCD 核心库 / 扩展库、北大核心、中科院大类分区和 Top、国际期刊预警。
- 双库收录合并为一枚标签；点击标签查看 ISSN、学科、小类分区和预警明细。
- 五项公开来源开关、一组清新默认配色、八类自定义基础色。
- 完整圆角设置面板，浅色、深色与跟随系统主题。
- 本地运行，不使用外部匹配服务，不收集或上传浏览记录。

适配域名包括知网、Web of Science / Clarivate、Google 学术、百度学术、ScienceDirect、PubMed、Springer Link 和 Semantic Scholar。网站调整页面结构时，部分页面的匹配可能受影响。

## 安装

1. 下载发布页中的 `vega-journal-tags-v1.0.1.zip`，解压到固定文件夹。
2. 打开 `chrome://extensions` 或 `edge://extensions`，启用开发者模式。
3. 点击「加载已解压的扩展程序」，选择含 `manifest.json` 的解压目录。
4. 打开或刷新检索网页即可使用。

也可从本仓库下载源码，加载 `extension/`。安装方式为手动加载，尚未提交扩展商店。

## 数据

| 来源 | 内置版本 |
|---|---|
| CSSCI | 2025–2026 来源版与扩展版 |
| CSCD | 2025–2026 核心库与扩展库 |
| 北大核心 | 中文核心期刊要目总览 |
| 中科院分区 | 2025 终版，含 Top 与小类明细 |
| 国际期刊预警 | 2020–2025 历史累计 |

期刊主表共 **24,354 条**。公开目录之间有重叠；历史预警不表示期刊当前仍在名单内。收录、分区和预警状态以对应目录及公告为准。

## 开发

```text
node test_judge.js
node test_extension.js
node tools/build_themes.js
python build_release.py
```

浏览器测试依赖 Playwright 与本机 Edge，使用临时配置及拦截的页面样例，不访问现有浏览器账户。可通过 `NODE_PATH` 指向已有 Playwright 依赖目录。

生成的安装包、源码包和 SHA256 校验和位于 `release/`。如需更换输出目录：

```text
python build_release.py --output-dir <输出目录>
```

同版本压缩包不会被覆盖；修改后发布新版本请更新 manifest 和详情页显示的版本号。

## 许可

软件代码采用 [MIT License](LICENSE)。期刊目录及分区信息的相关权利属于对应数据来源，MIT 许可不授予这些目录的额外使用权。
