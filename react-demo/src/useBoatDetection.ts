import { useEffect, useRef, useState } from "react";
import { InferenceEngine } from "inferencejs";

export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

interface UseBoatDetectionOptions {
  modelName: string;
  modelVersion: string;
  publishableKey: string;
  enabled: boolean;
}

export const useBoatDetection = (
  videoRef: React.RefObject<HTMLVideoElement>,
  options: UseBoatDetectionOptions
) => {
  const [detections, setDetections] = useState<Detection[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inferEngineRef = useRef<InferenceEngine | null>(null);
  const workerIdRef = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!options.enabled || !options.publishableKey) {
      return;
    }

    const initializeInference = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Initialize inference engine
        const inferEngine = new InferenceEngine();
        inferEngineRef.current = inferEngine;

        // Start worker with model
        const workerId = await inferEngine.startWorker(
          options.modelName,
          options.modelVersion,
          options.publishableKey
        );
        workerIdRef.current = workerId;

        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to initialize inference engine");
        setIsLoading(false);
      }
    };

    initializeInference();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [options.enabled, options.modelName, options.modelVersion, options.publishableKey]);

  useEffect(() => {
    if (!videoRef.current || !inferEngineRef.current || !workerIdRef.current || isLoading) {
      return;
    }

    const detectObjects = async () => {
      const video = videoRef.current;
      const inferEngine = inferEngineRef.current;
      const workerId = workerIdRef.current;

      if (!video || !inferEngine || !workerId || video.paused || video.ended) {
        animationFrameRef.current = requestAnimationFrame(detectObjects);
        return;
      }

      try {
        // Create a canvas to capture video frame
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");

        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert canvas to image for inference
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          // Run inference
          // Note: InferenceJS expects specific image formats, this is a simplified version
          // You may need to adjust based on actual InferenceJS API requirements
          const predictions = await inferEngine.infer(workerId, canvas as any);

          if (predictions && Array.isArray(predictions)) {
            setDetections(predictions as Detection[]);
          }
        }
      } catch (err) {
        console.error("Detection error:", err);
      }

      // Continue detection loop
      animationFrameRef.current = requestAnimationFrame(detectObjects);
    };

    // Start detection loop
    detectObjects();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [videoRef, isLoading]);

  return {
    detections,
    isLoading,
    error,
  };
};
