import { useEffect, useState } from "react";

export function useClock() {
  const [clockDate, setClockDate] = useState(() => new Date().toISOString());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockDate(new Date().toISOString());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return { clockDate };
}
