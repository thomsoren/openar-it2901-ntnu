"use client";

import { useState } from "react";
import { Navbar } from "@/components/layout/navbar";
import { Footer } from "@/components/layout/footer";
import { Section } from "@/components/layout/section";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";

export default function DocsPage() {
  const [installValue, setInstallValue] = useState("pnpm");
  const [npmInstallValue, setNpmInstallValue] = useState("npm");
  const [pythonInstallValue, setPythonInstallValue] = useState("pip");

  const installCommands = [
    {
      label: "pnpm",
      code: "pnpm i https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents-jip",
    },
    {
      label: "npm",
      code: "npm install https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents-jip",
    },
    {
      label: "yarn",
      code: "yarn add https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents-jip",
    },
    {
      label: "bun",
      code: "bun add https://github.com/Ocean-Industries-Concept-Lab/openbridge-webcomponents-jip",
    },
  ];

  const npmCommands = [
    {
      label: "npm",
      code: "npm install @openbridge/openar",
    },
    {
      label: "yarn",
      code: "yarn add @openbridge/openar",
    },
    {
      label: "pnpm",
      code: "pnpm add @openbridge/openar",
    },
    {
      label: "bun",
      code: "bun add @openbridge/openar",
    },
  ];

  const pythonCommands = [
    {
      label: "pip",
      code: "pip install openar-sdk",
    },
    {
      label: "uv",
      code: "uv add openar-sdk",
    },
  ];

  const activeInstallCommand = installCommands.find(
    (cmd) => cmd.label === installValue
  );
  const activeNpmCommand = npmCommands.find(
    (cmd) => cmd.label === npmInstallValue
  );
  const activePythonCommand = pythonCommands.find(
    (cmd) => cmd.label === pythonInstallValue
  );

  return (
    <>
      <Navbar />
      <main className="page-sections mx-auto pt-24">
        <Section containerSize="xl">
          <div className="prose prose-slate max-w-none">
            <h1 className="font-heading text-5xl font-semibold text-slate-900 mb-8">
              Getting Started with OpenAR
            </h1>

            {/* Installation */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Installation
              </h2>
              <p className="text-slate-600 mb-4">
                Install the OpenBridge web components package:
              </p>
              <Snippet onValueChange={setInstallValue} value={installValue}>
                <SnippetHeader>
                  <SnippetTabsList>
                    {installCommands.map((command) => (
                      <SnippetTabsTrigger
                        key={command.label}
                        value={command.label}
                      >
                        {command.label}
                      </SnippetTabsTrigger>
                    ))}
                  </SnippetTabsList>
                  {activeInstallCommand && (
                    <SnippetCopyButton value={activeInstallCommand.code} />
                  )}
                </SnippetHeader>
                {installCommands.map((command) => (
                  <SnippetTabsContent key={command.label} value={command.label}>
                    {command.code}
                  </SnippetTabsContent>
                ))}
              </Snippet>
            </section>

            {/* Two Approaches */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Two Ways to Use OpenAR
              </h2>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">
                      1. Cloud API (Recommended for getting started)
                    </h3>
                    <p className="text-slate-600">
                      Use our hosted detection service with GPU acceleration. Perfect for development and demos.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-xl font-semibold text-slate-900 mb-2">
                      2. Local Backend (For production/offline use)
                    </h3>
                    <p className="text-slate-600">
                      Run the detection backend on your own hardware. No internet required.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Cloud API Usage */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Using the Cloud API
              </h2>
              <p className="text-slate-600 mb-4">
                Quick start with our hosted detection service:
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Step 1: Install the package
                </h3>
                <Snippet
                  onValueChange={setNpmInstallValue}
                  value={npmInstallValue}
                >
                  <SnippetHeader>
                    <SnippetTabsList>
                      {npmCommands.map((command) => (
                        <SnippetTabsTrigger
                          key={command.label}
                          value={command.label}
                        >
                          {command.label}
                        </SnippetTabsTrigger>
                      ))}
                    </SnippetTabsList>
                    {activeNpmCommand && (
                      <SnippetCopyButton value={activeNpmCommand.code} />
                    )}
                  </SnippetHeader>
                  {npmCommands.map((command) => (
                    <SnippetTabsContent
                      key={command.label}
                      value={command.label}
                    >
                      {command.code}
                    </SnippetTabsContent>
                  ))}
                </Snippet>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Step 2: Use the component
                </h3>
                <Snippet value="cloud-usage">
                  <SnippetHeader>
                    <span className="text-sm font-medium text-slate-600">
                      Cloud API Usage
                    </span>
                    <SnippetCopyButton
                      value={`import { OpenAR } from '@openbridge/openar';

function App() {
  return (
    <OpenAR
      videoSource="camera"
      apiKey={process.env.OPENAR_API_KEY}
    />
  );
}`}
                    />
                  </SnippetHeader>
                  <SnippetTabsContent value="cloud-usage">
                    {`import { OpenAR } from '@openbridge/openar';

function App() {
  return (
    <OpenAR
      videoSource="camera"
      apiKey={process.env.OPENAR_API_KEY}
    />
  );
}`}
                  </SnippetTabsContent>
                </Snippet>
              </div>
            </section>

            {/* Local Backend Usage */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Using a Local Backend
              </h2>
              <p className="text-slate-600 mb-4">
                Run detection on your own hardware for offline use:
              </p>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Step 1: Install the Python SDK
                </h3>
                <Snippet
                  onValueChange={setPythonInstallValue}
                  value={pythonInstallValue}
                >
                  <SnippetHeader>
                    <SnippetTabsList>
                      {pythonCommands.map((command) => (
                        <SnippetTabsTrigger
                          key={command.label}
                          value={command.label}
                        >
                          {command.label}
                        </SnippetTabsTrigger>
                      ))}
                    </SnippetTabsList>
                    {activePythonCommand && (
                      <SnippetCopyButton value={activePythonCommand.code} />
                    )}
                  </SnippetHeader>
                  {pythonCommands.map((command) => (
                    <SnippetTabsContent
                      key={command.label}
                      value={command.label}
                    >
                      {command.code}
                    </SnippetTabsContent>
                  ))}
                </Snippet>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Step 2: Start the detection server
                </h3>
                <Snippet value="local-server">
                  <SnippetHeader>
                    <span className="text-sm font-medium text-slate-600">
                      Start Server
                    </span>
                    <SnippetCopyButton value="openar-server --model yolov8n --source camera" />
                  </SnippetHeader>
                  <SnippetTabsContent value="local-server">
                    openar-server --model yolov8n --source camera
                  </SnippetTabsContent>
                </Snippet>
              </div>

              <div className="mb-6">
                <h3 className="text-xl font-semibold text-slate-900 mb-3">
                  Step 3: Connect your frontend
                </h3>
                <Snippet value="local-usage">
                  <SnippetHeader>
                    <span className="text-sm font-medium text-slate-600">
                      Local Backend Usage
                    </span>
                    <SnippetCopyButton
                      value={`import { OpenAR } from '@openbridge/openar';

function App() {
  return (
    <OpenAR
      videoSource="camera"
      detectionEndpoint="ws://localhost:8000/detect"
    />
  );
}`}
                    />
                  </SnippetHeader>
                  <SnippetTabsContent value="local-usage">
                    {`import { OpenAR } from '@openbridge/openar';

function App() {
  return (
    <OpenAR
      videoSource="camera"
      detectionEndpoint="ws://localhost:8000/detect"
    />
  );
}`}
                  </SnippetTabsContent>
                </Snippet>
              </div>
            </section>

            {/* Custom Detection Models */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Custom Detection Models
              </h2>
              <p className="text-slate-600 mb-4">
                Integrate your own YOLO model:
              </p>
              <Snippet value="custom-model">
                <SnippetHeader>
                  <span className="text-sm font-medium text-slate-600">
                    my_detector.py
                  </span>
                  <SnippetCopyButton
                    value={`from openar import BaseDetector, DetectionServer

class MyBoatDetector(BaseDetector):
    def __init__(self):
        self.model = load_my_custom_model()

    def detect(self, frame):
        return self.model.predict(frame)

# One command to serve
DetectionServer(MyBoatDetector()).run()`}
                  />
                </SnippetHeader>
                <SnippetTabsContent value="custom-model">
                  {`from openar import BaseDetector, DetectionServer

class MyBoatDetector(BaseDetector):
    def __init__(self):
        self.model = load_my_custom_model()

    def detect(self, frame):
        return self.model.predict(frame)

# One command to serve
DetectionServer(MyBoatDetector()).run()`}
                </SnippetTabsContent>
              </Snippet>
            </section>

            {/* Deployment */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Deployment
              </h2>
              <p className="text-slate-600 mb-4">
                Deploy to edge devices for offline operation:
              </p>
              <Snippet value="docker-deploy">
                <SnippetHeader>
                  <span className="text-sm font-medium text-slate-600">
                    Docker Deployment
                  </span>
                  <SnippetCopyButton
                    value={`docker run -d \\
  --device /dev/video0 \\
  -p 8000:8000 \\
  openar/detector:latest \\
  --model models/my_boat_detector.pt \\
  --source /dev/video0`}
                  />
                </SnippetHeader>
                <SnippetTabsContent value="docker-deploy">
                  {`docker run -d \\
  --device /dev/video0 \\
  -p 8000:8000 \\
  openar/detector:latest \\
  --model models/my_boat_detector.pt \\
  --source /dev/video0`}
                </SnippetTabsContent>
              </Snippet>
              <p className="text-slate-600 mt-4">
                Your frontend connects to <code className="bg-slate-100 px-2 py-1 rounded text-sm">ws://&lt;device-ip&gt;:8000/detect</code>
              </p>
            </section>

            {/* Performance Optimization */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                Performance Tips
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">
                    Model Optimization
                  </h3>
                  <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                    <li>Use YOLOv8n (nano) for faster inference on CPU</li>
                    <li>ONNX runtime for 2-3x speedup</li>
                    <li>TensorRT on NVIDIA hardware for maximum performance</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">
                    Hardware Recommendations
                  </h3>
                  <ul className="list-disc list-inside text-slate-600 space-y-2 ml-4">
                    <li>Jetson Nano ($99) - GPU accelerated, 10-15 FPS detection</li>
                    <li>Raspberry Pi 4/5 - CPU only, 3-5 FPS detection</li>
                    <li>Coral TPU - Ultra low power, 30 FPS detection</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">
                    Frame Processing Options
                  </h3>

                  <div className="space-y-4 mt-4">
                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-2">
                        Frame Skipping
                      </h4>
                      <Snippet value="frame-skip">
                        <SnippetHeader>
                          <span className="text-sm font-medium text-slate-600">
                            Process every Nth frame
                          </span>
                          <SnippetCopyButton
                            value={`server = DetectionServer(
    detector=MyYOLODetector(),
    process_every_n_frames=3,
    interpolate_between=True
)`}
                          />
                        </SnippetHeader>
                        <SnippetTabsContent value="frame-skip">
                          {`server = DetectionServer(
    detector=MyYOLODetector(),
    process_every_n_frames=3,
    interpolate_between=True
)`}
                        </SnippetTabsContent>
                      </Snippet>
                    </div>

                    <div>
                      <h4 className="text-lg font-semibold text-slate-900 mb-2">
                        Async Queue
                      </h4>
                      <Snippet value="async-queue">
                        <SnippetHeader>
                          <span className="text-sm font-medium text-slate-600">
                            Non-blocking detection
                          </span>
                          <SnippetCopyButton
                            value={`server = DetectionServer(
    detector=MyYOLODetector(),
    mode='async_queue',
    max_queue_size=2
)`}
                          />
                        </SnippetHeader>
                        <SnippetTabsContent value="async-queue">
                          {`server = DetectionServer(
    detector=MyYOLODetector(),
    mode='async_queue',
    max_queue_size=2
)`}
                        </SnippetTabsContent>
                      </Snippet>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* API Reference */}
            <section className="mb-12">
              <h2 className="font-heading text-3xl font-semibold text-slate-900 mb-4">
                API Reference
              </h2>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">
                    Component Props
                  </h3>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
                    <dl className="space-y-4">
                      <div>
                        <dt className="font-mono text-sm font-semibold text-slate-900">
                          videoSource
                        </dt>
                        <dd className="text-slate-600 mt-1">
                          <code className="bg-slate-100 px-2 py-1 rounded text-sm">
                            &quot;camera&quot; | string | MediaStream
                          </code>
                          <p className="mt-1">Video input source</p>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-sm font-semibold text-slate-900">
                          apiKey
                        </dt>
                        <dd className="text-slate-600 mt-1">
                          <code className="bg-slate-100 px-2 py-1 rounded text-sm">
                            string (optional)
                          </code>
                          <p className="mt-1">API key for cloud detection service</p>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-sm font-semibold text-slate-900">
                          detectionEndpoint
                        </dt>
                        <dd className="text-slate-600 mt-1">
                          <code className="bg-slate-100 px-2 py-1 rounded text-sm">
                            string (optional)
                          </code>
                          <p className="mt-1">WebSocket URL for local detection backend</p>
                        </dd>
                      </div>
                      <div>
                        <dt className="font-mono text-sm font-semibold text-slate-900">
                          overlayRenderer
                        </dt>
                        <dd className="text-slate-600 mt-1">
                          <code className="bg-slate-100 px-2 py-1 rounded text-sm">
                            (detections) =&gt; ReactNode (optional)
                          </code>
                          <p className="mt-1">Custom renderer for detection overlays</p>
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-slate-900 mb-3">
                    WebSocket Protocol
                  </h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-slate-600 mb-2">
                        Messages sent from frontend to backend:
                      </p>
                      <Snippet value="ws-frontend">
                        <SnippetHeader>
                          <span className="text-sm font-medium text-slate-600">
                            Frontend → Backend
                          </span>
                          <SnippetCopyButton
                            value={`{
  "type": "frame",
  "timestamp": 1234567890,
  "frame": "base64_encoded_jpeg"
}`}
                          />
                        </SnippetHeader>
                        <SnippetTabsContent value="ws-frontend">
                          {`{
  "type": "frame",
  "timestamp": 1234567890,
  "frame": "base64_encoded_jpeg"
}`}
                        </SnippetTabsContent>
                      </Snippet>
                    </div>

                    <div>
                      <p className="text-slate-600 mb-2">
                        Detection results sent back to frontend:
                      </p>
                      <Snippet value="ws-backend">
                        <SnippetHeader>
                          <span className="text-sm font-medium text-slate-600">
                            Backend → Frontend
                          </span>
                          <SnippetCopyButton
                            value={`{
  "type": "detections",
  "timestamp": 1234567890,
  "detections": [
    {
      "bbox": [100, 200, 50, 75],
      "class": "boat",
      "confidence": 0.95
    }
  ]
}`}
                          />
                        </SnippetHeader>
                        <SnippetTabsContent value="ws-backend">
                          {`{
  "type": "detections",
  "timestamp": 1234567890,
  "detections": [
    {
      "bbox": [100, 200, 50, 75],
      "class": "boat",
      "confidence": 0.95
    }
  ]
}`}
                        </SnippetTabsContent>
                      </Snippet>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </Section>
      </main>
      <Footer />
    </>
  );
}
