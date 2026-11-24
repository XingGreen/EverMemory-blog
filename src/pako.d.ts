/**
 * pako 的最小类型声明。
 *
 * pako 2.1.0 不自带 .d.ts，@types 下也没有对应包。本项目只用到
 * deflateRaw / inflateRaw 两个函数，与其安装一个只为这两个签名的类型包，
 * 不如在这里按实际用到的部分声明——多出来的 API 我们也无法保证语义正确。
 */
declare module "pako" {
	/** 裸 deflate 流（不带 zlib 头），zip 容器使用这种 */
	export function deflateRaw(
		data: Uint8Array | ArrayBuffer,
		options?: { level?: number },
	): Uint8Array;

	/** 解压裸 deflate 流 */
	export function inflateRaw(data: Uint8Array | ArrayBuffer): Uint8Array;

	const pako: {
		deflateRaw: typeof deflateRaw;
		inflateRaw: typeof inflateRaw;
	};
	export default pako;
}
