---
title: software-tag-design
published: 2026-07-12
description: ''
image: ''
tags: []
category: ''
draft: false 
lang: ''
author: 'Firefly'
---
# 软件推荐页标签分类设计文档

## 1. 设计目标

- 用户能快速筛选目标软件
- 内容作者添加软件时标签填写简单
- 新标签可扩展，不破坏现有结构
- 深浅模式视觉一致
- 支持多语言切换

---

## 2. 标签分层

| 层级 | 含义 | 选择方式 | 显示位置 |
|------|------|---------|---------|
| **平台** | 软件运行在什么系统 | 单选 | 筛选栏第一行 |
| **分类** | 软件用来做什么 | 多选 | 筛选栏第二行 |
| **特性** | 额外属性，可叠加 | 开关/标签 | 筛选栏第三行或卡片上 |

---

## 3. 标签清单

### 3.1 平台（Platform）

| 标签值 | 显示名 | 说明 |
|--------|--------|------|
| `all` | 全部 | 默认选中，显示所有 |
| `android` | Android | 安卓应用 |
| `web` | Web | 网页/在线工具 |
| `pc` | PC | Windows / Linux / macOS |
| `ios` | iOS | 苹果应用 |

### 3.2 分类（Category）

| 标签值 | 显示名 | 说明 |
|--------|--------|------|
| `ai` | AI | 人工智能工具 |
| `image` | Image | 图像处理/查看 |
| `music` | music | 音乐相关 |
| `download` | 下载工具 | 下载器 |
| `office` | 办公/效率 | 生产力工具 |
| `launcher` | 桌面启动器 | 启动器类 |
| `system` | 系统工具 | 系统优化/信息 |
| `network` | 网络工具 | 网络/代理/加速 |

### 3.3 特性（Feature）

| 标签值 | 显示名 | 说明 |
|--------|--------|------|
| `local` | Local | 本地运行，无需联网 |
| `md3` | MD3 | Material Design 3 风格 |
| `opensource` | 开源 | 开源软件 |

---

## 4. 数据格式

### 4.1 软件条目

```typescript
{
  name: string;           // 显示名称
  description?: string;   // 简介描述
  icon?: string;          // 图标路径（支持图标库名称或HTTPS链接）
  platform?: string[];    // 平台标签，至少一个
  tags?: string[];        // 分类和特性标签，混合使用
  visitUrl?: string;      // 官网链接，软件官方主页
  siteUrl?: string;       // 网站链接，下载页面或第三方资源站
  sourceCode?: string;    // 仓库链接，GitHub/GitLab等源码地址
  rating?: number;        // 评分，1-5星
  price?: string;         // 价格描述，如"免费"、"免费/付费"
}
```

### 4.2 链接字段说明

| 字段 | 用途 | 示例 |
|------|------|------|
| `visitUrl` | 软件官方网站主页 | https://gopeed.com |
| `siteUrl` | 下载页面或第三方资源站 | https://apkcombo.com |
| `sourceCode` | 源码仓库地址 | https://github.com/GopeedLab/gopeed |

### 4.3 示例

```typescript
{
  name: 'Gopeed',
  description: '带扩展/脚本功能的下载器',
  icon: 'https://gopeed.com/favicon.ico',
  platform: ['Android'],
  tags: ['下载工具', '开源'],
  visitUrl: 'https://gopeed.com',
  sourceCode: 'https://github.com/GopeedLab/gopeed',
  rating: 5,
  price: '免费',
}
```

---

## 5. 标签分类逻辑

### 5.1 标签来源

标签数据来源于两个维度：
1. **平台标签**：存储在 `platform` 字段，用于平台筛选
2. **混合标签**：存储在 `tags` 字段，包含分类和特性标签

### 5.2 标签提取规则

系统自动从软件数据中提取所有标签，构建筛选器：

```typescript
// 提取所有平台标签
const platformTags = [...new Set(software.flatMap(s => s.platform || []))];

// 提取所有分类和特性标签
const allTags = [...new Set(software.flatMap(s => s.tags || []))];
```

### 5.3 标签显示顺序

筛选栏标签按以下顺序排列：
1. **平台筛选**：固定顺序（全部 > Android > Web > PC > iOS）
2. **分类/特性筛选**：按首次出现顺序排列，或按预设优先级排序

---

## 6. 筛选逻辑

### 6.1 平台筛选（单选）

- 选中 `all` → 显示全部
- 选中 `android` → 只显示 `platform` 包含 `android` 的软件

### 6.2 分类筛选（多选）

- 未选 → 显示全部
- 选中多个 → 显示满足**任一**分类的软件（OR 逻辑）

### 6.3 特性筛选（多选）

- 未选 → 显示全部
- 选中多个 → 显示满足**任一**特性的软件（OR 逻辑）

### 6.4 组合筛选

平台 AND (分类 OR 分类) AND (特性 OR 特性)

### 6.5 搜索筛选

搜索词匹配以下字段：
- 软件名称（`name`）
- 软件描述（`description`）
- 标签（`tags`）

搜索与其他筛选条件使用 AND 逻辑组合。

---

## 7. 链接按钮显示规则

根据软件条目中的链接字段，动态显示对应按钮：

| visitUrl | siteUrl | sourceCode | 显示按钮 |
|----------|---------|------------|---------|
| 有 | 有 | 有 | 访问网站 / 下载页面 / GitHub |
| 有 | 有 | 无 | 访问网站 / 下载页面 |
| 有 | 无 | 有 | 访问网站 / GitHub |
| 无 | 有 | 有 | 下载页面 / GitHub |
| 有 | 无 | 无 | 访问网站 |
| 无 | 有 | 无 | 下载页面 |
| 无 | 无 | 有 | GitHub |
| 无 | 无 | 无 | 暂无链接 |

---

## 8. 新标签扩展流程

```
1. 发现需要新标签
   ↓
2. 判断属于哪一层（平台/分类/特性）
   ↓
3. 在数据文件中给相关软件添加新标签
   ↓
4. 系统自动提取新标签并更新筛选器
   ↓
5. 完成，无需改组件代码
```

---

## 9. 国际化支持

所有用户可见文本均使用 i18n 国际化键：

| 国际化键 | 中文 | 英文 |
|----------|------|------|
| `softwareVisitSite` | 访问网站 | Visit Website |
| `softwareDownloadPage` | 下载页面 | Download Page |
| `softwareSourceCode` | GitHub | GitHub |
| `softwareNoLink` | 暂无链接 | No Link |

---

## 10. 注意事项

1. **平台单选**：同一软件可多平台，但用户筛选时只能选一个平台
2. **分类多选**：允许跨分类筛选，如同时看"下载工具"和"系统工具"
3. **特性可选**：不是所有软件都有特性标签
4. **链接灵活**：三种链接字段均为可选，根据实际情况填写
5. **图标支持**：支持图标库名称（如 `simple-icons:visualstudiocode`）和 HTTPS 图片链接
