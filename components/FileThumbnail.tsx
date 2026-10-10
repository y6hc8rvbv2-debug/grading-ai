"use client";
import { useEffect, useState } from "react";
export default function FileThumbnail({ file }: { file?: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {file?.type.startsWith("image/") ? (
        <img
          src={url}
          alt={file.name}
          style={{ width: "100%", height: 110, objectFit: "contain" }}
        />
      ) : (
        "PDFを開いて確認"
      )}
    </a>
  ) : (
    <span>📄</span>
  );
}
