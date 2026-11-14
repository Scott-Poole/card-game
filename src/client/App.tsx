import { useEffect, useState } from "react";
import { decodeServerMessage } from "../protocol/messages.ts";
export default function App() {
  const [status, setStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  useEffect(() => {
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    );
    let failed = false;
    const fail = () => {
      failed = true;
      setStatus("error");
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      const decoded = decodeServerMessage(event.data);
      if (!decoded.ok || decoded.message.type === "error") fail();
      else if (!failed) setStatus("connected");
    };
    socket.onerror = fail;
    socket.onclose = fail;
    return () => {
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    };
  }, []);
  return (
    <main>
      <h1>Card game</h1>
      <p role="status">{status}</p>
    </main>
  );
}
