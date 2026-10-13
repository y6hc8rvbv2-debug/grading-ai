// heic-decode には型定義が無いため、使う部分だけを宣言する
declare module "heic-decode" {
  type Decoded = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
  function decode(input: { buffer: ArrayBufferLike | Uint8Array }): Promise<Decoded>;
  export default decode;
}
