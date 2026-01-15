"""
Boat detection using YOLOv8 (COCO dataset includes boats)
Alternative approach that might work better
"""
from ultralytics import YOLO
import cv2
import json
from pathlib import Path

# Configuration
VIDEO_PATH = "../data/processed/video/Hurtigruten-Front-Camera-Risoyhamn-Harstad-Dec-28-2011-3min-no-audio.mp4"
OUTPUT_DIR = Path("./output")

# Create output directory
OUTPUT_DIR.mkdir(exist_ok=True)

# COCO class IDs for water vessels
# 8: boat
BOAT_CLASS_ID = 8

def main():
    print("🚢 Starting boat detection with YOLOv8...")
    print(f"📹 Video: {VIDEO_PATH}")
    print()

    # Load YOLOv8 model
    print("📥 Loading YOLOv8 model...")
    model = YOLO("yolov8n.pt")  # Will auto-download if needed

    # Open video
    cap = cv2.VideoCapture(VIDEO_PATH)

    if not cap.isOpened():
        print("❌ Error: Could not open video")
        return

    # Get video properties
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"📊 Video: {width}x{height} @ {fps}fps, {total_frames} frames")
    print()

    # Setup video writer
    output_video_path = OUTPUT_DIR / "detected_boats_yolo.mp4"
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(str(output_video_path), fourcc, fps, (width, height))

    all_detections = []
    frame_count = 0

    print("▶️  Processing video...")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            frame_count += 1

            # Run inference
            results = model(frame, verbose=False)

            # Get detections
            frame_detections = {
                "frame": frame_count,
                "timestamp": frame_count / fps,
                "detections": []
            }

            # Process results
            for result in results:
                boxes = result.boxes

                for box in boxes:
                    class_id = int(box.cls[0])

                    # Only keep boat detections (class 8 in COCO)
                    if class_id == BOAT_CLASS_ID:
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        confidence = float(box.conf[0])

                        # Filter by confidence
                        if confidence > 0.25:  # Lower threshold
                            frame_detections["detections"].append({
                                "x": (x1 + x2) / 2,
                                "y": (y1 + y2) / 2,
                                "width": x2 - x1,
                                "height": y2 - y1,
                                "confidence": confidence,
                                "class": "boat"
                            })

                            # Draw bounding box
                            cv2.rectangle(frame,
                                        (int(x1), int(y1)),
                                        (int(x2), int(y2)),
                                        (0, 255, 0), 2)

                            # Draw label
                            label = f"Boat {confidence:.2f}"
                            cv2.putText(frame, label,
                                      (int(x1), int(y1) - 10),
                                      cv2.FONT_HERSHEY_SIMPLEX,
                                      0.5, (0, 255, 0), 2)

            all_detections.append(frame_detections)

            # Write frame
            out.write(frame)

            # Print progress
            if frame_count % 25 == 0:
                num_boats = len(frame_detections["detections"])
                print(f"Frame {frame_count}/{total_frames}: {num_boats} boats detected")

    finally:
        cap.release()
        out.release()

        # Save detections
        detections_file = OUTPUT_DIR / "detections_yolo.json"
        with open(detections_file, 'w') as f:
            json.dump(all_detections, f, indent=2)

        print()
        print("✅ Processing complete!")
        print(f"📹 Output video: {output_video_path}")
        print(f"📊 Detections JSON: {detections_file}")
        print(f"📈 Total frames processed: {frame_count}")

        frames_with_boats = len([d for d in all_detections if len(d['detections']) > 0])
        print(f"🚢 Frames with boats detected: {frames_with_boats}")

if __name__ == "__main__":
    main()
