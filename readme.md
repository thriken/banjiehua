# 半截话别乱用

> **当前版本：v1.0 (Release)**

## 项目介绍

中国从古代传下来很多俗语、短语、诗句或有错字句子，说半截和说全了意思大相径庭。本项目收集这些"半截话"，补充全句资料，还原其本意，并提供搜索引擎方便大家查找。

同时也是对传统文化的传承和保护，让更多人了解和学习。

## 技术栈

- **运行时**：Cloudflare Workers（免费额度充足）
- **存储**：Cloudflare KV
- **语言**：JavaScript（零依赖，单文件部署）
- **静态资源**：CSS 托管在 GitHub，通过 Raw URL 加载
- **格式**：兼容 Markdown
- **数据导出**：支持 JSON / Markdown 格式

## 项目结构

```
banjiehua/
├── index.js              # Worker 入口文件（单文件，复制到 CF 控制台即可）
├── readme.md             # 说明文档
├── wrangler.example.toml # 配置模板（仅供参考，手动部署不需要此文件）
├── .gitignore            # Git 忽略规则
└── themes/               # 主题文件夹（托管在 GitHub，通过 Raw URL 加载）
    ├── style.css          # ★ 主题入口（修改 @import 即可切换主题）
    └── default/           # 默认国风主题
        └── style.css      # 样式表
```

## 仓库用途说明

本 GitHub 仓库**仅作为静态资源托管**使用，不涉及 CI/CD 自动部署：

| 内容 | 用途 |
|------|------|
| `themes/` 目录下的 CSS 文件 | 通过 GitHub Raw URL 被 Worker 引用，切换主题无需重新部署 |
| `index.js` | 部署到 Cloudflare Workers 的源代码，通过控制台手动粘贴 |
| `themes/style.css` | 主题切换入口，修改 `@import` 路径即可更换主题 |

> **核心思路**：Worker 代码很少改动（只是硬编码常量），而主题 CSS 经常调整。把 CSS 放在 GitHub，改样式时 push 一下即可，完全不需要碰 Worker。

## 快速部署（手动粘贴到 CF 控制台）

这是唯一的部署方式，无需安装任何工具，零门槛。

### 步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → 创建 Worker
2. 将 `index.js` 完整内容粘贴到在线编辑器中
3. 修改文件顶部硬编码常量（至少修改以下两项）：

```javascript
// 你的域名
const SITE_DOMAIN = '你的域名.com';

// 主题 CSS URL（填你 Fork 后的 GitHub Raw URL）
const THEME_CSS_URL = 'https://raw.githubusercontent.com/你的用户名/banjiehua/master/themes/style.css';
```

4. 在 Worker 设置中绑定资源和机密：
   - **KV 命名空间绑定**：创建一个 KV 命名空间，绑定变量名为 `BANJIEHUA_KV`
   - **机密（Secret）**：添加 `AUTH_CODE`，值为你的后台登录密码
5. 点击"保存并部署"

> **就这么简单！** 只需要 1 个 KV 绑定 + 1 个 Secret。

## 配置说明

`index.js` 顶部有硬编码常量，可按需修改：

```javascript
const SITE_NAME = '半截话别乱用';
const SITE_DESCRIPTION = '...';
const KEYWORDS = '...';
const PAGE_SIZE = 12;
const CACHE_TTL = 3600;
const CATEGORIES = ['诗句', '俗语', '成语', '方言', '其他'];

// 如果你 Fork 了仓库，改成你的 GitHub Raw URL
const STYLE_CSS_URL = 'https://raw.githubusercontent.com/你的用户名/banjiehua/master/themes/style.css';
```

## 切换主题

1. 编辑 GitHub 仓库中 `themes/style.css`
2. 修改 `@import` 路径指向你要的主题：
   ```css
   @import url('default/style.css');     /* 国风主题 */
   /* @import url('dark/style.css'); */   /* 暗色主题（如果有） */
   ```
3. Push 到 GitHub，Worker 自动生效（无需重新部署 index.js）

> 创建新主题：在 `themes/` 下新建文件夹，放入 `style.css`，然后在 `themes/style.css` 中改 `@import` 路径即可。

## 数据备份与恢复

后台管理页面提供数据导出功能：
- **JSON 格式**：保留完整结构，可用于恢复
- **Markdown 格式**：适合阅读和存档

## 隐私安全

敏感信息仅存在于 Cloudflare 服务端，源码中不暴露任何私密信息：

| 敏感项 | 保护方式 |
|--------|----------|
| **AUTH_CODE** | 在 CF 控制台以 Secret 方式设置，仅存在于 Cloudflare 服务端 |
| **KV 绑定** | 在 CF 控制台配置绑定关系，不写在代码中 |

## 功能列表

- 简易后台管理（授权码鉴权）
- 内容字段：短语、全句、来源、作者、释义/注释（Markdown）、分类、标签、备注（Markdown）、引用
- SEO 优化（Structured Data / OG 标签 / Sitemap / Canonical）
- 国风主题，响应式设计，支持移动端
- 主题切换（通过 GitHub `themes/style.css` 热更新，无需重新部署 Worker）
- Markdown 语法支持，可导出 Markdown
- 分类筛选、标签筛选
- 全文搜索
- 数据导出（JSON / Markdown）
- 后台缓存刷新（一键清除主题 CSS 缓存）

## 版本历史

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.0 | 2026-07 | 初始发布：包含完整 CRUD 管理后台、释义/注释字段、标签支持、主题热切换、缓存刷新等功能 |
