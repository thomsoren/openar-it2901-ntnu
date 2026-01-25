"""
Boat detection script using Roboflow Inference
Runs detection on the video and saves results
"""
import os
import json
from pathlib import Path
from dotenv import load_dotenv
from inference import InferencePipeline
import supervision as sv
import cv2

# Configuration
VIDEO_PATH = "../data/raw/video/hurtigruta-demo.mp4"
OUTPUT_DIR = Path("./output")
MODEL_ID = "boat-detection-model/1"

# Boat class names from Roboflow model
BOAT_CLASSES = {
    0: 'Bulk carrier',
    1: 'Container ship',
    2: 'Cruise ship',
    3: 'Ferry boat',
    4: 'Fishing boat',
    5: 'Ore carrier',
    6: 'Sail boat',
    7: 'Small boat',
    8: 'Uncategorized'
}

# Create output directory
OUTPUT_DIR.mkdir(exist_ok=True)

# Storage for all detections
all_detections = []
frame_count = 0

# Video writer setup
output_video_path = OUTPUT_DIR / "detected_boats.mp4"
video_writer = None
video_info = None

def on_prediction(predictions, video_frame):
    """
    Callback function that runs after each prediction
    """
    global all_detections, frame_count, video_writer, video_info

    frame_count += 1

    # Get the frame image
    image = video_frame.image

    # Initialize video writer on first frame
    if video_writer is None:
        height, width = image.shape[:2]
        video_info = {
            "width": width,
            "height": height,
            "fps": 25  # Default FPS
        }
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        video_writer = cv2.VideoWriter(
            str(output_video_path),
            fourcc,
            video_info["fps"],
            (width, height)
        )

    # Convert predictions to supervision Detections
    detections = sv.Detections.from_inference(predictions)

    # Store detection data
    frame_detections = {
        "frame": frame_count,
        "timestamp": frame_count / video_info["fps"],
        "detections": []
    }

    # Extract detection data
    if len(detections) > 0:
        for i in range(len(detections)):
            x1, y1, x2, y2 = detections.xyxy[i]
            confidence = detections.confidence[i] if detections.confidence is not None else 0.0
            class_id = detections.class_id[i] if detections.class_id is not None else 0

            # Get boat class name from mapping
            boat_class = BOAT_CLASSES.get(int(class_id), 'Unknown')

            frame_detections["detections"].append({
                "x": float((x1 + x2) / 2),
                "y": float((y1 + y2) / 2),
                "width": float(x2 - x1),
                "height": float(y2 - y1),
                "confidence": float(confidence),
                "class": boat_class,
                "class_id": int(class_id)
            })

    all_detections.append(frame_detections)

    # Annotate the frame
    bounding_box_annotator = sv.BoxAnnotator()
    label_annotator = sv.LabelAnnotator()

    annotated_image = bounding_box_annotator.annotate(
        scene=image.copy(),
        detections=detections
    )
    annotated_image = label_annotator.annotate(
        scene=annotated_image,
        detections=detections
    )

    # Write annotated frame
    video_writer.write(annotated_image)

    # Print progress
    num_boats = len(detections)
    if frame_count % 25 == 0:  # Print every second (assuming 25fps)
        print(f"Frame {frame_count}: {num_boats} boats detected")

def main():
    # Load .env from backend/ if present
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(env_path)

    # Check if API key is set
    api_key = os.getenv("ROBOFLOW_API_KEY")
    if not api_key:
        print("⚠️  Warning: ROBOFLOW_API_KEY not set in environment")
        print("   Set it with: export ROBOFLOW_API_KEY=your_key_here")
        print("   Or create a .env file")
        return

    print(f"🚢 Starting boat detection on video: {VIDEO_PATH}")
    print(f"📊 Model: {MODEL_ID}")
    print(f"📁 Output directory: {OUTPUT_DIR}")
    print()

    # Check if video exists
    video_path = Path(VIDEO_PATH)
    if not video_path.exists():
        print(f"❌ Error: Video not found at {video_path}")
        return

    try:
        # Initialize the inference pipeline
        pipeline = InferencePipeline.init(
            model_id=MODEL_ID,
            video_reference=str(video_path),
            on_prediction=on_prediction,
            confidence=0.3,  # Lower confidence threshold (default is 0.5)
            iou_threshold=0.5,  # Intersection over Union threshold
        )

        print("▶️  Starting video processing...")
        print()

        # Start the pipeline
        pipeline.start()
        pipeline.join()

    except KeyboardInterrupt:
        print("\n⚠️  Detection interrupted by user")
    except Exception as e:
        print(f"\n❌ Error during detection: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Close video writer
        if video_writer is not None:
            video_writer.release()

        # Save detections to JSON
        detections_file = OUTPUT_DIR / "detections.json"
        with open(detections_file, 'w') as f:
            json.dump(all_detections, f, indent=2)

        print()
        print("✅ Processing complete!")
        print(f"📹 Output video: {output_video_path}")
        print(f"📊 Detections JSON: {detections_file}")
        print(f"📈 Total frames processed: {frame_count}")

        # Count frames with detections
        frames_with_boats = len([d for d in all_detections if len(d['detections']) > 0])
        print(f"🚢 Frames with boats detected: {frames_with_boats}")

if __name__ == "__main__":
    main()
