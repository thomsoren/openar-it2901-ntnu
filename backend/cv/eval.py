"""
Evaluation script for Boat Detection Model using Roboflow Inference
Evaluates model performance on test dataset with precision, recall, and mAP metrics
"""
import os
import json
import cv2
import numpy as np
from pathlib import Path
from datetime import datetime
from inference import get_model

# Configuration
TEST_IMAGES_DIR = "../data/raw/Boat Detection Model.v7i.yolov8/test/images"
TEST_LABELS_DIR = "../data/raw/Boat Detection Model.v7i.yolov8/test/labels"
OUTPUT_DIR = Path("./output")
MODEL_ID = "boat-detection-model/1"
CONFIDENCE_THRESHOLD = 0.3
IOU_THRESHOLD = 0.5

# Create output directory
OUTPUT_DIR.mkdir(exist_ok=True)


def compute_iou(box1, box2):
    """
    Compute Intersection over Union (IoU) between two bounding boxes
    Boxes are in format [x_center, y_center, width, height] (normalized)
    """
    # Convert from normalized center format to corner format
    def center_to_corners(box):
        x_c, y_c, w, h = box
        x1 = x_c - w / 2
        y1 = y_c - h / 2
        x2 = x_c + w / 2
        y2 = y_c + h / 2
        return x1, y1, x2, y2
    
    x1_1, y1_1, x2_1, y2_1 = center_to_corners(box1)
    x1_2, y1_2, x2_2, y2_2 = center_to_corners(box2)
    
    # Compute intersection
    xi1 = max(x1_1, x1_2)
    yi1 = max(y1_1, y1_2)
    xi2 = min(x2_1, x2_2)
    yi2 = min(y2_1, y2_2)
    
    inter_area = max(0, xi2 - xi1) * max(0, yi2 - yi1)
    
    # Compute union
    box1_area = (x2_1 - x1_1) * (y2_1 - y1_1)
    box2_area = (x2_2 - x1_2) * (y2_2 - y1_2)
    union_area = box1_area + box2_area - inter_area
    
    return inter_area / union_area if union_area > 0 else 0


