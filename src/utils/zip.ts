/**
 * 最小 ZIP 打包 / 解包（store + deflate），供「导出为压缩包」使用。
 *
 * 为什么不用 jszip：项目已有 pako（deflate 实现），而 zip 的容器格式本身很简单
 * ——本地文件头 + 数据 + 中央目录 + 目录结束记录。自己写一个 200 行的读写器，
 * 比新增一个几十 KB 的依赖更划算，也不必为一个功能扩大打包体积。
 *
 * 支持范围（刻意收窄，够用即可）：
 *   · 打包：deflate 压缩，文件名 UTF-8
 *   · 解包：store(0) 与 deflate(8) 两种方法（第三方 zip 常见组合）
 * 不支持：分卷、加密、ZIP64（>4GB）、目录条目（以 / 结尾的项会被跳过）。
 */
import pako from "pako";

export type ZipEntry = {
	/** 包内路径，正斜杠分隔，例如 "posts/foo.md" */
	path: string;
	/** 文件内容 */
	data: Uint8Array;
};

/** CRC-32 查表，首次使用时构建 */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
	if (crcTable) return crcTable;
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	crcTable = table;
	return table;
}

function crc32(data: Uint8Array): number {
	const table = getCrcTable();
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/** 把日期拆成 DOS 时间格式（zip 本地头要求的 2 字节时间 + 2 字节日期） */
function dosDateTime(date: Date): { time: number; date: number } {
	const year = Math.max(1980, date.getFullYear());
	const time =
		(date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
	const dateVal = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { time, date: dateVal };
}

/** 小端写入器：按需扩容，避免反复拼接 Uint8Array */
class ByteWriter {
	private buf: Uint8Array;
	private len = 0;

	constructor(initial = 64 * 1024) {
		this.buf = new Uint8Array(initial);
	}

	private ensure(extra: number) {
		if (this.len + extra <= this.buf.length) return;
		let next = this.buf.length * 2;
		while (next < this.len + extra) next *= 2;
		const grown = new Uint8Array(next);
		grown.set(this.buf.subarray(0, this.len));
		this.buf = grown;
	}

	u16(value: number) {
		this.ensure(2);
		this.buf[this.len++] = value & 0xff;
		this.buf[this.len++] = (value >>> 8) & 0xff;
	}

	u32(value: number) {
		this.ensure(4);
		this.buf[this.len++] = value & 0xff;
		this.buf[this.len++] = (value >>> 8) & 0xff;
		this.buf[this.len++] = (value >>> 16) & 0xff;
		this.buf[this.len++] = (value >>> 24) & 0xff;
	}

	bytes(data: Uint8Array) {
		this.ensure(data.length);
		this.buf.set(data, this.len);
		this.len += data.length;
	}

	/** 回填已经写过的位置（用于本地头里先占位、后填 crc/大小） */
	patchU32(offset: number, value: number) {
		this.buf[offset] = value & 0xff;
		this.buf[offset + 1] = (value >>> 8) & 0xff;
		this.buf[offset + 2] = (value >>> 16) & 0xff;
		this.buf[offset + 3] = (value >>> 24) & 0xff;
	}

	get length() {
		return this.len;
	}

	toUint8Array(): Uint8Array {
		return this.buf.subarray(0, this.len);
	}
}

/**
 * 生成 zip。
 * @param entries 文件列表，path 用正斜杠
 * @param compress true=deflate，false=store（图片等已压缩内容建议 store）
 */
export function createZip(entries: ZipEntry[], compress = true): Uint8Array {
	const { time, date } = dosDateTime(new Date());
	const out = new ByteWriter();

	type Central = {
		pathBytes: Uint8Array;
		crc: number;
		compSize: number;
		rawSize: number;
		method: number;
		offset: number;
	};
	const central: Central[] = [];

	for (const entry of entries) {
		/* 目录条目以 / 结尾，这里不需要（文件路径自带目录语义） */
		if (entry.path.endsWith("/")) continue;

		const pathBytes = new TextEncoder().encode(entry.path);
		const raw = entry.data;
		/* 小于 64 字节的内容 deflate 反而变大，直接 store */
		const method = compress && raw.length >= 64 ? 8 : 0;
		const stored = method === 8 ? deflateRaw(raw) : raw;
		const crc = crc32(raw);
		const offset = out.length;

		// 本地文件头
		out.u32(0x04034b50);
		out.u16(20); // version needed
		out.u16(0x0800); // flags: UTF-8 文件名
		out.u16(method);
		out.u16(time);
		out.u16(date);
		out.u32(crc);
		out.u32(stored.length);
		out.u32(raw.length);
		out.u16(pathBytes.length);
		out.u16(0); // extra field 长度
		out.bytes(pathBytes);
		out.bytes(stored);

		central.push({
			pathBytes,
			crc,
			compSize: stored.length,
			rawSize: raw.length,
			method,
			offset,
		});
	}

	// 中央目录
	const centralStart = out.length;
	for (const item of central) {
		out.u32(0x02014b50);
		out.u16(20); // version made by
		out.u16(20); // version needed
		out.u16(0x0800);
		out.u16(item.method);
		out.u16(time);
		out.u16(date);
		out.u32(item.crc);
		out.u32(item.compSize);
		out.u32(item.rawSize);
		out.u16(item.pathBytes.length);
		out.u16(0); // extra
		out.u16(0); // comment
		out.u16(0); // disk number
		out.u16(0); // internal attrs
		out.u32(0); // external attrs
		out.u32(item.offset);
		out.bytes(item.pathBytes);
	}
	const centralSize = out.length - centralStart;

	// 目录结束记录
	out.u32(0x06054b50);
	out.u16(0);
	out.u16(0);
	out.u16(central.length);
	out.u16(central.length);
	out.u32(centralSize);
	out.u32(centralStart);
	out.u16(0);

	return out.toUint8Array();
}

/** deflate 原始流（不带 zlib 头），zip 需要的正是这个 */
function deflateRaw(data: Uint8Array): Uint8Array {
	return pako.deflateRaw(data);
}

function inflateRaw(data: Uint8Array): Uint8Array {
	return pako.inflateRaw(data);
}

/**
 * 解析 zip。
 * 只读中央目录，比顺着本地头扫描更可靠（本地头可能有 data descriptor）。
 */
export function readZip(buffer: Uint8Array): ZipEntry[] {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

	/* 从尾部往前找目录结束记录（0x06054b50），最多回退 64KB（注释最长 65535） */
	let eocd = -1;
	const minStart = Math.max(0, buffer.length - 65557);
	for (let i = buffer.length - 22; i >= minStart; i--) {
		if (view.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("不是有效的 zip 文件（找不到中央目录）");

	const total = view.getUint16(eocd + 10, true);
	let offset = view.getUint32(eocd + 16, true);

	const entries: ZipEntry[] = [];
	const decoder = new TextDecoder();

	for (let i = 0; i < total; i++) {
		if (view.getUint32(offset, true) !== 0x02014b50) {
			throw new Error("zip 中央目录损坏");
		}
		const method = view.getUint16(offset + 10, true);
		const compSize = view.getUint32(offset + 20, true);
		const nameLen = view.getUint16(offset + 28, true);
		const extraLen = view.getUint16(offset + 30, true);
		const commentLen = view.getUint16(offset + 32, true);
		const localOffset = view.getUint32(offset + 42, true);

		const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLen);
		const path = decoder.decode(nameBytes);

		// 目录条目跳过
		if (!path.endsWith("/")) {
			/* 本地头的名字与 extra 长度可能与中央目录不同，必须按本地头算数据起点 */
			const localNameLen = view.getUint16(localOffset + 26, true);
			const localExtraLen = view.getUint16(localOffset + 28, true);
			const dataStart = localOffset + 30 + localNameLen + localExtraLen;
			const raw = buffer.subarray(dataStart, dataStart + compSize);

			let data: Uint8Array;
			if (method === 0) data = raw;
			else if (method === 8) data = inflateRaw(raw);
			else throw new Error(`不支持的压缩方法 ${method}（${path}）`);

			entries.push({ path, data });
		}

		offset += 46 + nameLen + extraLen + commentLen;
	}

	return entries;
}

/** 文本文件便捷读取 */
export function readZipText(entry: ZipEntry): string {
	return new TextDecoder().decode(entry.data);
}

/** 文本便捷写入 */
export function textBytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}
