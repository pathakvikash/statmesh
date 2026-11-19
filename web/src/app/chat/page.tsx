import { geoNames, sourceList } from "@/lib/data";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [src, names] = await Promise.all([sourceList(), geoNames()]);
  return (
    <Chat
      sources={src.map((s) => ({ id: s.id, name: s.name }))}
      geos={[...names].map(([code, name]) => ({ code, name }))}
    />
  );
}
