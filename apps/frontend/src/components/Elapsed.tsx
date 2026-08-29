import { useEffect, useState } from "react";

export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{Math.max(0, Math.round((now - since) / 1000))}s</>;
}
