/**
 * 半截话别乱用 - Cloudflare Workers
 * 收集中国传统文化中的半截话，还原其本意
 * 
 * 部署只需 2 个环境变量：
 *   1. AUTH_CODE — 后台密码（在 CF 控制台设置 Secret）
 *   2. KV 命名空间绑定 — 绑定名 BANJIEHUA_KV
 */

// ==================== 配置（硬编码常量）====================
const SITE_NAME = '半截话别乱用';
const SITE_DESCRIPTION = '收集中国传统文化中那些被曲解的半截话，还原其本意，传承文化精髓';
const KEYWORDS = '半截话,俗语,成语,诗句,传统文化,名言警句';
const PAGE_SIZE = 12;
const CACHE_TTL = 3600;
const CATEGORIES = ['诗句', '俗语', '成语', '方言', '其他'];

// ★ 主题 CSS 入口 — 指向 GitHub 上的 themes/style.css
//   切换主题：编辑 GitHub 仓库中 themes/style.css 的 @import 路径即可，无需改 index.js
//   如果 Fork 了自己的仓库，改下面这行 URL 即可
const STYLE_CSS_URL = 'https://raw.githubusercontent.com/thriken/banjiehua/master/themes/style.css';

// ==================== 简易模板引擎 ====================
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(template, data) {
  let result = template;
  const sectionRegex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;

  result = result.replace(sectionRegex, (match, key, content) => {
    const items = data[key];
    if (!items) return '';
    if (Array.isArray(items)) {
      return items.map(item => render(content, { ...data, ...item })).join('');
    }
    if (typeof items === 'object') {
      return render(content, { ...data, ...items });
    }
    if (items === true || items === 1) {
      return render(content, data);
    }
    return '';
  });

  result = result.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
    const val = data[key];
    if (!val || (Array.isArray(val) && val.length === 0)) {
      return content;
    }
    return '';
  });

  result = result.replace(/\{\{\{(\w+)\}\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : '';
  });

  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (data[key] !== undefined && data[key] !== null) {
      return escapeHtml(String(data[key]));
    }
    return '';
  });

  return result;
}

// ==================== Markdown 简易渲染 ====================
function parseMarkdown(text) {
  if (!text) return '';

  let html = escapeHtml(text);

  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^---$/gm, '<hr>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');
  html = html.replace(/^[*-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, (match) => {
    if (!match.includes('\n')) return match;
    return '<ul>' + match + '</ul>';
  });
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  const lines = html.split('\n');
  let inList = false;
  let inBlockquote = false;
  let inPre = false;
  const processed = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<pre')) { inPre = true; processed.push(line); continue; }
    if (line.startsWith('</pre>')) { inPre = false; processed.push(line); continue; }
    if (inPre) { processed.push(line); continue; }

    if (line.startsWith('<ul>') || line.startsWith('<ol>')) { inList = true; processed.push(line); continue; }
    if (line.startsWith('</ul>') || line.startsWith('</ol>')) { inList = false; processed.push(line); continue; }
    if (inList) { processed.push(line); continue; }

    if (line.startsWith('<blockquote>')) { inBlockquote = true; processed.push(line); continue; }
    if (line.startsWith('</blockquote>')) { inBlockquote = false; processed.push(line); continue; }
    if (inBlockquote) { processed.push(line); continue; }

    const trimmed = line.trim();
    if (!trimmed) { processed.push(''); continue; }
    if (/^<[a-z][\s\S]*>/i.test(trimmed)) { processed.push(line); continue; }

    processed.push('<p>' + trimmed + '</p>');
  }

  return processed.join('\n');
}

// ==================== KV 操作 ====================
async function getAllEntries(env) {
  const index = await env.BANJIEHUA_KV.get('_index', 'json');
  return index || [];
}

async function saveIndex(env, index) {
  await env.BANJIEHUA_KV.put('_index', JSON.stringify(index));
}

async function getEntry(env, id) {
  return await env.BANJIEHUA_KV.get('entry_' + id, 'json');
}

async function saveEntry(env, entry) {
  await env.BANJIEHUA_KV.put('entry_' + entry.id, JSON.stringify(entry));
}

async function deleteEntryFromKV(env, id) {
  await env.BANJIEHUA_KV.delete('entry_' + id);
}

