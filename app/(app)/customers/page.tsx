"use client";
import ResourcePage from "@/components/ResourcePage";
import { CONFIGS } from "@/lib/fields";

export default function Page() {
  return <ResourcePage config={CONFIGS.customers} />;
}
