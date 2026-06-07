
from PIL import Image
import os

INPUT_PATH = "icons/icon.jpg"

# 1. 生成程序图标（多尺寸 .ico）
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
images = []

img = Image.open(INPUT_PATH)
for size in ico_sizes:
    resized = img.resize(size, Image.Resampling.LANCZOS)
    images.append(resized)

ico_output = "resources/icon.ico"
images[0].save(
    ico_output,
    format='ICO',
    sizes=[(img.width, img.height) for img in images],
    append_images=images[1:]
)
print(f"✅ 生成程序图标: {ico_output}")

# 2. 生成插件图标（多尺寸 PNG）
png_sizes = [(16, 16), (48, 48), (128, 128)]
png_outputs = {
    (16, 16): "icons/icon16.png",
    (48, 48): "icons/icon48.png",
    (128, 128): "icons/icon128.png"
}

for size in png_sizes:
    resized = img.resize(size, Image.Resampling.LANCZOS)
    output_path = png_outputs[size]
    resized.save(output_path, format='PNG')
    print(f"✅ 生成插件图标: {output_path}")

print("\n🎉 图标转换完成！")
