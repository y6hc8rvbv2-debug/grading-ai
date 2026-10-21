"use client";
import { use } from "react";
import GradingDetail from "@/components/screens/GradingDetail";

// Next.js 15 から params は Promise で届く
export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <GradingDetail subId={decodeURIComponent(id)} />;
}
