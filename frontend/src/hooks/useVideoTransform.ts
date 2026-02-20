import { useEffect, useState, RefObject } from "react";
import { VideoFitMode } from "../contexts/settings-context";

export interface VideoTransform {
  videoWidth: number;
  videoHeight: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
}

/**
 * Calculates the actual rendered position and scale of the video element
 * accounting for object-fit property (contain or cover).
 *
 * This is crucial for mapping detection coordinates to POI overlay positions.
 *
 * - contain: Video fits entirely within container with letterbox/pillarbox
 * - cover: Video fills container completely, may be cropped
 */
export function useVideoTransform(
  videoRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  fitMode: VideoFitMode,
  nativeWidth?: number,
  nativeHeight?: number,
  recalcTrigger?: unknown
): VideoTransform {
  const fallbackWidth = nativeWidth && nativeWidth > 0 ? nativeWidth : 1920;
  const fallbackHeight = nativeHeight && nativeHeight > 0 ? nativeHeight : 1080;

  const [transform, setTransform] = useState<VideoTransform>({
    videoWidth: fallbackWidth,
    videoHeight: fallbackHeight,
    offsetX: 0,
    offsetY: 0,
    scaleX: 1,
    scaleY: 1,
  });

  useEffect(() => {
    function calculateTransform() {
      const video = videoRef.current;
      const container = containerRef.current;

      if (!video || !container) {
        return;
      }

      let sourceWidth = fallbackWidth;
      let sourceHeight = fallbackHeight;

      if (video instanceof HTMLVideoElement) {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          sourceWidth = video.videoWidth;
          sourceHeight = video.videoHeight;
        }
      } else if (video instanceof HTMLImageElement) {
        if (video.naturalWidth > 0 && video.naturalHeight > 0) {
          sourceWidth = video.naturalWidth;
          sourceHeight = video.naturalHeight;
        }
      }

      // Get the container dimensions
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;
      if (containerWidth <= 0 || containerHeight <= 0) {
        return;
      }

      // Calculate aspect ratios
      const videoAspectRatio = sourceWidth / sourceHeight;
      const containerAspectRatio = containerWidth / containerHeight;

      let videoWidth: number;
      let videoHeight: number;
      let offsetX: number;
      let offsetY: number;

      if (fitMode === "contain") {
        // Contain: video fits entirely within container
        if (containerAspectRatio > videoAspectRatio) {
          // Container is wider - video limited by height
          videoHeight = containerHeight;
          videoWidth = videoHeight * videoAspectRatio;
          offsetX = (containerWidth - videoWidth) / 2;
          offsetY = 0;
        } else {
          // Container is taller - video limited by width
          videoWidth = containerWidth;
          videoHeight = videoWidth / videoAspectRatio;
          offsetX = 0;
          offsetY = (containerHeight - videoHeight) / 2;
        }
      } else {
        // Cover: video fills entire container, may be cropped
        if (containerAspectRatio > videoAspectRatio) {
          // Container is wider - video limited by width
          videoWidth = containerWidth;
          videoHeight = videoWidth / videoAspectRatio;
          offsetX = 0;
          offsetY = (containerHeight - videoHeight) / 2;
        } else {
          // Container is taller - video limited by height
          videoHeight = containerHeight;
          videoWidth = videoHeight * videoAspectRatio;
          offsetX = (containerWidth - videoWidth) / 2;
          offsetY = 0;
        }
      }

      // Calculate scale factors (rendered size / native size)
      const scaleX = videoWidth / sourceWidth;
      const scaleY = videoHeight / sourceHeight;

      setTransform({
        videoWidth,
        videoHeight,
        offsetX,
        offsetY,
        scaleX,
        scaleY,
      });
    }

    // Calculate on mount and whenever window resizes
    calculateTransform();

    const resizeObserver = new ResizeObserver(calculateTransform);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    if (videoRef.current) {
      resizeObserver.observe(videoRef.current);
    }

    const mediaEl = videoRef.current;
    mediaEl?.addEventListener("loadedmetadata", calculateTransform);
    mediaEl?.addEventListener("loadeddata", calculateTransform);
    mediaEl?.addEventListener("load", calculateTransform);

    return () => {
      mediaEl?.removeEventListener("loadedmetadata", calculateTransform);
      mediaEl?.removeEventListener("loadeddata", calculateTransform);
      mediaEl?.removeEventListener("load", calculateTransform);
      resizeObserver.disconnect();
    };
  }, [videoRef, containerRef, fallbackWidth, fallbackHeight, fitMode, recalcTrigger]);

  return transform;
}