async function getAllCategories(env) {
  return await env.BANJIEHUA_KV.get('_categories', 'json') || CATEGORIES;
}

async function saveCategories(env, cats) {
  await env.BANJIEHUA_KV.put('_categories', JSON.stringify(cats));
}

// ==================== 认证（HMAC token，不暴露原始 AUTH_CODE 到 Cookie） ====================
let _authTokenCache = null;

async function getAuthToken(authCode) {
  if (_authTokenCache) return _authTokenCache;
  const encoder = new TextEncoder();
  const data = encoder.encode('banjiehua_session_' + authCode);
  const hash = await crypto.subtle.digest('SHA-256', data);
  _authTokenCache = btoa(String.fromCharCode(...new Uint8Array(hash)));
  return _authTokenCache;
}

async function makeAuthCookie(authCode) {
  const token = await getAuthToken(authCode);
  return 'banjiehua_token=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400';
}

async function checkAuth(request, env) {
  const authCode = env.AUTH_CODE;
  if (!authCode) return false;

  const expectedToken = await getAuthToken(authCode);
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/banjiehua_token=([^;]+)/);
  if (match && match[1] === expectedToken) return true;

  const url = new URL(request.url);
  const code = url.searchParams.get('auth');
  if (code === authCode) return true;

  return false;
}

// ==================== HTML 模板 ====================
function getHomeTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{siteName}} - {{siteDescription}}</title>
<meta name="description" content="{{siteDescription}}">
<meta name="keywords" content="{{keywords}}">
<link rel="canonical" href="{{siteUrl}}">
<meta property="og:title" content="{{siteName}}">
<meta property="og:description" content="{{siteDescription}}">
<meta property="og:type" content="website">
<meta property="og:url" content="{{siteUrl}}">
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="site-title">半截话别乱用</a>
    <nav class="top-nav">
      <a href="/">首页</a>
      <a href="/admin/">后台</a>
    </nav>
  </div>
</div>

<div class="search-bar">
  <div class="search-bar-inner">
    <form class="search-form" action="/search" method="get">
      <input class="search-input" type="text" name="q" placeholder="搜索半截话、俗语、诗句..." value="{{query}}" autocomplete="off">
      <button class="search-btn" type="submit">搜索</button>
    </form>
  </div>
</div>

