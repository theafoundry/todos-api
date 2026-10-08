import { useState, useEffect } from "react";

export function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="m-offline-banner" role="status">
      <span className="m-offline-banner__dot" />
      <span className="m-offline-banner__text">
        You're offline. Keep your draft and retry saving when you reconnect.
      </span>
    </div>
  );
}
