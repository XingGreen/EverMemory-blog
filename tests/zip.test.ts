import { describe, expect, it } from "vitest";
import { createZip, readZip, readZipText, textBytes } from "@/utils/zip";

describe("zip", () => {
	it("往返读写小文件", () => {
		const entries = [
			{ path: "posts/a.md", data: textBytes("# 标题 A\n\n正文内容") },
			{ path: "posts/b.mdx", data: textBytes("export const x = 1;\n") },
		];
		const zipped = createZip(entries);
		const read = readZip(zipped);

		expect(read).toHaveLength(2);
		expect(read.map((e) => e.path).sort()).toEqual(["posts/a.md", "posts/b.mdx"]);
		const a = read.find((e) => e.path === "posts/a.md");
		expect(a && readZipText(a)).toBe("# 标题 A\n\n正文内容");
	});

	it("大文件走 deflate 且内容不变", () => {
		/* 重复内容能被 deflate 显著压缩，用来确认压缩路径没被跳过 */
		const big = "重复内容 repeated content ".repeat(500);
		const zipped = createZip([{ path: "big.txt", data: textBytes(big) }]);
		expect(zipped.length).toBeLessThan(textBytes(big).length);

		const read = readZip(zipped);
		expect(readZipText(read[0])).toBe(big);
	});

	it("二进制内容往返无损", () => {
		const bytes = new Uint8Array(256);
		for (let i = 0; i < 256; i++) bytes[i] = i;
		const read = readZip(createZip([{ path: "bin.dat", data: bytes }]));
		expect(Array.from(read[0].data)).toEqual(Array.from(bytes));
	});

	it("空文件列表产出合法空 zip", () => {
		const zipped = createZip([]);
		expect(readZip(zipped)).toHaveLength(0);
	});

	it("跳过以 / 结尾的目录条目", () => {
		const read = readZip(
			createZip([
				{ path: "dir/", data: new Uint8Array(0) },
				{ path: "dir/file.txt", data: textBytes("x") },
			]),
		);
		expect(read).toHaveLength(1);
		expect(read[0].path).toBe("dir/file.txt");
	});

	it("非 zip 数据抛错而不是静默返回空", () => {
		expect(() => readZip(textBytes("this is not a zip"))).toThrow(/不是有效的 zip/);
	});

	it("中文路径按 UTF-8 保存与还原", () => {
		const read = readZip(
			createZip([{ path: "资源/图片说明.md", data: textBytes("内容") }]),
		);
		expect(read[0].path).toBe("资源/图片说明.md");
	});
});
