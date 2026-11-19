import { Chat } from "./chat";

export default function Page() {
  return (
    <>
      <h1 className="mb-2 text-2xl font-bold">Chat</h1>
      <p className="mb-4 text-sm text-slate-700">
        Ask about the catalog. The assistant uses the same MCP tools as any external agent. Your key stays in this
        browser and is sent with each request; the server never stores or logs it.
      </p>
      <Chat />
    </>
  );
}
