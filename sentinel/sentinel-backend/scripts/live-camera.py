"""External RTSP capture + local YOLO. Each JSON line pairs one JPEG with its exact boxes.

性能设计（CPU 环境）：
- 采集、检测、输出三段解耦。采集线程只保留最新帧；检测线程持续推理并保存
  最近一次结果；主线程按目标帧率编码并输出视频，因此视频流畅度不再被推理
  耗时拖慢，检测框按推理速度刷新。
- 推理尺寸与线程数可通过环境变量调整：CAMERA_IMGSZ（默认 416）、
  CAMERA_CPU_THREADS（默认 4）。降低 imgsz 可进一步提高检测刷新率。
"""
import base64
import contextlib
import json
import os
from pathlib import Path
import sys
import threading
import time

os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
os.environ.setdefault("OPENCV_FFMPEG_THREADS", "1")
os.environ.setdefault("YOLO_AUTOINSTALL", "false")
import cv2
import numpy as np

cv2.setNumThreads(1)

url = os.environ["CAMERA_RTSP_URL"]
if not url.startswith(("rtsp://", "rtsps://")):
    raise ValueError("CAMERA_RTSP_URL must be an RTSP address")
fps = min(15, max(1, float(os.environ.get("CAMERA_FPS", "15"))))
cpu_threads = min(8, max(1, int(os.environ.get("CAMERA_CPU_THREADS", "4"))))
imgsz = min(640, max(320, int(os.environ.get("CAMERA_IMGSZ", "416"))))
jpeg_quality = min(95, max(60, int(os.environ.get("CAMERA_JPEG_QUALITY", "83"))))

latest = None                 # (captured_at, frame) 采集线程写入
lock = threading.Lock()
stop = threading.Event()

det_lock = threading.Lock()   # 检测线程写入、输出线程读取
det_state = {"captured": 0.0, "detections": [], "active": False, "inference_ms": 0.0}

# 保存真实 stdout 句柄：contextlib.redirect_stdout 是全局替换 sys.stdout，
# 检测线程推理时若主线程用 print 输出，JSON 会被重定向到 stderr 导致数据丢失。
STDOUT = sys.stdout


def emit(value):
    STDOUT.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n")
    STDOUT.flush()


def capture():
    global latest
    while not stop.is_set():
        params = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000, cv2.CAP_PROP_READ_TIMEOUT_MSEC, 3000]
        # Frame-thread decoding buffered 15 frames (~600 ms at 25 Hz) on this camera.
        # The environment fallback also supports older OpenCV builds.
        if hasattr(cv2, "CAP_PROP_N_THREADS"):
            params += [cv2.CAP_PROP_N_THREADS, 1]
        video = cv2.VideoCapture(url, cv2.CAP_FFMPEG, params)
        warm_until = time.monotonic() + 2  # Wait for a complete initial H.265 GOP.
        try:
            while video.isOpened() and not stop.is_set():
                ok, frame = video.read()
                if not ok:
                    break
                if time.monotonic() >= warm_until:
                    with lock:
                        latest = (time.time(), frame)
        finally:
            video.release()
            with lock:
                latest = None
        stop.wait(1)


def iou(a, b):
    x = max(0, min(a[0]+a[2], b[0]+b[2])-max(a[0], b[0]))
    y = max(0, min(a[1]+a[3], b[1]+b[3])-max(a[1], b[1]))
    area = x*y
    return area / max(1, a[2]*a[3]+b[2]*b[3]-area)


threading.Thread(target=capture, daemon=True).start()


def parent_lifetime():
    # Closing the backend also closes this pipe on Windows. Do not leave a camera
    # process running when the parent is force-terminated while the camera is offline.
    sys.stdin.read()
    stop.set()


threading.Thread(target=parent_lifetime, daemon=True).start()
emit({"type": "camera_status", "state": "connecting", "message": "正在连接网络视频并加载本机检测模型"})

