# 说明

## 项目名称:半截话别乱用

## 项目介绍
    半截话别乱用，我们中国从古代传下来很多俗语、短语、诗句或者有错字句子，说半截和说全了意思大相径庭，我想用这个项目来收集这些半截话，并补充全句资料，让大家了解他的本意，并提供一个搜索引擎，方便大家查找。
    同时也算是对传统文化的传承和保护，让更多的人了解和学习。

## 项目结构

### 技术栈
    cloudflare KV & works   免费且可用性高
    javascript
    兼容markdown
    可数据导出
### 项目架构
    前端: 
    后端: 
    数据库: cloudflare KV
    部署: cloudflare workers
### 功能
 1. 简易后台，需要一个授权码来鉴权，可以将码写在works的环境变量中。
 2. 关键数据：短语/短句/诗句，全句/全诗/全文，来源/出处/出典，作者/译者/译文，标签或者分类[诗句，俗语，成语，方言，其他]，备注,引用[支持多行数据]
 3. 索引SEO，方便搜索引擎收录
 4. 前台风格国风，响应式，支持移动端
 5. 支持markdown语法，支持图片，可导出md

 ### 文件结构
 暂时在d:\OSPanel\home\cloudflare-workers-blog\中，主要是为了借鉴cloudflare-workers-blog的实现。
 仓库地址：https://github.com/thriken/banjiehua
 ├── index.js       -- worker入口文件
 ├── readme.md      -- 说明文档
 ├── themes         -- 主题文件夹
     ├── style.css  -- 主题入口文件，只设定最简单的样式，然后引入其他css文件来改变风格主题
     ├── default    -- 默认主题
     └── new        -- 新主题
