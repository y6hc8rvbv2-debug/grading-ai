// 保存の失敗の見分け（lib/storage-errors.ts）と、写真の種類の判定（lib/image-paths.ts の sniffMime）
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyStorageError, storageLogLine } from "../../lib/storage-errors";
import { sniffMime } from "../../lib/image-paths";

test("Storage の失敗を原因ごとに分ける（HTTP 400 の本文の statusCode も見る）", () => {
  // 2026-10-28 の不具合：許可形式に application/octet-stream が無く、以前は「権限がありません」と出ていた
  assert.equal(classifyStorageError({ status: 400, statusCode: "415", message: "mime type application/octet-stream is not supported" }).code, "storage_type_not_allowed");
  assert.equal(classifyStorageError({ status: 415, message: "x" }).code, "storage_type_not_allowed");
  assert.equal(classifyStorageError({ status: 400, statusCode: "403", message: "new row violates row-level security policy" }).code, "storage_denied");
  assert.equal(classifyStorageError({ status: 413, message: "The object exceeded the maximum allowed size" }).code, "storage_too_large");
  assert.equal(classifyStorageError({ status: 404, message: "Bucket not found" }).code, "storage_bucket_missing");
  assert.equal(classifyStorageError({ status: 500, message: "internal" }).code, "storage_failed");
  assert.equal(classifyStorageError(null).code, "storage_failed");
});

test("ログの1行には秘密・答案の中身を入れない（原因の種類・状態・ID の先頭だけ）", () => {
  const err = { status: 400, statusCode: "415", message: "mime type application/octet-stream is not supported token=sk_live_secret" };
  const line = storageLogLine("image/upload", classifyStorageError(err), err, "11111111-2222-3333-4444-555555555555");
  assert.equal(line, "[image/upload] storage_type_not_allowed status=400/415 user=11111111");
  assert.ok(!line.includes("secret"));
});

test("写真・PDF だけを中身で見分ける（HTML・SVG・申告だけの画像は断る）", () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2])), "image/jpeg");
  assert.equal(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(sniffMime(Buffer.from("%PDF-1.7\n")), "application/pdf");
  assert.equal(sniffMime(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(8)])), "image/heic");
  assert.equal(sniffMime(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmif1"), Buffer.alloc(8)])), "image/heif");
  assert.equal(sniffMime(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")])), "image/webp");
  assert.equal(sniffMime(Buffer.from("<html><script>alert(1)</script>")), null);
  assert.equal(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')), null);
  assert.equal(sniffMime(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(8)])), null, "動画（mp4）は断る");
  assert.equal(sniffMime(Buffer.alloc(0)), null);
});