class BoatDetectionEvaluator:
    """Evaluates boat detection model on test dataset"""
    
    def __init__(self, model_id: str, test_images_dir: str, test_labels_dir: str):
        """
        Initialize evaluator
        
        Args:
            model_id: Roboflow model ID
            test_images_dir: Path to test images directory
            test_labels_dir: Path to test labels directory (YOLO format)
        """
        self.model = None
        self.model_id = model_id
        self.test_images_dir = Path(test_images_dir)
        self.test_labels_dir = Path(test_labels_dir)
        self.results = {
            'timestamp': datetime.now().isoformat(),
            'model': model_id,
            'test_images_dir': str(test_images_dir),
            'test_labels_dir': str(test_labels_dir),
            'metrics': {},
            'predictions': []
        }
        
    def load_model(self):
        """Load the Roboflow model"""
        print("📥 Loading Roboflow Boat Detection Model...")
        try:
            self.model = get_model(self.model_id)
            print(f"✅ Model loaded: {self.model_id}")
        except Exception as e:
            print(f"❌ Error loading model: {e}")
            raise
    
    def load_ground_truth(self, image_file: Path):
        """Load ground truth labels from YOLO format"""
        label_file = self.test_labels_dir / (image_file.stem + ".txt")
        
        if not label_file.exists():
            return []
        
        boxes = []
        try:
            with open(label_file, 'r') as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) >= 5:
                        boxes.append({
                            'class_id': int(parts[0]),
                            'x_center': float(parts[1]),
                            'y_center': float(parts[2]),
                            'width': float(parts[3]),
                            'height': float(parts[4])
                        })
        except Exception as e:
            print(f"⚠️  Error reading labels for {label_file}: {e}")
        
        return boxes
    
    def evaluate(self, confidence: float = CONFIDENCE_THRESHOLD, iou_threshold: float = IOU_THRESHOLD):
        """
        Evaluate model on test dataset
        
        Args:
            confidence: Confidence threshold for predictions
            iou_threshold: IoU threshold for matching predictions with ground truth
        """
        # Check if API key is set
        api_key = os.getenv("ROBOFLOW_API_KEY")
        if not api_key:
            print("⚠️  Warning: ROBOFLOW_API_KEY not set in environment")
            print("   Set it with: export ROBOFLOW_API_KEY=your_key_here")
            return
        
        if not self.test_images_dir.exists():
            print(f"❌ Error: Test images directory not found: {self.test_images_dir}")
            return
        
        if not self.test_labels_dir.exists():
            print(f"❌ Error: Test labels directory not found: {self.test_labels_dir}")
            return
        
        # Load model if not already loaded
        if self.model is None:
            self.load_model()
        
        # Get list of test images
        image_files = sorted([f for f in self.test_images_dir.iterdir() 
                            if f.suffix.lower() in ['.jpg', '.jpeg', '.png']])
        
        if not image_files:
            print(f"❌ No images found in {self.test_images_dir}")
            return
        
        print(f"\n📊 Evaluating on {len(image_files)} test images...")
        print(f"📝 Confidence threshold: {confidence}")
        print(f"📝 IoU threshold: {iou_threshold}")
        print()
        
        # Metrics accumulators
        tp = 0  # True positives
        fp = 0  # False positives
        fn = 0  # False negatives
        
        # Process each test image
        for idx, image_file in enumerate(image_files, 1):
            try:
                # Load image
                image = cv2.imread(str(image_file))
                if image is None:
                    print(f"⚠️  Could not load image: {image_file.name}")
                    continue
                
                height, width = image.shape[:2]
                
                # Get ground truth
                ground_truth = self.load_ground_truth(image_file)
                
                # Run inference
                try:
                    result = self.model.infer(
                        image,
                        confidence=confidence,
                        iou_threshold=iou_threshold
                    )[0]
                    
                    # Access predictions
                    predictions = result.predictions if hasattr(result, 'predictions') else []
                    
                    # Convert predictions to normalized format
                    pred_boxes = []
                    for pred in predictions:
                        # Normalize predictions to 0-1 range
                        x_norm = pred.x / width
                        y_norm = pred.y / height
                        w_norm = pred.width / width
                        h_norm = pred.height / height
                        
                        pred_boxes.append({
                            'x': x_norm,
                            'y': y_norm,
                            'width': w_norm,
                            'height': h_norm,
                            'confidence': pred.confidence
                        })
                    
                    # Match predictions with ground truth
                    matched_gt = set()
                    
                    for pred in pred_boxes:
                        best_iou = 0
                        best_gt_idx = -1
                        
                        for gt_idx, gt in enumerate(ground_truth):
                            if gt_idx in matched_gt:
                                continue
                            
                            iou = compute_iou(
                                (pred['x'], pred['y'], pred['width'], pred['height']),
                                (gt['x_center'], gt['y_center'], gt['width'], gt['height'])
                            )
                            
                            if iou > best_iou:
                                best_iou = iou
                                best_gt_idx = gt_idx
                        
                        if best_iou >= iou_threshold and best_gt_idx >= 0:
                            tp += 1
                            matched_gt.add(best_gt_idx)
                        else:
                            fp += 1
                    
                    # Count unmatched ground truth as false negatives
                    fn += len(ground_truth) - len(matched_gt)
                    
                    # Store prediction results
                    self.results['predictions'].append({
                        'image': image_file.name,
                        'num_predictions': len(predictions),
                        'num_ground_truth': len(ground_truth),
                        'matched': len(matched_gt)
                    })
                    
                    # Print progress
                    if idx % 50 == 0:
                        print(f"  Processed {idx}/{len(image_files)} images...")
                        
                except Exception as e:
                    print(f"⚠️  Error processing {image_file.name}: {e}")
                    fn += len(ground_truth)
                    continue
                    
            except Exception as e:
                print(f"⚠️  Error with image {image_file.name}: {e}")
                continue
        
        # Calculate metrics
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
        
        self.results['metrics'] = {
            'precision': float(precision),
            'recall': float(recall),
            'f1_score': float(f1),
            'true_positives': int(tp),
            'false_positives': int(fp),
            'false_negatives': int(fn),
            'total_predictions': int(tp + fp),
            'total_ground_truth': int(tp + fn + (len(image_files) - len(self.results['predictions']))),
        }
        
        print(f"\n✅ Evaluation complete!")
    
    def print_summary(self):
        """Print evaluation summary"""
        if not self.results.get('metrics'):
            print("❌ No evaluation results available. Run evaluate() first.")
            return
        
        metrics = self.results['metrics']
        
        print("\n" + "="*60)
        print("📈 EVALUATION SUMMARY")
        print("="*60)
        print(f"Timestamp: {self.results['timestamp']}")
        print(f"Model: {self.results['model']}")
        print(f"Test Images: {self.results['test_images_dir']}")
        print()
        print("Performance Metrics:")
        print("-"*60)
        
        metric_labels = {
            'precision': 'Precision',
            'recall': 'Recall',
            'f1_score': 'F1 Score',
        }
        
        for key, label in metric_labels.items():
            value = metrics.get(key)
            if value is not None:
                print(f"  {label:25} : {value:.4f}")
        
        print()
        print("Confusion Matrix:")
        print("-"*60)
        print(f"  True Positives (TP):      {metrics['true_positives']}")
        print(f"  False Positives (FP):     {metrics['false_positives']}")
        print(f"  False Negatives (FN):     {metrics['false_negatives']}")
        print()
        print(f"  Total Predictions:        {metrics['total_predictions']}")
        print(f"  Total Ground Truth:       {metrics['total_ground_truth']}")
        print("="*60 + "\n")
    
    def save_results(self, output_file: str = None):
        """
        Save evaluation results to JSON file
        
        Args:
            output_file: Path to save results. Defaults to output/eval_results.json
        """
        if not self.results.get('metrics'):
            print("❌ No results to save. Run evaluate() first.")
            return
        
        if output_file is None:
            output_file = OUTPUT_DIR / "eval_results.json"
        else:
            output_file = Path(output_file)
        
        try:
            with open(output_file, 'w') as f:
                json.dump(self.results, f, indent=2)
            print(f"💾 Results saved to: {output_file}")
        except Exception as e:
            print(f"❌ Error saving results: {e}")
            raise


def main():
    """Main evaluation function"""
    print("🚢 Boat Detection Model Evaluation (Roboflow)")
    print("="*60)
    
    # Initialize evaluator
    evaluator = BoatDetectionEvaluator(
        model_id=MODEL_ID,
        test_images_dir=TEST_IMAGES_DIR,
        test_labels_dir=TEST_LABELS_DIR
    )
    
    # Load model
    evaluator.load_model()
    
    # Run evaluation
    evaluator.evaluate()
    
    # Print summary
    evaluator.print_summary()
    
    # Save results
    evaluator.save_results()
    
    print("✅ Evaluation complete!")


if __name__ == "__main__":
    main()
