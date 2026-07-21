# 项目检查规则（AI 执行版）

> 本规则用于指导 AI 在修改 Astro 项目后，进行快速、无构建的健康检查。
> 目标：在不运行 `astro build` 的前提下，验证代码类型安全和语法正确性。

---

## 1. 核心检查命令

每次修改代码后，AI 必须按以下顺序执行检查：

### 1.1 检查 Astro 组件类型
```bash
npx astro check
```
- **作用**：检查所有 `.astro` 文件的 frontmatter 类型、模板变量引用、Props 传递。
- **特点**：不生成任何构建产物，只输出诊断信息。
- **通过标准**：命令退出码为 `0`，且无 `error` 级别诊断。

### 1.2 检查 TypeScript 文件类型
```bash
npx tsc --noEmit
```
- **作用**：检查所有 `.ts` / `.tsx` 文件的类型安全。
- **特点**：只进行类型检查，不输出 `.js` 文件。
- **注意**：如果 `.ts` 文件导入了 `.astro` 组件，可能会报错。此时以 `astro check` 结果为准，或确保项目已配置 `@astrojs/ts-plugin`。

### 1.3 组合快捷命令（推荐）
在 `package.json` 中预配置：
```json
{
  "scripts": {
    "check": "astro check && tsc --noEmit"
  }
}
```
AI 可直接执行：
```bash
npm run check
```

---

## 2. 何时执行检查

AI 在以下场景必须执行检查：

| 场景 | 检查范围 |
|------|----------|
| 修改 `.astro` 文件 | `astro check` |
| 修改 `.ts` / `.tsx` 文件 | `tsc --noEmit`（或组合命令） |
| 修改 `tsconfig.json` | 组合命令 |
| 修改组件 Props 接口 | 组合命令 |
| 重构、重命名、删除文件 | 组合命令 |
| 安装/更新依赖后 | 组合命令 |

---

## 3. 检查结果处理

### 3.1 检查通过
- 继续下一步操作（如提交代码、回答用户）。
- 无需额外说明，除非用户要求。

### 3.2 检查报错
AI 必须：
1. **停止当前操作**，不继续生成或修改代码。
2. **向用户报告错误摘要**，包括：
   - 错误文件路径
   - 错误类型（类型不匹配 / 未定义变量 / 导入错误等）
   - 建议修复方向
3. **等待用户确认**后再继续修改，或主动提供修复方案。

### 3.3 常见错误及修复方向

| 错误类型 | 典型表现 | 修复方向 |
|----------|----------|----------|
| 类型不匹配 | `Type 'X' is not assignable to type 'Y'` | 检查接口定义、Props 传递、泛型参数 |
| 未定义变量 | `Cannot find name 'X'` | 检查拼写、导入语句、作用域 |
| 导入路径错误 | `Cannot find module 'X'` | 检查路径大小写、文件是否存在、别名配置 |
| Astro 特有语法错误 | `Expected "}" but found "X"` | 检查模板语法、表达式括号匹配 |

---

## 4. 边界情况处理

### 4.1 项目无 TypeScript
如果项目没有 `tsconfig.json`，跳过 `tsc --noEmit`，仅执行 `astro check`。

### 4.2 使用了 Svelte / Vue 组件
如果项目中包含 `.svelte` 或 `.vue` 文件，补充检查：
```bash
npx svelte-check --tsconfig ./tsconfig.json
```
并在 `package.json` 中更新脚本：
```json
{
  "scripts": {
    "check": "astro check && tsc --noEmit && svelte-check --tsconfig ./tsconfig.json"
  }
}
```

### 4.3 大型项目检查过慢
如果 `astro check` 执行时间过长（>30 秒），可以：
- 仅检查修改过的文件（如支持 `--file` 参数时）。
- 先执行 `astro check` 确认无 Astro 层面错误，再视情况执行 `tsc --noEmit`。

---

## 5. 禁止行为

AI 在检查过程中**禁止**以下行为：

- ❌ 使用 `astro build` 代替 `astro check` 进行诊断
- ❌ 在检查报错时继续修改其他文件（忽略错误）
- ❌ 在检查未通过时向用户声称"代码已验证无误"
- ❌ 修改 `tsconfig.json` 的 `noEmit` 设置来绕过检查
- ❌ 跳过检查直接提交或结束任务

---

## 6. 与用户交互规范

### 6.1 检查前
- 如用户未明确要求检查，AI 应在关键修改后主动提出："是否需要我运行类型检查确认代码安全？"

### 6.2 检查中
- 显示执行的具体命令，让用户了解正在发生什么。
- 如检查耗时较长，可提示："正在运行类型检查，请稍候..."

### 6.3 检查后
- 简明汇报结果："类型检查通过，未发现错误。" 或 "发现 X 个错误，涉及以下文件..."
- 提供错误日志的关键片段，避免一次性输出全部原始日志。

---

## 7. 配置示例

### 7.1 最小化 `package.json` 脚本
```json
{
  "name": "my-astro-project",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "check": "astro check && tsc --noEmit"
  },
  "dependencies": {
    "astro": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 7.2 `tsconfig.json` 关键配置
```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "strict": true,
    "noEmit": true,
    "plugins": [
      { "name": "@astrojs/ts-plugin" }
    ]
  }
}
```

---

## 8. 规则更新

- 如 Astro 或 TypeScript 版本升级导致命令变化，应及时更新本规则。
- 如项目引入新的框架（如 Vue、Svelte），应在第 4 节补充对应的检查命令。

---

*规则版本：v1.0*
*适用项目：Astro + TypeScript 项目*
*核心原则：无构建、快速反馈、错误必停*