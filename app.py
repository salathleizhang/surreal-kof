#!/usr/bin/env python3
"""Real-time, rule-based single-person action recognition demo.

Run:
    python app.py

Controls:
    Q / Esc  quit
    R        reset counters

Threshold tuning guide (all tunables live in this section):
    - Speeds are measured in shoulder-widths per second, not pixels per frame,
      so moving nearer to the camera does not completely change the thresholds.
    - ELBOW_SPEED_THRESHOLD: lower if elbow strikes are missed; raise if quick
      arm movements trigger accidentally.
    - ELBOW_SHOULDER_RATIO_THRESHOLD: raise to reject whole-body movement.
    - IRON_SHOULDER_SPEED_THRESHOLD: lower if shoulder charges are missed.
    - IRON_*_COSINE_MIN: raise to demand more parallel shoulder/hip movement.
    - Finger angles are in degrees. Raise *_STRAIGHT_ANGLE_MIN to make the
      middle-finger straightness test stricter; lower *_CURLED_ANGLE_MAX to
      require the other fingers to be more tightly folded.

This is deliberately a no-training classifier: MediaPipe supplies pretrained
landmarks, while all action decisions below are transparent geometric rules.
"""

import argparse
import json
import math
import sys
import time
from collections import deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Deque, Dict, Iterable, Optional, Sequence, Tuple
from urllib.parse import urlparse

import cv2
import mediapipe as mp
import numpy as np


# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------

# Camera / inference. 640x480 keeps CPU cost controlled. Complexity 1 is the
# full pose model bundled inside the pinned MediaPipe wheel; complexity 0 would
# be lighter, but MediaPipe downloads that model on first run.
CAMERA_INDEX = 0
FRAME_WIDTH = 640
FRAME_HEIGHT = 480
MODEL_COMPLEXITY = 1
MIN_DETECTION_CONFIDENCE = 0.55
MIN_TRACKING_CONFIDENCE = 0.55
POSE_VISIBILITY_MIN = 0.55
MIN_SHOULDER_WIDTH = 0.075
MIN_FRAME_DELTA_SECONDS = 1.0 / 120.0
MAX_FRAME_DELTA_SECONDS = 0.20

# Browser mode. The service only listens on loopback by default. Chrome owns
# camera capture, while Python receives compressed frames over localhost.
WEB_HOST = "127.0.0.1"
WEB_PORT = 8765
WEB_MAX_FRAME_BYTES = 2 * 1024 * 1024
WEB_JPEG_QUALITY = 84

# Dynamic detectors use recent history. At ~30 FPS, 8 frames is ~0.27 seconds.
WINDOW_FRAMES = 8
PEAK_AVERAGE_FRAMES = 2
COOLDOWN_SECONDS = 0.65
EVENT_FLASH_SECONDS = 0.40
SPEED_RESET_RATIO = 0.55

# Elbow strike: normalized elbow speed plus elbow-vs-shoulder separation.
# ELBOW_EXTENSION_BONUS_DEG is diagnostic/bonus evidence, not a hard gate,
# because a real elbow strike often keeps the arm bent.
ELBOW_SPEED_THRESHOLD = 1.45
ELBOW_SHOULDER_RATIO_THRESHOLD = 2.35
ELBOW_EXTENSION_BONUS_DEG = 18.0
SPEED_EPSILON = 0.08

# Iron-mountain/shoulder charge: both shoulders must travel together, mainly
# sideways, and hips must show supporting torso motion. Cosines range -1..1.
IRON_SHOULDER_SPEED_THRESHOLD = 0.72
IRON_HIP_SPEED_MIN = 0.10
IRON_SHOULDER_COSINE_MIN = 0.55
IRON_TORSO_COSINE_MIN = 0.20
IRON_HORIZONTAL_RATIO_MIN = 0.55

# Middle-finger pose. The detector itself is frame-based. HOLD=1 preserves the
# requested single-frame behavior; RELEASE adds hysteresis so one tracker blink
# does not count the same held gesture twice.
MIDDLE_HOLD_FRAMES = 1
MIDDLE_RELEASE_FRAMES = 3
FINGER_STRAIGHT_ANGLE_MIN = 155.0
FINGER_CURLED_ANGLE_MAX = 145.0
MIDDLE_TIP_PALM_RATIO_MIN = 1.15
MIDDLE_TIP_WRIST_RATIO_MIN = 1.06
CURLED_TIP_PALM_RATIO_MAX = 1.35
THUMB_TIP_PALM_RATIO_MAX = 1.15
THUMB_TIP_INDEX_RATIO_MAX = 0.92

