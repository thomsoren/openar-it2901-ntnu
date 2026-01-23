import { useEffect, useState } from "react";
import { AISData } from "../types/aisData";

/** Barebones hook to fetch unfiltered AIS data from backend API */
export const useFetchAIS = () => {

    const [data, setData] = useState<AISData[] | null>(null);

    useEffect(() => {
        const fetchAISData = async () => {
            try {
                const response = await fetch("http://localhost:8000/api/ais");
                const data = await response.json();
                console.log("Fetched AIS Data:", data);
                setData(data);
            } catch (error) {
                console.error("Error fetching AIS data:", error);
            }}

        fetchAISData();
        },
    []);

    return { data };
}
