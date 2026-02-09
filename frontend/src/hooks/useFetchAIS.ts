import { useEffect, useState } from "react";
import { AISData } from "../types/aisData";
import { API_CONFIG } from "../config/video";

/** Barebones hook to fetch unfiltered AIS data from backend API */
export const useFetchAIS = () => {
  const [data, setData] = useState<AISData[] | null>(null);

  useEffect(() => {
    const fetchAISData = async () => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/api/ais`);
        const data = await response.json();
        console.log("Fetched AIS Data:", data);
        setData(data);
      } catch (error) {
        console.error("Error fetching AIS data:", error);
      }
    };

    fetchAISData();
  }, []);

  return { data };
};
