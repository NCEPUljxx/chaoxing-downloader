# 超星课件下载助手

一款 Chrome/Edge 浏览器扩展，支持在超星（学习通）平台资料区和课程学习页批量下载课件文件，绕过"不允许下载"限制。

## 功能

- 📥 **浮动按钮**：页面右下角蓝色按钮，点击展开课件面板
- ✅ **多选下载**：每个课件前有勾选框，支持全选/反选/仅选受限文件
- 🔓 **绕过限制**：通过预览页解析 CDN 直链，下载受限文件
- 📄 **多格式支持**：PDF、DOCX、PPTX 等文档文件
- 📚 **课程页支持**：课程学习页自动识别内嵌课件，提取章节名
- 🖥 **双浏览器兼容**：Chrome 与 Edge 均可使用

> ⚠️ 视频（MP4）下载功能已移除，仅支持文档类文件下载。

## 安装

### Chrome

1. 打开 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载未打包的扩展程序」
4. 选择 `extension/` 文件夹

### Edge

1. 打开 `edge://extensions/`
2. 开启左下角「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `extension/` 文件夹

## 使用方式

### 资料区下载

1. 进入超星课程 → 点击「资料」
2. 页面右下角会出现 📥 浮动按钮
3. 点击按钮打开课件面板
4. 勾选需要下载的文件
5. 点击「⬇ 下载」按钮

### 课程页下载

1. 进入超星课程具体章节
2. 右下角 📥 按钮点击后会显示该章节内嵌的课件
3. 勾选后下载，文件名自动使用章节名称

### 按钮说明

| 按钮 | 功能 |
|---|---|
| ☐ 全选 | 切换全选/取消全选 |
| 🔒 仅限 | 仅勾选受限（带锁标记）的文件 |
| ⬇ 下载 (N) | 下载已勾选的 N 个文件 |

## 文件结构

```
extension/
├── manifest.json      # 扩展配置
├── background.js      # Service Worker：跨域请求、CDN 解析、下载调度
├── content.js         # Content Script：页面扫描、UI 面板、用户交互
├── styles.css         # 面板样式
├── popup.html         # 工具栏弹窗（概览信息）
├── popup.js           # 弹窗逻辑
└── icons/             # 扩展图标
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 技术原理

### 文件下载流程

```
用户选择文件 → Content Script 发送到 Background
  → 非受限文件：尝试直接下载 API
  → 受限文件 / 课程页文件：
      1. get-preview-url API 获取预览页 URL
      2. 加载预览页 HTML
      3. 提取 CDN 前缀（缩略图 URL）
      4. 构造 CDN 直链下载 URL
      5. chrome.downloads API 触发下载
```

### CDN 路径格式

文档文件存储在 `s3.cldisk.com` CDN 上：

```
https://s3.cldisk.com/sv-w{N}/doc/{XX}/{XX}/{XX}/{objectId}/
├── thumb/1.png              # 缩略图
├── pdf/{objectId}.pdf       # PDF 渲染版（无需认证）
└── {objectId}.{ext}         # 原始文件（无需认证）
```

### 页面扫描策略

1. **新版资料页**：从 `li.dataBody_file[onclick*="toOpen"]` 直接提取
2. **旧版资料页**：从 `iframe[name="frame_content-zl"]` 内提取
3. **课程学习页**：从 `iframe[src*="knowledge/cards"]` 的嵌套 iframe 中提取 `objectid` 和 `data` JSON

## 支持的文件类型

| 格式 | 图标 | 说明 |
|---|---|---|
| PDF | 📄 | 优先使用 CDN PDF 渲染版 |
| DOCX | 📝 | 先尝试原格式，回退到 PDF 渲染版 |
| PPTX | 📊 | 先尝试原格式，回退到 PDF 渲染版 |

## 兼容性

| 浏览器 | 状态 |
|---|---|
| Chrome | ✅ 完全支持 |
| Edge | ✅ 完全支持 |

## 注意事项

1. 需要在超星课程页面使用，其他页面扩展不会加载文件列表
2. 下载文件默认保存到浏览器下载目录
3. 受限文件（带 🔒 标记）通过 CDN 预览页解析下载，非直接 API 下载
4. 部分 DOCX/PPTX 文件可能下载为 CDN 转码后的 PDF 版本
5. CDN URL 无需浏览器 Cookie 认证，可直接下载

## 版本历史

### v7.0.0（当前）

- 重写页面扫描器，兼容新旧页面结构
- 新增课程学习页内嵌课件识别
- 修复复选框在 Edge 中的显示问题
- 修复面板定位（按钮隐藏后坐标丢失）
- 移除视频下载功能
- 文件列表按 dataId+objectId 去重
- 扩展 URL 匹配覆盖所有超星子域名

## License

MIT
