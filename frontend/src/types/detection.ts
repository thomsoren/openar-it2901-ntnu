export interface Detection {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  class: string;
}

export interface FrameDetection {
  frame: number;
  timestamp: number;
  detections: Detection[];
}

export interface TrackedDetection {
  detection: Detection;
  streak: number;
  missed: number;
}
