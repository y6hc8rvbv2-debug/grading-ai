"use client";
import { useParams } from "next/navigation";
import GradingDetail from "@/components/screens/GradingDetail";

// Next.js 15 では params が Promise になったため、クライアントでは useParams で読む
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <GradingDetail subId={decodeURIComponent(id)} />;
}
