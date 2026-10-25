import { describe, expect, it } from "vitest";

import { normalizeName, rewriteFrontmatter } from "@/utils/taxonomy";

const BASE = `---
title: "测试文章"
category: 技术
tags: [React, TypeScript, 前端]
---

正文内容，不该被改动。
`;

describe("rewriteFrontmatter / category", () => {
	it("重命名分类", () => {
		const out = rewriteFrontmatter(BASE, "category", "技术", "工程");
		expect(out).not.toBeNull();
		expect(out).toContain("category: 工程");
		expect(out).not.toContain("category: 技术");
		// 正文保持原样
		expect(out).toContain("正文内容，不该被改动。");
	});

	it("分类不匹配时返回 null", () => {
		expect(rewriteFrontmatter(BASE, "category", "不存在", "新名")).toBeNull();
	});

	it("删除分类（置空）", () => {
		const out = rewriteFrontmatter(BASE, "category", "技术", null);
		expect(out).not.toBeNull();
		expect(out).toContain('category: ""');
		expect(out).not.toContain("技术");
	});

	it("带引号的分类名可正确识别与替换", () => {
		const src = `---
title: x
category: "前端 开发"
---

body
`;
		const out = rewriteFrontmatter(src, "category", "前端 开发", "Web");
		expect(out).toContain("category: Web");
	});

	it("含特殊字符的新名称会被加引号", () => {
		const out = rewriteFrontmatter(BASE, "category", "技术", "a: b");
		expect(out).toContain('category: "a: b"');
	});
});

describe("rewriteFrontmatter / tag", () => {
	it("重命名标签", () => {
		const out = rewriteFrontmatter(BASE, "tag", "React", "ReactJS");
		expect(out).not.toBeNull();
		expect(out).toContain("ReactJS");
		expect(out).not.toContain("[React,");
		// 其它标签保留
		expect(out).toContain("TypeScript");
		expect(out).toContain("前端");
	});

	it("删除标签", () => {
		const out = rewriteFrontmatter(BASE, "tag", "TypeScript", null);
		expect(out).not.toBeNull();
		expect(out).not.toContain("TypeScript");
		expect(out).toContain("React");
		expect(out).toContain("前端");
	});

	it("标签不存在时返回 null", () => {
		expect(rewriteFrontmatter(BASE, "tag", "Vue", "Vue3")).toBeNull();
	});

	it("删除唯一标签后留下空数组", () => {
		const src = `---
title: x
tags: [Solo]
---

body
`;
		const out = rewriteFrontmatter(src, "tag", "Solo", null);
		expect(out).toContain("tags: []");
	});

	it("重命名后产生重复标签时去重", () => {
		const src = `---
title: x
tags: [A, B]
---

body
`;
		const out = rewriteFrontmatter(src, "tag", "A", "B");
		expect(out).toContain("tags: [B]");
	});

	it("没有 frontmatter 时返回 null", () => {
		expect(rewriteFrontmatter("纯正文", "tag", "A", "B")).toBeNull();
	});
});

describe("normalizeName", () => {
	it("去首尾空白", () => {
		expect(normalizeName("  技术  ")).toBe("技术");
	});

	it("拒绝空串与纯空白", () => {
		expect(normalizeName("")).toBeNull();
		expect(normalizeName("   ")).toBeNull();
	});

	it("拒绝非字符串", () => {
		expect(normalizeName(123)).toBeNull();
		expect(normalizeName(null)).toBeNull();
	});

	it("拒绝含换行的名称（会破坏 frontmatter）", () => {
		expect(normalizeName("a\nb")).toBeNull();
	});
});
