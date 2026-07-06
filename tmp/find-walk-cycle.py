from pathlib import Path
from PIL import Image, ImageChops, ImageStat

paths = sorted(Path("public/assets/player/chenmian/_work/walk/raw").glob("*.png"))
frames = [Image.open(path).convert("RGB").resize((140, 188)) for path in paths]

scores = []
for lag in range(12, 37):
    errors = []
    for i in range(len(frames) - lag):
        stat = ImageStat.Stat(ImageChops.difference(frames[i], frames[i + lag]))
        errors.append(sum(value * value for value in stat.rms) / 3)
    scores.append((sum(errors) / len(errors), lag))

for score, lag in sorted(scores)[:10]:
    print(f"lag={lag:2d} mean_squared_difference={score:.2f}")
