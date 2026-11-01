/**
 * Git blob 哈希：与 GitHub Contents API 返回的 sha 字段同源，可直接相等比较。
 *
 * 算法是 Git 对象头的标准格式：
 *   sha1( "blob " + <字节数> + "\0" + <内容> )
 * 注意分隔符是 NUL 而不是冒号，写错一位结果就对不上。
 *
 * 刻意不做换行符转换：仓库 .gitattributes 声明 `* text=auto eol=lf`，
 * 工作区文件已经是 LF，Git 存的也是 LF，按原始字节算才等于远端的 sha。
 * 如果先做 \r\n → \n 的归一化，反而会把本来一致的文件算成不同。
 * 本地检测到 CRLF 属于「工作区与 .gitattributes 不一致」，应当告警而不是偷偷修正。
 */
import { createHash } from "node:crypto";

export function gitBlobSha(content: Buffer | string): string {
	const buf = Buffer.isBuffer(content)
		? content
		: Buffer.from(content, "utf-8");
	return createHash("sha1")
		.update(`blob ${buf.length}\u0000`, "utf-8")
		.update(buf)
		.digest("hex");
}

/** 工作区里是否混入了 CRLF —— 仅用于诊断提示，不参与哈希计算 */
export function hasCrlf(content: Buffer): boolean {
	return content.includes(0x0d);
}