<div class="container">
  <div class="intro-card">
    <h2>📜 执古之道，以御今之有</h2>
    <p>中国传统文化博大精深，许多俗语、诗句流传至今，却因"断章取义"而失去了本来的意义。本站致力于收集那些被"说半截"的经典语句，还原其完整面貌，让传统智慧回归本源。</p>
    <p style="margin-top:8px;font-size:13px;color:var(--text-3);">共收录 <strong>{{totalCount}}</strong> 条记录</p>
  </div>

  <div class="cat-nav">
    <a href="/" class="{{^currentCat}}active{{/currentCat}}">全部</a>
    {{#categories}}
    <a href="/category/{{name}}" class="{{#active}}active{{/active}}">{{name}}</a>
    {{/categories}}
  </div>

  {{#entries}}
  <div class="entry-list">
    {{#entries}}
    <a href="/entry/{{id}}" style="text-decoration:none;color:inherit;">
      <article class="entry-card">
        <div class="entry-phrase">
          「{{phrase}}」
          <span class="entry-cat-tag">{{category}}</span>
        </div>
        <div class="entry-full">{{fullText}}</div>
        <div class="entry-source">{{source}}{{#author}} · {{author}}{{/author}}</div>
        {{#tags}}
        <div class="entry-tags">
          {{#tags}}
          <span class="tag">{{.}}</span>
          {{/tags}}
        </div>
        {{/tags}}
      </article>
    </a>
    {{/entries}}
  </div>
  {{/entries}}

  {{^entries}}
  <div class="empty-state">
    <div class="empty-icon">📭</div>
    <h3>暂无收录</h3>
    <p>{{#query}}未找到与"{{query}}"相关的内容，换个关键词试试吧{{/query}}{{^query}}还没有收录任何内容，快去后台添加吧{{/query}}</p>
  </div>
  {{/entries}}

  {{#hasPages}}
  <div class="pagination">
    {{#prevPage}}<a href="{{prevUrl}}">← 上一页</a>{{/prevPage}}
    {{^prevPage}}<span class="disabled">← 上一页</span>{{/prevPage}}
    <span class="current">第 {{page}} / {{totalPages}} 页</span>
    {{#nextPage}}<a href="{{nextUrl}}">下一页 →</a>{{/nextPage}}
    {{^nextPage}}<span class="disabled">下一页 →</span>{{/nextPage}}
  </div>
  {{/hasPages}}
</div>

<footer class="footer">
  <p>{{siteName}} © 2024 · 传承中华文化，还原经典本意</p>
  <p style="margin-top:4px;"><a href="/sitemap.xml" style="color:var(--text-3);">Sitemap</a></p>
</footer>
</body>
</html>`;
}

function getDetailTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{phrase}} - {{fullText}} | {{siteName}}</title>
<meta name="description" content="{{phrase}}：{{fullText}}. {{source}}">
<meta name="keywords" content="{{phrase}},{{fullText}},{{category}},{{tagsStr}}">
<link rel="canonical" href="{{siteUrl}}/entry/{{id}}">
<meta property="og:title" content="{{phrase}} - {{fullText}}">
<meta property="og:description" content="{{source}}">
<meta property="og:type" content="article">
<meta property="og:url" content="{{siteUrl}}/entry/{{id}}">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{{phrase}} - {{fullText}}",
  "description": "{{source}}",
  "author": { "@type": "Person", "name": "{{author}}" },
  "datePublished": "{{createdAt}}",
  "dateModified": "{{updatedAt}}"
}
</script>
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="site-title">半截话别乱用</a>
    <nav class="top-nav">
      <a href="/">首页</a>
      <a href="/admin/">后台</a>
    </nav>
  </div>
</div>

<div class="container">
  <article class="detail-card">
    <header class="detail-header">
      <h1 class="detail-phrase">「{{phrase}}」</h1>
      <p class="detail-full">{{fullText}}</p>
      <div class="detail-meta">
        <span>📂 {{category}}</span>
        <span>📖 {{source}}</span>
        {{#author}}<span>✍️ {{author}}</span>{{/author}}
        <span>📅 {{dateStr}}</span>
      </div>
    </header>

    <div class="detail-body">
      {{{contentHtml}}}
    </div>

    {{#notes}}
    <div style="margin-top:24px;padding:16px;background:rgba(212,168,83,0.08);border-radius:8px;border-left:3px solid var(--accent2);">
      <strong style="color:var(--accent);">💡 备注：</strong>
      <p style="margin-top:6px;color:var(--text-2);">{{notes}}</p>
    </div>
    {{/notes}}

    {{#hasCitations}}
    <div style="margin-top:24px;">
      <h3 style="color:var(--accent);font-size:16px;margin-bottom:12px;">📚 引用参考</h3>
      {{#citations}}
      <blockquote style="margin-bottom:8px;">
        <p>{{text}}</p>
        {{#source}}<footer style="font-size:12px;color:var(--text-3);margin-top:4px;">—— {{source}}</footer>{{/source}}
      </blockquote>
      {{/citations}}
    </div>
    {{/hasCitations}}

    {{#hasTags}}
    <div class="detail-tags">
      <span style="font-size:13px;color:var(--text-3);">🏷️ 标签：</span>
      {{#tags}}
      <a href="/tag/{{.}}" class="tag">{{.}}</a>
      {{/tags}}
    </div>
    {{/hasTags}}
  </article>

  <div style="text-align:center;">
    <a href="/" class="back-link">← 返回首页</a>
  </div>
</div>

<footer class="footer">
  <p>{{siteName}} © 2024 · 传承中华文化，还原经典本意</p>
</footer>
</body>
</html>`;
}

function getAdminListTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>后台管理 - {{siteName}}</title>
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="site-title">半截话别乱用</a>
    <nav class="top-nav">
      <a href="/">前台</a>
      <a href="/admin/" style="color:var(--accent2);">管理</a>
      <a href="/export">导出数据</a>
    </nav>
  </div>
</div>

<div class="container">
  <div class="admin-header">
    <h2>📋 内容管理</h2>
    <a href="/admin/new" class="btn btn-primary">+ 新增条目</a>
  </div>

  {{#message}}
  <div class="toast {{msgType}}" style="position:static;margin-bottom:16px;">{{message}}</div>
  {{/message}}

  {{#entries}}
  <table class="admin-table">
    <thead>
      <tr>
        <th>短语</th>
        <th>全句</th>
        <th>分类</th>
        <th>来源</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      {{#entries}}
      <tr>
        <td><strong>{{phrase}}</strong></td>
        <td>{{fullTextShort}}</td>
        <td>{{category}}</td>
        <td>{{source}}</td>
        <td class="actions">
          <a href="/admin/edit/{{id}}" class="btn btn-secondary btn-sm">编辑</a>
          <a href="/admin/delete/{{id}}" class="btn btn-danger btn-sm" onclick="return confirm('确定删除「{{phrase}}」吗？')">删除</a>
        </td>
      </tr>
      {{/entries}}
    </tbody>
  </table>
  {{/entries}}

  {{^entries}}
  <div class="empty-state">
    <div class="empty-icon">📭</div>
    <h3>还没有任何内容</h3>
    <p>点击右上角「新增条目」开始收录吧</p>
  </div>
  {{/entries}}
</div>

<footer class="footer">
  <p>{{siteName}} · 后台管理</p>
</footer>
</body>
</html>`;
}

function getAdminEditTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{#isEdit}}编辑条目{{/isEdit}}{{^isEdit}}新增条目{{/isEdit}} - {{siteName}}</title>
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="site-title">半截话别乱用</a>
    <nav class="top-nav">
      <a href="/">前台</a>
      <a href="/admin/">管理</a>
    </nav>
  </div>
</div>

<div class="container">
  <h2 style="font-family:var(--font-display);color:var(--accent);font-size:24px;letter-spacing:2px;margin-bottom:24px;">
    {{#isEdit}}✏️ 编辑条目{{/isEdit}}{{^isEdit}}➕ 新增条目{{/isEdit}}
  </h2>

  {{#message}}
  <div class="toast {{msgType}}" style="position:static;margin-bottom:16px;">{{message}}</div>
  {{/message}}

  <form class="admin-form" method="POST" action="/admin/save">
    {{#isEdit}}<input type="hidden" name="id" value="{{id}}">{{/isEdit}}

    <div class="form-group">
      <label>半截话 / 短语 *</label>
      <input type="text" name="phrase" value="{{phrase}}" placeholder="例如：以德报怨" required>
      <span class="hint">流传中被"断章取义"的短句</span>
    </div>

    <div class="form-group">
      <label>全句 / 全文 *</label>
      <textarea name="fullText" placeholder="例如：以德报怨，何以报德？以直报怨，以德报德。" required>{{fullText}}</textarea>
      <span class="hint">完整的原句，还原其本意</span>
    </div>

    <div class="form-group">
      <label>分类 *</label>
      <select name="category" required>
        <option value="">请选择分类</option>
        {{#categoryOptions}}
        <option value="{{name}}" {{#selected}}selected{{/selected}}>{{name}}</option>
        {{/categoryOptions}}
      </select>
    </div>

    <div class="form-group">
      <label>来源 / 出处</label>
      <input type="text" name="source" value="{{source}}" placeholder="例如：《论语·宪问》">
    </div>

    <div class="form-group">
      <label>作者 / 译者</label>
      <input type="text" name="author" value="{{author}}" placeholder="例如：孔子">
    </div>

    <div class="form-group">
      <label>标签（用逗号分隔）</label>
      <input type="text" name="tagsStr" value="{{tagsStr}}" placeholder="例如：论语, 儒家, 为人处世">
    </div>

    <div class="form-group">
      <label>备注</label>
      <textarea name="notes" placeholder="补充说明，支持 Markdown 格式">{{notes}}</textarea>
    </div>

    <div class="form-group">
      <label>引用参考 <span style="font-size:12px;color:var(--text-3);">（支持多行，每行一条引用）</span></label>
      <textarea name="citations" placeholder="引用文字 | 引用来源&#10;另一条引用 | 来源" style="min-height:80px;">{{citationsStr}}</textarea>
    </div>

    <div style="display:flex;gap:12px;margin-top:24px;">
      <button type="submit" class="btn btn-primary">💾 保存</button>
      <a href="/admin/" class="btn btn-secondary">取消</a>
    </div>
  </form>
</div>

<footer class="footer">
  <p>{{siteName}} · 后台管理</p>
</footer>
</body>
</html>`;
}

function getAdminLoginTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>后台登录 - {{siteName}}</title>
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="container">
  <div class="admin-login">
    <h2>🔐 后台管理</h2>
    <form method="POST" action="/admin/login">
      <input type="password" name="code" placeholder="请输入授权码" required autofocus>
      <button type="submit">登 录</button>
      {{#error}}
      <p class="error">{{error}}</p>
      {{/error}}
    </form>
    <p style="margin-top:16px;font-size:12px;color:var(--text-3);">
      <a href="/" style="color:var(--text-3);">← 返回首页</a>
    </p>
  </div>
</div>
</body>
</html>`;
}

function getExportTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>数据导出 - {{siteName}}</title>
<link rel="stylesheet" href="{{styleCssUrl}}">
</head>
<body>
<div class="top-bar">
  <div class="top-bar-inner">
    <a href="/" class="site-title">半截话别乱用</a>
    <nav class="top-nav">
      <a href="/">前台</a>
      <a href="/admin/">管理</a>
    </nav>
  </div>
</div>

<div class="container">
  <h2 style="font-family:var(--font-display);color:var(--accent);font-size:24px;letter-spacing:2px;margin-bottom:24px;">
    📦 数据导出
  </h2>
  <div class="detail-card" style="max-width:600px;">
    <p style="margin-bottom:16px;">共 <strong>{{totalCount}}</strong> 条记录</p>
    <div style="display:flex;gap:12px;flex-wrap:wrap;">
      <a href="/export?format=json" class="btn btn-primary">📄 导出 JSON</a>
      <a href="/export?format=md" class="btn btn-secondary">📝 导出 Markdown</a>
      <a href="/admin/" class="btn btn-secondary">← 返回管理</a>
    </div>
  </div>
</div>
</body>
</html>`;
}

// ==================== 辅助函数 ====================
function createSiteUrl(request) {
  const url = new URL(request.url);
  return url.origin;
}

function getPageData(request) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  return { page: Math.max(1, page), query: url.searchParams.get('q') || '' };
}

function buildPageUrl(url, page) {
  const newUrl = new URL(url);
  newUrl.searchParams.set('page', page);
  return newUrl.pathname + newUrl.search;
}

// ==================== 页面处理 ====================
async function handleHome(request, env) {
  const siteUrl = createSiteUrl(request);
  const { page } = getPageData(request);
  const url = new URL(request.url);
  const currentCat = url.pathname.startsWith('/category/') ? decodeURIComponent(url.pathname.split('/category/')[1]).replace(/\/$/, '') : '';
  const tagFilter = url.pathname.startsWith('/tag/') ? decodeURIComponent(url.pathname.split('/tag/')[1]).replace(/\/$/, '') : '';

  let entries = await getAllEntries(env);

  entries.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  if (currentCat) {
    entries = entries.filter(e => e.category === currentCat);
  }

  if (tagFilter) {
    entries = entries.filter(e => e.tags && e.tags.includes(tagFilter));
  }

  const { query } = getPageData(request);
  if (query) {
    const q = query.toLowerCase();
    entries = entries.filter(e =>
      (e.phrase && e.phrase.toLowerCase().includes(q)) ||
      (e.fullText && e.fullText.toLowerCase().includes(q)) ||
      (e.source && e.source.toLowerCase().includes(q)) ||
      (e.author && e.author.toLowerCase().includes(q)) ||
      (e.notes && e.notes.toLowerCase().includes(q))
    );
  }

  const totalCount = entries.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pagedEntries = entries.slice(start, start + PAGE_SIZE);

  const categories = CATEGORIES.map(cat => ({
    name: cat,
    active: cat === currentCat
  }));

  const template = getHomeTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    siteDescription: SITE_DESCRIPTION,
    keywords: KEYWORDS,
    siteUrl: siteUrl,
    query: query,
    totalCount: totalCount,
    entries: pagedEntries.map(e => ({
      ...e,
      tags: e.tags || [],
    })),
    categories: categories,
    currentCat: currentCat,
    page: currentPage,
    totalPages: totalPages,
    hasPages: totalPages > 1,
    prevPage: currentPage > 1,
    nextPage: currentPage < totalPages,
    prevUrl: buildPageUrl(url, currentPage - 1),
    nextUrl: buildPageUrl(url, currentPage + 1),
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=' + CACHE_TTL,
    },
  });
}

async function handleDetail(request, env, id) {
  const siteUrl = createSiteUrl(request);
  const entry = await getEntry(env, id);
  if (!entry) {
    return new Response('Not Found', { status: 404 });
  }

  const contentHtml = parseMarkdown(entry.notes || '');
  const citations = entry.citations || [];
  const tags = entry.tags || [];

  const template = getDetailTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    id: entry.id,
    phrase: entry.phrase,
    fullText: entry.fullText,
    category: entry.category,
    source: entry.source || '未知',
    author: entry.author || '',
    tags: tags,
    tagsStr: tags.join(', '),
    hasTags: tags.length > 0,
    notes: entry.notes || '',
    contentHtml: contentHtml,
    citations: citations,
    hasCitations: citations.length > 0,
    createdAt: entry.createdAt || '',
    updatedAt: entry.updatedAt || '',
    dateStr: (entry.createdAt || '').split('T')[0],
    siteUrl: siteUrl,
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=' + CACHE_TTL,
    },
  });
}

async function handleSearch(request, env) {
  return handleHome(request, env);
}

async function handleAdmin(request, env) {
  const siteUrl = createSiteUrl(request);
  const url = new URL(request.url);

  if (!(await checkAuth(request, env))) {
    return handleAdminLogin(request, env);
  }

  const entries = await getAllEntries(env);
  entries.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  const msg = url.searchParams.get('msg');
  let message = null;
  let msgType = 'success';
  if (msg === 'saved') message = '✅ 保存成功！';
  else if (msg === 'deleted') message = '🗑️ 已删除';
  else if (msg === 'error') { message = '❌ 操作失败'; msgType = 'error'; }

  const template = getAdminListTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    entries: entries.map(e => ({
      ...e,
      fullTextShort: e.fullText ? (e.fullText.length > 20 ? e.fullText.slice(0, 20) + '...' : e.fullText) : '',
    })),
    message: message,
    msgType: msgType,
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
    },
  });
}

async function handleAdminLogin(request, env) {
  const template = getAdminLoginTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    error: request.method === 'POST' ? '授权码错误，请重试' : '',
  });
  return new Response(html, {
    status: request.method === 'POST' ? 401 : 200,
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

async function handleAdminLoginPost(request, env) {
  const formData = await request.formData();
  const code = formData.get('code') || '';

  if (code === env.AUTH_CODE) {
    return new Response('', {
      status: 302,
      headers: {
        'Location': '/admin/',
        'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
      },
    });
  }

  return handleAdminLogin(request, env);
}

async function handleAdminNew(request, env) {
  if (!(await checkAuth(request, env))) {
    return handleAdminLogin(request, env);
  }

  const template = getAdminEditTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    isEdit: false,
    phrase: '',
    fullText: '',
    category: '',
    source: '',
    author: '',
    tagsStr: '',
    notes: '',
    citationsStr: '',
    categoryOptions: CATEGORIES.map(c => ({ name: c, selected: false })),
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
    },
  });
}

async function handleAdminEdit(request, env, id) {
  if (!(await checkAuth(request, env))) {
    return handleAdminLogin(request, env);
  }

  const entry = await getEntry(env, id);
  if (!entry) {
    return new Response('Not Found', { status: 404 });
  }

  const template = getAdminEditTemplate();
  const html = render(template, {
    styleCssUrl: STYLE_CSS_URL,
    siteName: SITE_NAME,
    isEdit: true,
    id: entry.id,
    phrase: entry.phrase,
    fullText: entry.fullText,
    category: entry.category,
    source: entry.source || '',
    author: entry.author || '',
    tagsStr: (entry.tags || []).join(', '),
    notes: entry.notes || '',
    citationsStr: (entry.citations || []).map(c => (c.text || '') + (c.source ? ' | ' + c.source : '')).join('\n'),
    categoryOptions: CATEGORIES.map(c => ({ name: c, selected: c === entry.category })),
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html;charset=UTF-8',
      'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
    },
  });
}

async function handleAdminSave(request, env) {
  if (!(await checkAuth(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const formData = await request.formData();
  const id = formData.get('id') || Date.now().toString();
  const isNew = !formData.get('id');

  const citationsStr = (formData.get('citations') || '').trim();
  const citations = citationsStr ? citationsStr.split('\n').filter(Boolean).map(line => {
    const parts = line.split('|');
    return {
      text: (parts[0] || '').trim(),
      source: (parts[1] || '').trim(),
    };
  }) : [];

  const tagsStr = (formData.get('tagsStr') || '').trim();
  const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];

  const entry = {
    id: id,
    phrase: (formData.get('phrase') || '').trim(),
    fullText: (formData.get('fullText') || '').trim(),
    category: (formData.get('category') || '').trim(),
    source: (formData.get('source') || '').trim(),
    author: (formData.get('author') || '').trim(),
    tags: tags,
    notes: (formData.get('notes') || '').trim(),
    citations: citations,
    createdAt: isNew ? new Date().toISOString() : (await getEntry(env, id))?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!entry.phrase || !entry.fullText || !entry.category) {
    const template = getAdminEditTemplate();
    const html = render(template, {
      styleCssUrl: STYLE_CSS_URL,
      siteName: SITE_NAME,
      isEdit: !isNew,
      id: entry.id,
      phrase: entry.phrase,
      fullText: entry.fullText,
      category: entry.category,
      source: entry.source,
      author: entry.author,
      tagsStr: tagsStr,
      notes: entry.notes || '',
      citationsStr: citationsStr,
      message: '❌ 请填写必填项（短语、全句、分类）',
      msgType: 'error',
      categoryOptions: CATEGORIES.map(c => ({ name: c, selected: c === entry.category })),
    });
    return new Response(html, {
      status: 400,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  await saveEntry(env, entry);

  if (isNew) {
    const index = await getAllEntries(env);
    index.push({ id: entry.id, phrase: entry.phrase, category: entry.category, createdAt: entry.createdAt });
    await saveIndex(env, index);
  }

  return new Response('', {
    status: 302,
    headers: {
      'Location': '/admin/?msg=saved',
      'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
    },
  });
}

async function handleAdminDelete(request, env, id) {
  if (!(await checkAuth(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  await deleteEntryFromKV(env, id);

  const index = await getAllEntries(env);
  const newIndex = index.filter(item => item.id !== id);
  await saveIndex(env, newIndex);

  return new Response('', {
    status: 302,
    headers: {
      'Location': '/admin/?msg=deleted',
      'Set-Cookie': await makeAuthCookie(env.AUTH_CODE),
    },
  });
}

async function handleSitemap(request, env) {
  const url = new URL(request.url);
  const siteUrl = url.origin;
  const entries = await getAllEntries(env);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url><loc>${siteUrl}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;

  for (const item of entries) {
    xml += `  <url><loc>${siteUrl}/entry/${item.id}</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>\n`;
  }

  xml += '</urlset>';

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml;charset=UTF-8',
      'Cache-Control': 'public, max-age=' + CACHE_TTL,
    },
  });
}

async function handleRobots(request) {
  const url = new URL(request.url);
  const siteUrl = url.origin;
  const content = `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`;
  return new Response(content, {
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
}

async function handleExport(request, env) {
  if (!(await checkAuth(request, env))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'html';
  const entries = await getAllEntries(env);

  if (format === 'html') {
    const template = getExportTemplate();
    const html = render(template, {
      styleCssUrl: STYLE_CSS_URL,
      siteName: SITE_NAME,
      totalCount: entries.length,
    });
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  if (format === 'json') {
    const fullEntries = [];
    for (const item of entries) {
      const entry = await getEntry(env, item.id);
      if (entry) fullEntries.push(entry);
    }
    const json = JSON.stringify(fullEntries, null, 2);
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Content-Disposition': 'attachment; filename="banjiehua-export.json"',
      },
    });
  }

  if (format === 'md') {
    let md = '# 半截话别乱用 - 数据导出\n\n';
    md += `导出时间：${new Date().toISOString()}\n\n---\n\n`;

    for (const item of entries) {
      const entry = await getEntry(env, item.id);
      if (!entry) continue;

      md += `## ${entry.phrase}\n\n`;
      md += `**全句：** ${entry.fullText}\n\n`;
      if (entry.source) md += `**出处：** ${entry.source}\n\n`;
      if (entry.author) md += `**作者：** ${entry.author}\n\n`;
      md += `**分类：** ${entry.category}\n\n`;
      if (entry.tags && entry.tags.length) {
        md += `**标签：** ${entry.tags.join('、')}\n\n`;
      }
      if (entry.notes) {
        md += `### 备注\n\n${entry.notes}\n\n`;
      }
      if (entry.citations && entry.citations.length) {
        md += `### 引用参考\n\n`;
        entry.citations.forEach(c => {
          md += `> ${c.text}\n`;
          if (c.source) md += `> —— ${c.source}\n`;
          md += '\n';
        });
      }
      md += '---\n\n';
    }

    return new Response(md, {
      headers: {
        'Content-Type': 'text/markdown;charset=UTF-8',
        'Content-Disposition': 'attachment; filename="banjiehua-export.md"',
      },
    });
  }

  return new Response('Invalid format', { status: 400 });
}

async function handleApiSearch(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').toLowerCase();

  if (!q || q.length < 1) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const entries = await getAllEntries(env);
  const results = entries.filter(item =>
    (item.phrase && item.phrase.toLowerCase().includes(q)) ||
    (item.fullText && item.fullText.toLowerCase().includes(q))
  ).slice(0, 10);

  return new Response(JSON.stringify(results), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ==================== 主入口 ====================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // CORS 预检
      if (request.method === 'OPTIONS') {
        return new Response('', {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        });
      }

      // 路由分发
      if (pathname === '/' || pathname.startsWith('/page/') || pathname.startsWith('/category/') || pathname.startsWith('/tag/')) {
        return await handleHome(request, env);
      }

      if (pathname.startsWith('/entry/')) {
        const id = pathname.split('/entry/')[1].replace(/\/$/, '');
        return await handleDetail(request, env, id);
      }

      if (pathname.startsWith('/search')) {
        return await handleSearch(request, env);
      }

      if (pathname === '/sitemap.xml') {
        return await handleSitemap(request, env);
      }

      if (pathname === '/robots.txt') {
        return await handleRobots(request);
      }

      // 后台路由
      if (pathname === '/admin/' || pathname === '/admin') {
        if (request.method === 'POST') {
          return await handleAdminLoginPost(request, env);
        }
        return await handleAdmin(request, env);
      }

      if (pathname === '/admin/login') {
        if (request.method === 'POST') {
          return await handleAdminLoginPost(request, env);
        }
        return await handleAdminLogin(request, env);
      }

      if (pathname === '/admin/new') {
        return await handleAdminNew(request, env);
      }

      if (pathname.startsWith('/admin/edit/')) {
        const id = pathname.split('/admin/edit/')[1].replace(/\/$/, '');
        return await handleAdminEdit(request, env, id);
      }

      if (pathname === '/admin/save') {
        return await handleAdminSave(request, env);
      }

      if (pathname.startsWith('/admin/delete/')) {
        const id = pathname.split('/admin/delete/')[1].replace(/\/$/, '');
        return await handleAdminDelete(request, env, id);
      }

      if (pathname === '/export' || pathname.startsWith('/export')) {
        return await handleExport(request, env);
      }

      if (pathname === '/api/search') {
        return await handleApiSearch(request, env);
      }

      // 404
      const notFoundHtml = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>404 - ${SITE_NAME}</title><style>body{font-family:serif;text-align:center;padding:80px 20px;background:#F5F0E8;color:#3C3428}h1{font-size:48px;color:#B33A2A;margin-bottom:16px}p{color:#6B5E4F}a{color:#B33A2A}</style></head><body><h1>404</h1><p>页面未找到</p><p><a href="/">返回首页</a></p></body></html>`;

      return new Response(notFoundHtml, {
        status: 404,
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });

    } catch (err) {
      console.error('Error:', err);
      return new Response('Internal Server Error: ' + err.message, {
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      });
    }
  },
};
