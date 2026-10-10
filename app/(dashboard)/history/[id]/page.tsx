"use client";
import GradingDetail from "@/components/screens/GradingDetail";

export default function Page({ params }: { params: { id: string } }) {
  return <GradingDetail subId={decodeURIComponent(params.id)} />;
}
