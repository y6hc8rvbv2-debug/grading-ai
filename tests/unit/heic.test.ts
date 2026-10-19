// HEIC → JPEG 変換（サーバー側の予備。lib/ai/heic.ts）の単体テスト。
//   tests/fixtures/sample.heic は合成した画像（2600×600、左に赤・右に黒の四角）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { heicToJpeg, looksLikeHeic } from "../../lib/ai/heic";

const fixture = () => readFile(new URL("../fixtures/sample.heic", import.meta.url));

test("先頭のバイトで HEIC を見分ける", async () => {
  assert.equal(looksLikeHeic(await fixture()), true);
  assert.equal(looksLikeHeic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), false);
});

test("HEIC を長辺 2400px 以下の JPEG にする（色と向きを保つ）", async () => {
  const out = await heicToJpeg(await fixture());
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8], "JPEG になっている");
  const img = jpeg.decode(out, { useTArray: true });
  assert.equal(img.width, 2400);
  assert.equal(img.height, 554);
  const px = (x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
  const [r, g, b] = px(370, 277);   // 左の赤い四角の中
  assert.ok(r > 150 && g < 90 && b < 90, `左は赤（${r},${g},${b}）`);
  const [r2] = px(2030, 277);       // 右の黒い四角の中
  assert.ok(r2 < 60, "右は黒");
  assert.ok(px(1200, 30)[0] > 220, "背景は白");
});