model = None
device = "cpu"
model_path = os.environ.get("CAMERA_MODEL_PATH", "")
if model_path and Path(model_path).is_file():
    try:
        # Third-party status text must not corrupt the JSON stdout transport.
        with contextlib.redirect_stdout(sys.stderr):
            from ultralytics import YOLO
            import torch
            torch.set_num_threads(cpu_threads)
            device = 0 if torch.cuda.is_available() else "cpu"
            model = YOLO(model_path)
            # Ultralytics resets CPU threads during predictor setup. Set the
            # measured low-latency thread count after setup, before live inference.
            model.predict(np.zeros((448, 800, 3), dtype=np.uint8), imgsz=imgsz,
                          conf=0.3, classes=[0,1,2,3,5,7], max_det=100, device=device, verbose=False)
            if device == "cpu":
                torch.set_num_threads(cpu_threads)
    except Exception:
        model = None
        emit({"type": "camera_status", "state": "connecting", "message": "检测模型未就绪，先显示实时视频"})


def detect():
    """持续对最新帧做推理，结果写入 det_state。"""
    global model
    tracks = {}
    next_track = 0
    last_stamp = 0
    while not stop.is_set():
        with lock:
            item = latest
        if item is None or item[0] == last_stamp or time.time() - item[0] > 1:
            stop.wait(0.02)
            continue
        captured, frame = item
        last_stamp = captured
        detections = []
        inference_start = time.perf_counter()
        if model is not None:
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    result = model.predict(frame, imgsz=imgsz, conf=0.3, classes=[0,1,2,3,5,7],
                                           max_det=100, device=device, verbose=False)[0]
                used = set()
                stale = [k for k, v in tracks.items() if captured - v["time"] >= 0.75]
                for key in stale:
                    del tracks[key]
                for box in result.boxes.data.cpu().tolist():
                    x1,y1,x2,y2,score,cls = box
                    rect = [x1,y1,x2-x1,y2-y1]
                    label = result.names[int(cls)]
                    candidates = [(iou(rect,v["box"]),k) for k,v in tracks.items()
                                  if k not in used and v["label"] == label]
                    best = max(candidates, default=(0,None))
                    if best[0] >= 0.3:
                        track = best[1]
                    else:
                        next_track += 1
                        track = f"V{next_track:05d}"
                    used.add(track)
                    tracks[track] = {"box":rect,"label":label,"time":captured}
                    detections.append(dict(zip(("x","y","width","height"),rect),
                                           score=score,label=label,track_id=track))
            except Exception:
                model = None
                detections = []
        inference_ms = (time.perf_counter() - inference_start) * 1000
        # Keep one latest input; never replay an inference backlog.
        with det_lock:
            det_state["captured"] = captured
            det_state["detections"] = detections
            det_state["active"] = model is not None
            det_state["inference_ms"] = inference_ms


if model is not None:
    threading.Thread(target=detect, daemon=True).start()

sequence = 0
try:
    while not stop.is_set():
        tick = time.monotonic()
        with lock:
            item = latest
        if item is None or time.time() - item[0] > 1:
            stop.wait(0.02)
            continue
        captured, frame = item
        with det_lock:
            det_captured = det_state["captured"]
            detections = det_state["detections"]
            active = det_state["active"]
            inference_ms = det_state["inference_ms"]
        # 检测框只在与当前帧足够接近时附加，避免画面和框错位过大。
        fresh = detections and captured - det_captured <= 0.6
        encode_start = time.perf_counter()
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        encode_ms = (time.perf_counter() - encode_start) * 1000
        if ok:
            sequence += 1
            emit({"type":"camera_frame","sequence":sequence,"capturedAt":round(captured*1000),
                  "width":frame.shape[1],"height":frame.shape[0],
                  "detections":detections if fresh else [],
                  "detector":"YOLOv8 · 本机推理" if active else "未启用",
                  "timing":{"inferenceMs":round(inference_ms,1),"encodeMs":round(encode_ms,1),
                            "processingMs":round((time.time()-captured)*1000,1),
                            "decodeThreads":1,"inferenceThreads":cpu_threads if device == "cpu" else 0},
                  "jpeg":base64.b64encode(jpeg).decode("ascii")})
        stop.wait(max(0, 1/fps-(time.monotonic()-tick)))
finally:
    stop.set()