# UI.
OVERLAY_ALPHA = 0.70
PANEL_WIDTH = 440
FONT = cv2.FONT_HERSHEY_SIMPLEX
COLOR_WHITE = (245, 245, 245)
COLOR_MUTED = (175, 185, 195)
COLOR_READY = (90, 220, 120)
COLOR_ACTIVE = (0, 215, 255)
COLOR_COOLDOWN = (110, 150, 255)
COLOR_ALERT = (40, 40, 255)


mp_drawing = mp.solutions.drawing_utils
mp_drawing_styles = mp.solutions.drawing_styles
mp_holistic = mp.solutions.holistic


LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24


def as_point(landmarks: Sequence, index: int) -> np.ndarray:
    """Return one normalized landmark as a 2D float vector."""
    landmark = landmarks[index]
    return np.array((landmark.x, landmark.y), dtype=np.float64)


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = float(np.linalg.norm(a) * np.linalg.norm(b))
    if denom < 1e-8:
        return -1.0
    return float(np.clip(np.dot(a, b) / denom, -1.0, 1.0))


def joint_angle(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    """Angle ABC in degrees, in the image plane."""
    ba = a - b
    bc = c - b
    denom = float(np.linalg.norm(ba) * np.linalg.norm(bc))
    if denom < 1e-8:
        return 0.0
    return math.degrees(math.acos(float(np.clip(np.dot(ba, bc) / denom, -1, 1))))


def ordered_gain(values: Sequence[float]) -> float:
    """Largest increase where the smaller angle occurs earlier in time."""
    if len(values) < 2:
        return 0.0
    low = float(values[0])
    gain = 0.0
    for value in values[1:]:
        value = float(value)
        gain = max(gain, value - low)
        low = min(low, value)
    return gain


@dataclass
class FeatureSample:
    timestamp: float
    left_elbow_speed: float = 0.0
    right_elbow_speed: float = 0.0
    left_shoulder_speed: float = 0.0
    right_shoulder_speed: float = 0.0
    left_elbow_angle: float = 0.0
    right_elbow_angle: float = 0.0
    shoulder_mid_speed: float = 0.0
    hip_mid_speed: float = 0.0
    shoulder_alignment: float = -1.0
    torso_alignment: float = -1.0
    horizontal_ratio: float = 0.0
    valid_left_arm: bool = False
    valid_right_arm: bool = False
    valid_torso: bool = False


class PoseFeatures:
    """Convert Holistic pose landmarks into normalized frame-to-frame motion."""

    TRACKED = (
        LEFT_SHOULDER,
        RIGHT_SHOULDER,
        LEFT_ELBOW,
        RIGHT_ELBOW,
        LEFT_WRIST,
        RIGHT_WRIST,
        LEFT_HIP,
        RIGHT_HIP,
    )

    def __init__(self) -> None:
        self.previous_points: Optional[Dict[int, np.ndarray]] = None
        self.previous_visibility: Optional[Dict[int, bool]] = None
        self.previous_timestamp: Optional[float] = None

    def reset(self) -> None:
        self.previous_points = None
        self.previous_visibility = None
        self.previous_timestamp = None

    def update(self, landmarks: Optional[Sequence], now: float) -> FeatureSample:
        if landmarks is None:
            self.reset()
            return FeatureSample(timestamp=now)

        points = {index: as_point(landmarks, index) for index in self.TRACKED}
        visible = {
            index: float(getattr(landmarks[index], "visibility", 1.0))
            >= POSE_VISIBILITY_MIN
            for index in self.TRACKED
        }

        shoulder_width = distance(points[LEFT_SHOULDER], points[RIGHT_SHOULDER])
        width_ok = shoulder_width >= MIN_SHOULDER_WIDTH
        left_angle = joint_angle(
            points[LEFT_SHOULDER], points[LEFT_ELBOW], points[LEFT_WRIST]
        )
        right_angle = joint_angle(
            points[RIGHT_SHOULDER], points[RIGHT_ELBOW], points[RIGHT_WRIST]
        )

        sample = FeatureSample(
            timestamp=now,
            left_elbow_angle=left_angle,
            right_elbow_angle=right_angle,
        )

        if self.previous_points is not None and self.previous_timestamp is not None:
            dt = float(
                np.clip(
                    now - self.previous_timestamp,
                    MIN_FRAME_DELTA_SECONDS,
                    MAX_FRAME_DELTA_SECONDS,
                )
            )
            scale = max(shoulder_width, MIN_SHOULDER_WIDTH)

            def velocity(index: int) -> np.ndarray:
                return (points[index] - self.previous_points[index]) / (dt * scale)

            def pair_visible(indices: Iterable[int]) -> bool:
                assert self.previous_visibility is not None
                return width_ok and all(
                    visible[index] and self.previous_visibility[index] for index in indices
                )

            left_valid = pair_visible((LEFT_SHOULDER, LEFT_ELBOW, LEFT_WRIST))
            right_valid = pair_visible((RIGHT_SHOULDER, RIGHT_ELBOW, RIGHT_WRIST))
            torso_valid = pair_visible(
                (LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP)
            )

            if left_valid:
                sample.left_elbow_speed = float(np.linalg.norm(velocity(LEFT_ELBOW)))
                sample.left_shoulder_speed = float(np.linalg.norm(velocity(LEFT_SHOULDER)))
                sample.valid_left_arm = True
            if right_valid:
                sample.right_elbow_speed = float(np.linalg.norm(velocity(RIGHT_ELBOW)))
                sample.right_shoulder_speed = float(np.linalg.norm(velocity(RIGHT_SHOULDER)))
                sample.valid_right_arm = True

            if torso_valid:
                left_shoulder_velocity = velocity(LEFT_SHOULDER)
                right_shoulder_velocity = velocity(RIGHT_SHOULDER)
                left_hip_velocity = velocity(LEFT_HIP)
                right_hip_velocity = velocity(RIGHT_HIP)
                shoulder_mid_velocity = (left_shoulder_velocity + right_shoulder_velocity) / 2
                hip_mid_velocity = (left_hip_velocity + right_hip_velocity) / 2

                sample.shoulder_mid_speed = float(np.linalg.norm(shoulder_mid_velocity))
                sample.hip_mid_speed = float(np.linalg.norm(hip_mid_velocity))
                sample.shoulder_alignment = cosine(
                    left_shoulder_velocity, right_shoulder_velocity
                )
                sample.torso_alignment = cosine(shoulder_mid_velocity, hip_mid_velocity)
                shoulder_norm = float(np.linalg.norm(shoulder_mid_velocity))
                sample.horizontal_ratio = (
                    abs(float(shoulder_mid_velocity[0])) / shoulder_norm
                    if shoulder_norm > 1e-8
                    else 0.0
                )
                sample.valid_torso = True

        self.previous_points = points
        self.previous_visibility = visible
        self.previous_timestamp = now
        return sample


@dataclass
class HandResult:
    gesture: bool = False
    middle_angle: float = 0.0
    folded_count: int = 0


class MiddleFingerDetector:
    """Recognize one straight middle finger with all four others folded."""

    # MCP, PIP, DIP, TIP for the four non-thumb fingers.
    FINGERS = {
        "index": (5, 6, 7, 8),
        "middle": (9, 10, 11, 12),
        "ring": (13, 14, 15, 16),
        "pinky": (17, 18, 19, 20),
    }

    def __init__(self) -> None:
        self.active = False
        self.hold_frames = 0
        self.release_frames = 0

    @staticmethod
    def analyze_hand(landmarks: Sequence) -> HandResult:
        points = [as_point(landmarks, index) for index in range(21)]
        palm_center = np.mean([points[index] for index in (0, 5, 9, 13, 17)], axis=0)
        palm_size = distance(points[0], points[9])
        if palm_size < 1e-4:
            return HandResult()

        finger_state: Dict[str, Tuple[bool, bool, float]] = {}
        for name, (mcp, pip, dip, tip) in MiddleFingerDetector.FINGERS.items():
            pip_angle = joint_angle(points[mcp], points[pip], points[dip])
            dip_angle = joint_angle(points[pip], points[dip], points[tip])
            tip_palm_ratio = distance(points[tip], palm_center) / palm_size
            straight = (
                pip_angle >= FINGER_STRAIGHT_ANGLE_MIN
                and dip_angle >= FINGER_STRAIGHT_ANGLE_MIN
                and tip_palm_ratio >= MIDDLE_TIP_PALM_RATIO_MIN
                and distance(points[tip], points[0])
                > MIDDLE_TIP_WRIST_RATIO_MIN * distance(points[pip], points[0])
            )
            curled = (
                min(pip_angle, dip_angle) <= FINGER_CURLED_ANGLE_MAX
                and tip_palm_ratio <= CURLED_TIP_PALM_RATIO_MAX
            )
            finger_state[name] = (straight, curled, min(pip_angle, dip_angle))

        thumb_tip_palm_ratio = distance(points[4], palm_center) / palm_size
        thumb_tip_index_ratio = distance(points[4], points[5]) / palm_size
        # A tucked thumb is often straight while lying across the folded
        # fingers, so distance-to-palm is more reliable here than joint angle.
        thumb_curled = (
            thumb_tip_palm_ratio <= THUMB_TIP_PALM_RATIO_MAX
            or thumb_tip_index_ratio <= THUMB_TIP_INDEX_RATIO_MAX
        )

        other_curled = [
            finger_state[name][1] for name in ("index", "ring", "pinky")
        ]
        folded_count = sum(other_curled) + int(thumb_curled)
        gesture = finger_state["middle"][0] and folded_count == 4
        return HandResult(
            gesture=gesture,
            middle_angle=finger_state["middle"][2],
            folded_count=folded_count,
        )

    def update(self, hands: Sequence[Optional[Sequence]]) -> Tuple[bool, bool, HandResult]:
        results = [self.analyze_hand(hand) for hand in hands if hand is not None]
        best = max(results, key=lambda item: (item.gesture, item.folded_count), default=HandResult())
        detected = any(item.gesture for item in results)
        triggered = False

        if detected:
            self.hold_frames += 1
            self.release_frames = 0
            if not self.active and self.hold_frames >= MIDDLE_HOLD_FRAMES:
                self.active = True
                triggered = True
        else:
            self.hold_frames = 0
            if self.active:
                self.release_frames += 1
                if self.release_frames >= MIDDLE_RELEASE_FRAMES:
                    self.active = False
                    self.release_frames = 0

        return self.active, triggered, best


@dataclass
class ElbowMetrics:
    side: str = "-"
    elbow_speed: float = 0.0
    shoulder_speed: float = 0.0
    ratio: float = 0.0
    angle_gain: float = 0.0


class ElbowStrikeDetector:
    def __init__(self) -> None:
        self.armed = True

    @staticmethod
    def side_metrics(samples: Sequence[FeatureSample], side: str) -> ElbowMetrics:
        valid_key = "valid_{}_arm".format(side)
        elbow_key = "{}_elbow_speed".format(side)
        shoulder_key = "{}_shoulder_speed".format(side)
        angle_key = "{}_elbow_angle".format(side)
        valid = [sample for sample in samples if getattr(sample, valid_key)]
        if not valid:
            return ElbowMetrics(side=side)

        elbow_values = [getattr(sample, elbow_key) for sample in valid]
        order = np.argsort(elbow_values)[::-1][: min(PEAK_AVERAGE_FRAMES, len(valid))]
        elbow_speed = float(np.mean([elbow_values[index] for index in order]))
        shoulder_speed = float(
            np.mean([getattr(valid[index], shoulder_key) for index in order])
        )
        angles = [getattr(sample, angle_key) for sample in valid]
        return ElbowMetrics(
            side=side,
            elbow_speed=elbow_speed,
            shoulder_speed=shoulder_speed,
            ratio=elbow_speed / max(shoulder_speed, SPEED_EPSILON),
            angle_gain=ordered_gain(angles),
        )

    def evaluate(
        self, samples: Sequence[FeatureSample], suppressed: bool
    ) -> Tuple[bool, bool, ElbowMetrics]:
        left = self.side_metrics(samples, "left")
        right = self.side_metrics(samples, "right")
        metrics = max(
            (left, right),
            key=lambda item: item.elbow_speed / max(ELBOW_SPEED_THRESHOLD, 1e-8),
        )
        raw_active = (
            metrics.elbow_speed >= ELBOW_SPEED_THRESHOLD
            and metrics.ratio >= ELBOW_SHOULDER_RATIO_THRESHOLD
        )

        if suppressed:
            # Prevent the tail of a shoulder charge from firing as an elbow strike.
            self.armed = False
            return False, False, metrics

        triggered = raw_active and self.armed
        if triggered:
            self.armed = False
        elif not raw_active and metrics.elbow_speed < ELBOW_SPEED_THRESHOLD * SPEED_RESET_RATIO:
            self.armed = True
        return raw_active, triggered, metrics


@dataclass
class IronMetrics:
    shoulder_speed: float = 0.0
    hip_speed: float = 0.0
    shoulder_alignment: float = -1.0
    torso_alignment: float = -1.0
    horizontal_ratio: float = 0.0


class IronMountainDetector:
    def __init__(self) -> None:
        self.armed = True

    @staticmethod
    def metrics(samples: Sequence[FeatureSample]) -> IronMetrics:
        valid = [sample for sample in samples if sample.valid_torso]
        if not valid:
            return IronMetrics()

        shoulder_values = [sample.shoulder_mid_speed for sample in valid]
        order = np.argsort(shoulder_values)[::-1][: min(PEAK_AVERAGE_FRAMES, len(valid))]

        def average(attribute: str) -> float:
            return float(np.mean([getattr(valid[index], attribute) for index in order]))

        return IronMetrics(
            shoulder_speed=average("shoulder_mid_speed"),
            hip_speed=average("hip_mid_speed"),
            shoulder_alignment=average("shoulder_alignment"),
            torso_alignment=average("torso_alignment"),
            horizontal_ratio=average("horizontal_ratio"),
        )

    def evaluate(
        self, samples: Sequence[FeatureSample]
    ) -> Tuple[bool, bool, IronMetrics]:
        metrics = self.metrics(samples)
        raw_active = (
            metrics.shoulder_speed >= IRON_SHOULDER_SPEED_THRESHOLD
            and metrics.hip_speed >= IRON_HIP_SPEED_MIN
            and metrics.shoulder_alignment >= IRON_SHOULDER_COSINE_MIN
            and metrics.torso_alignment >= IRON_TORSO_COSINE_MIN
            and metrics.horizontal_ratio >= IRON_HORIZONTAL_RATIO_MIN
        )
        triggered = raw_active and self.armed
        if triggered:
            self.armed = False
        elif (
            not raw_active
            and metrics.shoulder_speed
            < IRON_SHOULDER_SPEED_THRESHOLD * SPEED_RESET_RATIO
        ):
            self.armed = True
        return raw_active, triggered, metrics


class CooldownManager:
    def __init__(self, actions: Sequence[str]) -> None:
        self.last_trigger = {action: -math.inf for action in actions}

    def ready(self, action: str, now: float) -> bool:
        return now - self.last_trigger[action] >= COOLDOWN_SECONDS

    def remaining(self, action: str, now: float) -> float:
        return max(0.0, COOLDOWN_SECONDS - (now - self.last_trigger[action]))

    def trigger(self, action: str, now: float) -> bool:
        if not self.ready(action, now):
            return False
        self.last_trigger[action] = now
        return True

    def reset(self) -> None:
        for action in self.last_trigger:
            self.last_trigger[action] = -math.inf


def draw_skeleton(frame: np.ndarray, results) -> None:
    if results.pose_landmarks:
        mp_drawing.draw_landmarks(
            frame,
            results.pose_landmarks,
            mp_holistic.POSE_CONNECTIONS,
            landmark_drawing_spec=mp_drawing_styles.get_default_pose_landmarks_style(),
        )
    for hand, color in (
        (results.left_hand_landmarks, (70, 255, 70)),
        (results.right_hand_landmarks, (255, 160, 70)),
    ):
        if hand:
            mp_drawing.draw_landmarks(
                frame,
                hand,
                mp_holistic.HAND_CONNECTIONS,
                landmark_drawing_spec=mp_drawing.DrawingSpec(color=color, thickness=2, circle_radius=2),
                connection_drawing_spec=mp_drawing.DrawingSpec(color=color, thickness=2),
            )


def put_text(
    frame: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: Tuple[int, int, int] = COLOR_WHITE,
    scale: float = 0.48,
    thickness: int = 1,
) -> None:
    cv2.putText(frame, text, (x, y), FONT, scale, (0, 0, 0), thickness + 2, cv2.LINE_AA)
    cv2.putText(frame, text, (x, y), FONT, scale, color, thickness, cv2.LINE_AA)


def action_status(
    action: str, active: bool, cooldowns: CooldownManager, now: float
) -> Tuple[str, Tuple[int, int, int]]:
    if active:
        return "ACTIVE", COLOR_ACTIVE
    remaining = cooldowns.remaining(action, now)
    if remaining > 0:
        return "COOLDOWN {:.1f}s".format(remaining), COLOR_COOLDOWN
    return "READY", COLOR_READY


def draw_overlay(
    frame: np.ndarray,
    fps: float,
    counts: Dict[str, int],
    middle_active: bool,
    middle_metrics: HandResult,
    elbow_active: bool,
    elbow_metrics: ElbowMetrics,
    iron_active: bool,
    iron_metrics: IronMetrics,
    cooldowns: CooldownManager,
    now: float,
    last_event: Optional[str],
    last_event_time: float,
    controls_text: str = "Q/Esc quit    R reset counters",
) -> None:
    height, width = frame.shape[:2]
    panel_width = min(PANEL_WIDTH, width)
    panel_height = min(320, height)
    layer = frame.copy()
    cv2.rectangle(layer, (0, 0), (panel_width, panel_height), (15, 20, 28), -1)
    cv2.addWeighted(layer, OVERLAY_ALPHA, frame, 1.0 - OVERLAY_ALPHA, 0, frame)

    put_text(frame, "RULE-BASED ACTION RECOGNITION", 14, 24, COLOR_WHITE, 0.55, 2)
    put_text(frame, "FPS {:4.1f}  window {}f  speed unit: shoulder-width/s".format(fps, WINDOW_FRAMES), 14, 46, COLOR_MUTED, 0.40)

    if iron_active:
        current_action = "IRON MOUNTAIN"
    elif elbow_active:
        current_action = "ELBOW STRIKE"
    elif middle_active:
        current_action = "MIDDLE FINGER"
    else:
        current_action = "NO ACTION"
    put_text(
        frame,
        "CURRENT: {}".format(current_action),
        14,
        68,
        COLOR_ACTIVE if current_action != "NO ACTION" else COLOR_MUTED,
        0.48,
        1,
    )

    rows = (
        ("middle_finger", "MIDDLE FINGER", middle_active, 94),
        ("elbow_strike", "ELBOW STRIKE", elbow_active, 126),
        ("iron_mountain", "IRON MOUNTAIN", iron_active, 158),
    )
    for action, label, active, y in rows:
        status, color = action_status(action, active, cooldowns, now)
        put_text(frame, "{:<15} {:<13} count {:>3}".format(label, status, counts[action]), 14, y, color, 0.48, 1)

    put_text(
        frame,
        "hand middle-angle {:5.1f}  folded {}/4".format(
            middle_metrics.middle_angle, middle_metrics.folded_count
        ),
        14,
        190,
        COLOR_MUTED,
        0.43,
    )
    angle_mark = "+ext" if elbow_metrics.angle_gain >= ELBOW_EXTENSION_BONUS_DEG else ""
    put_text(
        frame,
        "elbow[{}] E {:4.2f}/{:.2f}  shoulder {:4.2f}  ratio {:4.2f}/{:.2f} {}".format(
            elbow_metrics.side[0].upper() if elbow_metrics.side != "-" else "-",
            elbow_metrics.elbow_speed,
            ELBOW_SPEED_THRESHOLD,
            elbow_metrics.shoulder_speed,
            elbow_metrics.ratio,
            ELBOW_SHOULDER_RATIO_THRESHOLD,
            angle_mark,
        ),
        14,
        214,
        COLOR_MUTED,
        0.42,
    )
    put_text(
        frame,
        "iron S {:4.2f}/{:.2f}  hip {:4.2f}/{:.2f}".format(
            iron_metrics.shoulder_speed,
            IRON_SHOULDER_SPEED_THRESHOLD,
            iron_metrics.hip_speed,
            IRON_HIP_SPEED_MIN,
        ),
        14,
        238,
        COLOR_MUTED,
        0.43,
    )
    put_text(
        frame,
        "align shoulders {:4.2f}/{:.2f}  torso {:4.2f}/{:.2f}  horizontal {:4.2f}/{:.2f}".format(
            iron_metrics.shoulder_alignment,
            IRON_SHOULDER_COSINE_MIN,
            iron_metrics.torso_alignment,
            IRON_TORSO_COSINE_MIN,
            iron_metrics.horizontal_ratio,
            IRON_HORIZONTAL_RATIO_MIN,
        ),
        14,
        262,
        COLOR_MUTED,
        0.39,
    )
    put_text(frame, controls_text, 14, 298, COLOR_WHITE, 0.44)

    if last_event and now - last_event_time <= EVENT_FLASH_SECONDS:
        cv2.rectangle(frame, (4, 4), (width - 5, height - 5), COLOR_ALERT, 8)
        label = last_event.replace("_", " ").upper()
        (text_width, text_height), _ = cv2.getTextSize(label, FONT, 1.1, 3)
        x = max(10, (width - text_width) // 2)
        y = max(panel_height + text_height + 15, height - 38)
        put_text(frame, label, x, min(y, height - 18), COLOR_ACTIVE, 1.1, 3)


class RecognitionEngine:
    """Stateful Holistic pipeline shared by desktop-camera and browser modes."""

    ACTIONS = ("middle_finger", "elbow_strike", "iron_mountain")

    def __init__(self, controls_text: str = "Q/Esc quit    R reset counters") -> None:
        self.controls_text = controls_text
        self.holistic = mp_holistic.Holistic(
            static_image_mode=False,
            model_complexity=MODEL_COMPLEXITY,
            smooth_landmarks=True,
            enable_segmentation=False,
            refine_face_landmarks=False,
            min_detection_confidence=MIN_DETECTION_CONFIDENCE,
            min_tracking_confidence=MIN_TRACKING_CONFIDENCE,
        )
        self.feature_extractor = PoseFeatures()
        self.middle_detector = MiddleFingerDetector()
        self.elbow_detector = ElbowStrikeDetector()
        self.iron_detector = IronMountainDetector()
        self.window: Deque[FeatureSample] = deque(maxlen=WINDOW_FRAMES)
        self.cooldowns = CooldownManager(self.ACTIONS)
        self.counts = {action: 0 for action in self.ACTIONS}
        self.last_event: Optional[str] = None
        self.last_event_time = -math.inf
        self.fps = 0.0
        self.processed_frames = 0
        self.pose_frames = 0
        self.hand_frames = 0
        self.started = time.perf_counter()
        self.previous_frame_time = self.started

    def reset_counts(self) -> None:
        for action in self.counts:
            self.counts[action] = 0
        self.cooldowns.reset()
        self.last_event = None

    def process(
        self, frame: np.ndarray, mirror: bool = True, annotate: bool = True
    ) -> np.ndarray:
        if mirror:
            frame = cv2.flip(frame, 1)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = self.holistic.process(rgb)
        now = time.perf_counter()

        pose_landmarks = results.pose_landmarks.landmark if results.pose_landmarks else None
        sample = self.feature_extractor.update(pose_landmarks, now)
        self.window.append(sample)

        hands = (
            results.left_hand_landmarks.landmark
            if results.left_hand_landmarks
            else None,
            results.right_hand_landmarks.landmark
            if results.right_hand_landmarks
            else None,
        )
        middle_active, middle_trigger, middle_metrics = self.middle_detector.update(hands)

        # Whole-torso movement wins. Suppression also prevents the remaining
        # window tail from becoming a delayed elbow event.
        iron_active, iron_trigger, iron_metrics = self.iron_detector.evaluate(self.window)
        elbow_active, elbow_trigger, elbow_metrics = self.elbow_detector.evaluate(
            self.window, suppressed=iron_active
        )

        for action, triggered in (
            ("middle_finger", middle_trigger),
            ("iron_mountain", iron_trigger),
            ("elbow_strike", elbow_trigger),
        ):
            if triggered and self.cooldowns.trigger(action, now):
                self.counts[action] += 1
                self.last_event = action
                self.last_event_time = now

        frame_delta = max(now - self.previous_frame_time, 1e-6)
        instant_fps = 1.0 / frame_delta
        self.fps = instant_fps if self.fps <= 0 else self.fps * 0.90 + instant_fps * 0.10
        self.previous_frame_time = now
        self.processed_frames += 1
        self.pose_frames += int(results.pose_landmarks is not None)
        self.hand_frames += int(
            results.left_hand_landmarks is not None
            or results.right_hand_landmarks is not None
        )

        if annotate:
            draw_skeleton(frame, results)
            draw_overlay(
                frame,
                self.fps,
                self.counts,
                middle_active,
                middle_metrics,
                elbow_active,
                elbow_metrics,
                iron_active,
                iron_metrics,
                self.cooldowns,
                now,
                self.last_event,
                self.last_event_time,
                controls_text=self.controls_text,
            )
        return frame

    def close(self) -> None:
        self.holistic.close()


def make_web_handler(engine: RecognitionEngine, page: bytes):
    """Build a synchronous request handler so MediaPipe stays on one thread."""

    class ActionWebHandler(BaseHTTPRequestHandler):
        server_version = "KofActionDemo/1.0"

        def send_bytes(
            self, status: int, content_type: str, payload: bytes, **headers: str
        ) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for name, value in headers.items():
                self.send_header(name.replace("_", "-"), value)
            self.end_headers()
            self.wfile.write(payload)

        def send_json(self, status: int, data: Dict) -> None:
            self.send_bytes(
                status,
                "application/json; charset=utf-8",
                json.dumps(data, ensure_ascii=False).encode("utf-8"),
            )

        def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            path = urlparse(self.path).path
            if path in ("/", "/action"):
                self.send_bytes(200, "text/html; charset=utf-8", page)
                return
            if path == "/health":
                self.send_json(
                    200,
                    {
                        "status": "ok",
                        "model": "mediapipe-holistic",
                        "frame_width": FRAME_WIDTH,
                        "frame_height": FRAME_HEIGHT,
                    },
                )
                return
            if path == "/favicon.ico":
                self.send_bytes(204, "image/x-icon", b"")
                return
            self.send_json(404, {"error": "not found"})

        def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler API
            path = urlparse(self.path).path
            if path == "/api/reset":
                engine.reset_counts()
                self.send_json(200, {"status": "ok", "counts": engine.counts})
                return
            if path != "/api/frame":
                self.send_json(404, {"error": "not found"})
                return

            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            if length <= 0 or length > WEB_MAX_FRAME_BYTES:
                self.send_json(413, {"error": "invalid frame size"})
                return

            encoded = np.frombuffer(self.rfile.read(length), dtype=np.uint8)
            frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
            if frame is None:
                self.send_json(400, {"error": "invalid JPEG frame"})
                return

            try:
                annotated = engine.process(frame, mirror=True, annotate=True)
                ok, output = cv2.imencode(
                    ".jpg",
                    annotated,
                    (cv2.IMWRITE_JPEG_QUALITY, WEB_JPEG_QUALITY),
                )
                if not ok:
                    raise RuntimeError("OpenCV could not encode output frame")
            except Exception as error:  # keep the page alive and expose the cause
                self.send_json(500, {"error": str(error)})
                return

            self.send_bytes(
                200,
                "image/jpeg",
                output.tobytes(),
                X_Recognition_FPS="{:.1f}".format(engine.fps),
            )

        def log_message(self, message: str, *args) -> None:
            if urlparse(self.path).path != "/api/frame":
                super().log_message(message, *args)

    return ActionWebHandler


def open_camera(index: int) -> cv2.VideoCapture:
    # AVFoundation gives more predictable camera behavior on macOS; retain a
    # generic fallback for other platforms and unusual OpenCV builds.
    if sys.platform == "darwin":
        capture = cv2.VideoCapture(index, cv2.CAP_AVFOUNDATION)
        if capture.isOpened():
            return capture
        capture.release()
    return cv2.VideoCapture(index)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--web",
        action="store_true",
        help="serve a browser-camera version on localhost instead of opening OpenCV",
    )
    parser.add_argument(
        "--web-host",
        default=WEB_HOST,
        help="host used by --web (default: %(default)s)",
    )
    parser.add_argument(
        "--web-port",
        type=int,
        default=WEB_PORT,
        help="port used by --web (default: %(default)s)",
    )
    parser.add_argument(
        "--check-camera",
        action="store_true",
        help="process a short camera sample without opening the preview window",
    )
    parser.add_argument(
        "--check-frames",
        type=int,
        default=45,
        help="number of frames used by --check-camera (default: 45)",
    )
    parser.add_argument(
        "--camera-index",
        type=int,
        default=CAMERA_INDEX,
        help="camera device index (default: %(default)s)",
    )
    return parser.parse_args()


def run_web(args: argparse.Namespace) -> int:
    page_path = Path(__file__).with_name("action_web.html")
    if not page_path.is_file():
        print("Missing browser page: {}".format(page_path), file=sys.stderr)
        return 2

    engine: Optional[RecognitionEngine] = None
    server: Optional[HTTPServer] = None
    try:
        engine = RecognitionEngine(controls_text="Use page controls to stop / reset")
        handler = make_web_handler(engine, page_path.read_bytes())
        server = HTTPServer((args.web_host, args.web_port), handler)
        url = "http://{}:{}/".format(args.web_host, args.web_port)
        print("KOF AI browser demo: {}".format(url), flush=True)
        print("Press Ctrl+C to stop the service.", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError as error:
        print("Could not start web service: {}".format(error), file=sys.stderr)
        return 2
    finally:
        if server is not None:
            server.server_close()
        if engine is not None:
            engine.close()
    return 0


def run_desktop(args: argparse.Namespace) -> int:
    capture = open_camera(args.camera_index)
    capture.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
    capture.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    if not capture.isOpened():
        print(
            "Could not open camera {}. Check macOS Privacy & Security > Camera "
            "permission, or try --camera-index 1.".format(args.camera_index),
            file=sys.stderr,
        )
        return 2

    engine: Optional[RecognitionEngine] = None
    try:
        engine = RecognitionEngine()
        while capture.isOpened():
            ok, frame = capture.read()
            if not ok:
                print("Camera returned an empty frame.", file=sys.stderr)
                break

            frame = engine.process(frame, mirror=True, annotate=not args.check_camera)
            if args.check_camera:
                if engine.processed_frames >= max(1, args.check_frames):
                    elapsed = max(time.perf_counter() - engine.started, 1e-6)
                    print(
                        "camera_check=ok frames={} avg_fps={:.1f} pose_frames={} hand_frames={}".format(
                            engine.processed_frames,
                            engine.processed_frames / elapsed,
                            engine.pose_frames,
                            engine.hand_frames,
                        )
                    )
                    return 0
                continue

            cv2.imshow("KOF AI - Action Recognition", frame)
            key = cv2.waitKey(1) & 0xFF
            if key in (27, ord("q"), ord("Q")):
                break
            if key in (ord("r"), ord("R")):
                engine.reset_counts()
    except KeyboardInterrupt:
        pass
    finally:
        capture.release()
        if engine is not None:
            engine.close()
        cv2.destroyAllWindows()
    return 0


def run() -> int:
    args = parse_args()
    if args.web:
        return run_web(args)
    return run_desktop(args)


if __name__ == "__main__":
    raise SystemExit(run())
