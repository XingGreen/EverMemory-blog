---
title: "demo"
published: 2026-08-02
image: "https://t.alcy.cc/pc"
tags: ["demo"]
category: "demo"
author: "demo"
draft: false
pinned: false
comment: false
password: "123"
passwordHint: "123"
---

# Markdown 语法测试文章

本文档旨在全面展示 Markdown 的常用语法，涵盖标题、文本格式、列表、链接、图片、代码、表格、引用、转义字符等核心元素，方便您进行渲染测试。

---

## 1. 标题（Headings）

Markdown 支持 6 级标题，使用 `#` 符号表示：

# H1 一级标题
## H2 二级标题
### H3 三级标题
#### H4 四级标题
##### H5 五级标题
###### H6 六级标题

---

## 2. 文本格式（Text Formatting）

- **粗体**：使用 `**粗体**` 或 `__粗体__`
- *斜体*：使用 `*斜体*` 或 `_斜体_`
- ***粗斜体***：使用 `***粗斜体***`
- ~~删除线~~：使用 `~~删除线~~`
- <u>下划线</u>：使用 HTML 标签 `<u>`
- `行内代码`：使用反引号 `` `代码` ``

---

## 3. 段落与换行

这是第一段。
这是第二段（中间空行）。

这是第三段，末尾加两个空格  
实现软换行。

---

## 4. 列表（Lists）

### 无序列表（Unordered List）
- 项目 1
- 项目 2
  - 子项目 2.1
  - 子项目 2.2
- 项目 3

### 有序列表（Ordered List）
1. 第一步
2. 第二步
   1. 子步骤 2.1
   2. 子步骤 2.2
3. 第三步

### 任务列表（Task List）
- [x] 已完成任务
- [ ] 未完成任务
- [ ] 待办事项

---

## 5. 链接（Links）

- [百度](https://www.baidu.com)
- [带标题的链接](https://www.example.com "示例网站")
- 自动链接：<https://www.github.com>
- 引用式链接：[Google][1]

[1]: https://www.google.com

---

## 6. 图片（Images）

![示例图片](https://picsum.photos/200/150 "随机图片")

---

## 7. 代码块（Code Blocks）

### 行内代码
使用 `console.log('Hello World')` 输出日志。

### 围栏代码块（Fenced Code Block）
```javascript
// JavaScript 示例
function greet(name) {
  return `Hello, ${name}!`;
}
console.log(greet('Markdown'));
```

```python
# Python 示例
def greet(name):
    return f"Hello, {name}!"
print(greet("Markdown"))
```

```bash
# Shell 命令
echo "测试代码块"
ls -la
```

---

## 8. 表格（Tables）

| 左对齐 | 居中对齐 | 右对齐 |
|:-------|:--------:|-------:|
| 苹果   | 红色     | 5.00   |
| 香蕉   | 黄色     | 3.50   |
| 葡萄   | 紫色     | 8.20   |

---

## 9. 引用（Blockquotes）

> 这是一级引用。
> > 这是二级引用（嵌套）。
> > > 这是三级引用。
>
> 引用可以包含 **粗体** 或 *斜体*。

---

## 10. 分隔线（Horizontal Rules）

使用三个或更多 `---`、`***` 或 `___`：

---

***

___

---

## 11. 转义字符（Escaping Characters）

使用反斜杠 `\` 转义特殊字符：
\* 星号 \` 反引号 \_ 下划线 \{ \} 大括号 \[ \] 中括号 \( \) 小括号 \# 井号 \+ 加号 \- 减号 \. 点号 \! 感叹号

---

## 12. HTML 标签支持（部分）

Markdown 允许内联 HTML：
<span style="color: red;">红色文字</span>
<br>
<kbd>Ctrl</kbd> + <kbd>C</kbd> 复制
<details>
<summary>点击展开详情</summary>
这里是折叠内容。
</details>

---

## 13. 脚注（Footnotes）[^1]

[^1]: 这是一个脚注示例。

脚注可以放在文末[^2]。
[^2]: 另一个脚注。

---

## 14. 定义列表（Definition Lists）

*[HTML]: HyperText Markup Language
*[CSS]: Cascading Style Sheets

---

## 15. 特殊字符与表情

- 版权：&copy; 2026
- 商标：&trade; &reg;
- 表情（GFM 支持）：:smile: :rocket: :+1:

---

## 16. 嵌套混合示例

> ### 引用中的标题
> - 引用中的列表项
> - 包含 `代码` 和 **粗体**
>
> ```
> 引用中的代码块
> ```

---

## 17. 长文本与折行

这是一个很长的段落，用来测试文本在浏览器中的自动换行效果。Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.

---

**测试结束。** 以上内容覆盖了 Markdown 绝大多数常用语法，可用于验证渲染器的兼容性与样式表现。