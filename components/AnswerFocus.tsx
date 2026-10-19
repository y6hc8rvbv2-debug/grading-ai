"use client";
import { useEffect, useState } from "react";
import { useUI } from "@/components/ui-context";
import type { Item, Submission } from "@/lib/types";
export default function AnswerFocus({
  sub,
  item,
}: {
  sub: Submission;
  item: Item;
}) {
  const { ds } = useUI();
  const [url, setUrl] = useState("");
  const [aspect, setAspect] = useState(1.414);
  const b = item.bbox;
  const path = sub.imagePaths[(b?.page || 1) - 1];
  useEffect(() => {
    let live = true;
    setUrl("");
    if (path)
      ds.signedImageUrl(path)
        .then((u) => {
          if (live) {
            setUrl(u);
            const img = new Image();
            img.onload = () => {
              if (live) setAspect(img.naturalHeight / img.naturalWidth);
            };
            img.src = u;
          }
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [path, ds]);
  if (!url)
    return <p>原本を読み込み中（表示できない場合は答案を開いてください）</p>;
  const valid =
    b &&
    b.w > 0 &&
    b.h > 0 &&
    b.x >= 0 &&
    b.y >= 0 &&
    b.x + b.w <= 1 &&
    b.y + b.h <= 1;
  return (
    <div>
      <details open={!!valid}>
        <summary>
          原本 {b?.page || 1}ページ・拡大表示（AI座標のため原本全体も確認）
        </summary>
        {valid ? (
          <svg
            viewBox={`${Math.max(0, b.x - 0.04)} ${Math.max(0, b.y - 0.04) * aspect} ${Math.min(1, b.w + 0.08)} ${Math.min(1, b.h + 0.08) * aspect}`}
            style={{ width: "100%", height: 180, background: "white" }}
          >
            <image
              href={url}
              width="1"
              height={aspect}
              preserveAspectRatio="none"
            />
          </svg>
        ) : (
          <img
            src={url}
            alt="答案原本"
            style={{ maxWidth: "100%", maxHeight: 300 }}
          />
        )}
      </details>
      <details>
        <summary>ページ全体を見る</summary>
        <img src={url} alt="答案ページ全体" style={{ maxWidth: "100%" }} />
      </details>
    </div>
  );
}
