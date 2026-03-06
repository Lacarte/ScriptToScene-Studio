"""
Video Processor
FFmpeg-based video processing for scene assembly and effects
"""

import os
import re
import subprocess
import tempfile
import shutil
from PIL import Image, ImageDraw, ImageFont
import platform
import sys
from loguru import logger

# Ensure project root is on sys.path so we can import studio modules
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from studio.fonts import get_font_path as _custom_font_path

# Check if ffmpeg-python is available, fallback to subprocess
try:
    import ffmpeg
    USE_FFMPEG_PYTHON = True
except ImportError:
    USE_FFMPEG_PYTHON = False
    logger.warning("ffmpeg-python not installed, using subprocess fallback")


def _find_ffmpeg():
    """Locate ffmpeg binary: project bin/ first, then system PATH."""
    from config import BIN_DIR
    exe = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
    local = os.path.join(BIN_DIR, exe)
    if os.path.isfile(local):
        logger.info("FFmpeg found in bin/: {}", local)
        return local
    found = shutil.which("ffmpeg")
    if found:
        logger.info("FFmpeg found on PATH: {}", found)
        return found
    logger.error("FFmpeg not found in bin/ or PATH")
    return None


FFMPEG_BIN = _find_ffmpeg() or "ffmpeg"


# Font family mapping: frontend name -> system font paths by OS
# These match the fonts available in the frontend preview.js
FONT_MAP = {
    'Inter': {
        'win32': ['C:/Windows/Fonts/Inter-Regular.ttf', 'C:/Windows/Fonts/segoeui.ttf', 'arial.ttf'],
        'darwin': ['/System/Library/Fonts/SFCompact.ttf', '/Library/Fonts/Inter-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/inter/Inter-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    },
    'Roboto': {
        'win32': ['C:/Windows/Fonts/Roboto-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Roboto-Regular.ttf', '/System/Library/Fonts/Helvetica.ttc'],
        'linux': ['/usr/share/fonts/truetype/roboto/Roboto-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
    },
    'Open Sans': {
        'win32': ['C:/Windows/Fonts/OpenSans-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/OpenSans-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/open-sans/OpenSans-Regular.ttf']
    },
    'Montserrat': {
        'win32': ['C:/Windows/Fonts/Montserrat-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Montserrat-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/montserrat/Montserrat-Regular.ttf']
    },
    'Poppins': {
        'win32': ['C:/Windows/Fonts/Poppins-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Poppins-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/poppins/Poppins-Regular.ttf']
    },
    'Playfair Display': {
        'win32': ['C:/Windows/Fonts/PlayfairDisplay-Regular.ttf', 'times.ttf'],
        'darwin': ['/Library/Fonts/PlayfairDisplay-Regular.ttf', '/System/Library/Fonts/Times.ttc'],
        'linux': ['/usr/share/fonts/truetype/playfair-display/PlayfairDisplay-Regular.ttf']
    },
    'Merriweather': {
        'win32': ['C:/Windows/Fonts/Merriweather-Regular.ttf', 'times.ttf'],
        'darwin': ['/Library/Fonts/Merriweather-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/merriweather/Merriweather-Regular.ttf']
    },
    'Lato': {
        'win32': ['C:/Windows/Fonts/Lato-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Lato-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/lato/Lato-Regular.ttf']
    },
    'Oswald': {
        'win32': ['C:/Windows/Fonts/Oswald-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Oswald-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/oswald/Oswald-Regular.ttf']
    },
    'Raleway': {
        'win32': ['C:/Windows/Fonts/Raleway-Regular.ttf', 'arial.ttf'],
        'darwin': ['/Library/Fonts/Raleway-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/raleway/Raleway-Regular.ttf']
    },
    'Bebas Neue': {
        'win32': ['C:/Windows/Fonts/BebasNeue-Regular.ttf', 'impact.ttf'],
        'darwin': ['/Library/Fonts/BebasNeue-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/bebas-neue/BebasNeue-Regular.ttf']
    },
    'Anton': {
        'win32': ['C:/Windows/Fonts/Anton-Regular.ttf', 'impact.ttf'],
        'darwin': ['/Library/Fonts/Anton-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/anton/Anton-Regular.ttf']
    },
    'Archivo Black': {
        'win32': ['C:/Windows/Fonts/ArchivoBlack-Regular.ttf', 'arialbd.ttf'],
        'darwin': ['/Library/Fonts/ArchivoBlack-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/archivo-black/ArchivoBlack-Regular.ttf']
    },
    'Bangers': {
        'win32': ['C:/Windows/Fonts/Bangers-Regular.ttf', 'comic.ttf'],
        'darwin': ['/Library/Fonts/Bangers-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/bangers/Bangers-Regular.ttf']
    },
    'Permanent Marker': {
        'win32': ['C:/Windows/Fonts/PermanentMarker-Regular.ttf', 'comic.ttf'],
        'darwin': ['/Library/Fonts/PermanentMarker-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/permanent-marker/PermanentMarker-Regular.ttf']
    },
    'Pacifico': {
        'win32': ['C:/Windows/Fonts/Pacifico-Regular.ttf', 'comic.ttf'],
        'darwin': ['/Library/Fonts/Pacifico-Regular.ttf'],
        'linux': ['/usr/share/fonts/truetype/pacifico/Pacifico-Regular.ttf']
    }
}

# Bold font variants mapping
FONT_BOLD_MAP = {
    'Inter': 'Inter-Bold.ttf',
    'Roboto': 'Roboto-Bold.ttf',
    'Open Sans': 'OpenSans-Bold.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Poppins': 'Poppins-Bold.ttf',
    'Playfair Display': 'PlayfairDisplay-Bold.ttf',
    'Merriweather': 'Merriweather-Bold.ttf',
    'Lato': 'Lato-Bold.ttf',
    'Oswald': 'Oswald-Bold.ttf',
    'Raleway': 'Raleway-Bold.ttf',
}


class VideoProcessor:
    """Processes scenes into a final video using FFmpeg"""

    def __init__(self, export_data, progress_callback=None):
        self.export_data = export_data
        self.progress_callback = progress_callback or (lambda p, m: None)

        # Extract output settings
        output = export_data.get('output', {})
        resolution = output.get('resolution', {})
        self.width = resolution.get('width', 1080)
        self.height = resolution.get('height', 1920)
        self.fps = output.get('fps', 30)
        self.codec = output.get('codec', 'libx264')
        self.pixel_format = output.get('pixel_format', 'yuv420p')
        self.preset = output.get('preset', 'medium')
        self.crf = output.get('crf', 23)

        # Base path for media files (relative to backend folder)
        self.media_base_path = export_data.get('media_base_path', '')

        # Get the backend directory and project root
        self.backend_dir = os.path.dirname(os.path.abspath(__file__))
        self.project_root = os.path.dirname(self.backend_dir)
        self.frontend_dir = os.path.join(self.project_root, 'frontend')

        logger.info("VideoProcessor init: {}x{} {}fps crf={} codec={} preset={}",
                     self.width, self.height, self.fps, self.crf, self.codec, self.preset)
        logger.debug("VideoProcessor paths: backend={} root={} frontend={}",
                      self.backend_dir, self.project_root, self.frontend_dir)
        logger.debug("VideoProcessor ffmpeg: {} (lib={})", FFMPEG_BIN, USE_FFMPEG_PYTHON)

    def _update_progress(self, progress, message):
        """Update progress callback"""
        self.progress_callback(progress, message)

    def _get_media_path(self, relative_path):
        """Resolve media path from working-assets folder"""
        if not relative_path:
            logger.warning("Empty media path provided")
            return None

        if os.path.isabs(relative_path):
            if os.path.exists(relative_path):
                return relative_path
            logger.error("Absolute media path does not exist: {}", relative_path)
            raise FileNotFoundError(f"Media file not found: {relative_path}")

        # Try paths relative to frontend folder
        paths_to_try = [
            os.path.join(self.frontend_dir, relative_path),
            os.path.join(self.project_root, relative_path),
            relative_path
        ]

        for path in paths_to_try:
            if os.path.exists(path):
                resolved = os.path.abspath(path)
                logger.debug("Resolved media: {} -> {}", relative_path, resolved)
                return resolved

        logger.error("Media not found. Tried: {}", paths_to_try)
        raise FileNotFoundError(f"Media file not found: {relative_path}")

    def _create_text_scene(self, scene, temp_dir, index):
        """Create a video clip for a text scene"""
        text_config = scene.get('text', {})
        duration = scene.get('duration', 3)

        text_image_path = os.path.join(temp_dir, f"text_{index:03d}.png")
        self._render_text_image(text_config, text_image_path)

        output_path = os.path.join(temp_dir, f"scene_{index:03d}.mp4")

        if USE_FFMPEG_PYTHON:
            self._create_video_from_image_ffmpeg(text_image_path, output_path, duration)
        else:
            self._create_video_from_image_subprocess(text_image_path, output_path, duration)

        return output_path

    def _load_font(self, font_family, font_size, font_style='normal'):
        """Load font by family name with fallback support"""
        # Try custom fonts first (from fonts/ directory)
        variant = 'bold' if font_style == 'bold' else ('italic' if font_style == 'italic' else 'regular')
        if font_style == 'bold-italic':
            variant = 'bold_italic'
        custom_path = _custom_font_path(font_family, variant)
        if custom_path and os.path.isfile(custom_path):
            try:
                font = ImageFont.truetype(custom_path, font_size)
                logger.debug("Font loaded (custom): {} {} -> {}", font_family, variant, custom_path)
                return font
            except (OSError, IOError):
                logger.warning("Custom font file failed to load: {}", custom_path)

        current_os = platform.system().lower()
        os_key = 'win32' if current_os == 'windows' else ('darwin' if current_os == 'darwin' else 'linux')

        font_paths = []
        if font_family in FONT_MAP:
            # Create a copy so we can prepend bold variants without modifying the list we are iterating over
            font_paths = list(FONT_MAP[font_family].get(os_key, []))

            if font_style == 'bold' and font_family in FONT_BOLD_MAP:
                bold_name = FONT_BOLD_MAP[font_family]
                bold_paths_to_add = []
                for path in font_paths:
                    bold_path = path.replace('-Regular', '-Bold').replace('.ttf', '')
                    if '-Bold' not in bold_path:
                        bold_path = path.rsplit('.', 1)[0] + '-Bold.ttf'
                    bold_paths_to_add.append(bold_path)
                
                # Prepend the bold paths
                font_paths = bold_paths_to_add + font_paths

        fallback_fonts = [
            'arial.ttf', 'arialbd.ttf',
            'C:/Windows/Fonts/arial.ttf',
            'C:/Windows/Fonts/arialbd.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
            '/System/Library/Fonts/Helvetica.ttc'
        ]
        font_paths.extend(fallback_fonts)

        for font_path in font_paths:
            try:
                font = ImageFont.truetype(font_path, font_size)
                logger.debug("Font loaded: {}", font_path)
                return font
            except (OSError, IOError):
                continue

        logger.warning("No font file found for '{}', using PIL default", font_family)
        return ImageFont.load_default()

    def _render_text_image(self, text_config, output_path):
        """Render text overlay on background image or solid color"""
        content = text_config.get('content', '')
        color_hex = text_config.get('color_hex', '#ffffff')
        background = text_config.get('background', {})

        font_family = text_config.get('font_family', 'Inter')
        font_size = text_config.get('font_size', 48)
        font_style = text_config.get('font_style', 'bold')

        position = text_config.get('position', {})
        text_x = position.get('x')
        text_y = position.get('y')

        text_align = text_config.get('text_align', 'center')
        vertical_align = text_config.get('vertical_align', 'center')

        logger.debug("Text scene: font={} {}px {} align={}/{} pos=({},{})",
                      font_family, font_size, font_style, text_align, vertical_align, text_x, text_y)

        # Try to load background image
        bg_image = None
        bg_image_path = background.get('image_path')
        if bg_image_path:
            try:
                full_path = self._get_media_path(bg_image_path)
                bg_image = Image.open(full_path).convert('RGB')
                bg_image = bg_image.resize((self.width, self.height), Image.Resampling.LANCZOS)
                logger.debug("Text background image: {}", bg_image_path)
            except Exception as e:
                logger.warning("Could not load text background image: {}", e)
                bg_image = None

        if bg_image:
            img = bg_image
        else:
            fallback_color = background.get('fallback_color', '#000000')
            img = Image.new('RGB', (self.width, self.height), fallback_color)
            logger.debug("Text solid background: {}", fallback_color)

        draw = ImageDraw.Draw(img)
        font = self._load_font(font_family, font_size, font_style)

        padding = text_config.get('padding', 80)
        max_width = self.width - (padding * 2)
        lines = self._wrap_text(content, font, max_width, draw)

        line_height = font_size * 1.3
        total_height = len(lines) * line_height

        if text_y is not None:
            y = (text_y / 100) * self.height - (total_height / 2)
        else:
            if vertical_align == 'top':
                y = padding
            elif vertical_align == 'bottom':
                y = self.height - total_height - padding
            else:
                y = (self.height - total_height) / 2

        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            text_width = bbox[2] - bbox[0]

            if text_x is not None:
                x = (text_x / 100) * self.width - (text_width / 2)
            else:
                if text_align == 'left':
                    x = padding
                elif text_align == 'right':
                    x = self.width - text_width - padding
                else:
                    x = (self.width - text_width) / 2

            x = max(padding / 2, min(x, self.width - text_width - padding / 2))
            draw.text((x, y), line, fill=color_hex, font=font)
            y += line_height

        img.save(output_path, 'PNG')
        logger.debug("Text image saved: {}", output_path)

    def _wrap_text(self, text, font, max_width, draw):
        """Wrap text to fit within max_width"""
        words = text.split()
        lines = []
        current_line = ""

        for word in words:
            test_line = f"{current_line} {word}".strip()
            bbox = draw.textbbox((0, 0), test_line, font=font)
            width = bbox[2] - bbox[0]

            if width <= max_width:
                current_line = test_line
            else:
                if current_line:
                    lines.append(current_line)
                current_line = word

        if current_line:
            lines.append(current_line)

        return lines

    def _create_scene_clip(self, scene, temp_dir, index):
        """Create a video clip for a single scene"""
        media = scene.get('media', {})
        media_type = media.get('type', 'image')
        scene_id = scene.get('id', index + 1)

        logger.debug("Scene {}: type={}", scene_id, media_type)

        # Handle text scenes
        if media_type == 'text':
            logger.debug("Scene {}: creating text scene", scene_id)
            return self._create_text_scene(scene, temp_dir, index)

        # Handle image/video scenes
        media_path = media.get('path')
        if not media_path:
            logger.error("Scene {} has no media path", scene_id)
            raise ValueError(f"Scene {scene_id} has no media path")

        logger.debug("Scene {}: looking for media: {}", scene_id, media_path)

        try:
            full_media_path = self._get_media_path(media_path)
            logger.debug("Scene {}: resolved media: {}", scene_id, full_media_path)
        except FileNotFoundError as e:
            logger.error("Scene {}: media not found: {}", scene_id, e)
            raise

        duration = scene.get('duration', 3)
        effect = scene.get('effect', {})
        effect_type = effect.get('type', 'static')

        logger.info("Scene {}: {}s effect={} path={}",
                     scene_id, duration, effect_type, os.path.basename(full_media_path))

        output_path = os.path.join(temp_dir, f"scene_{index:03d}.mp4")

        # Detect video source files
        is_video_source = full_media_path.lower().endswith(('.mp4', '.webm', '.mov', '.avi', '.mkv'))

        if is_video_source:
            self._create_scene_from_video(full_media_path, output_path, duration, effect)
        elif USE_FFMPEG_PYTHON:
            self._create_scene_ffmpeg(full_media_path, output_path, duration, effect)
        else:
            self._create_scene_subprocess(full_media_path, output_path, duration, effect)

        # Verify output was created
        if os.path.exists(output_path):
            size = os.path.getsize(output_path)
            logger.debug("Scene {}: output {} ({:.1f} KB)", scene_id, output_path, size / 1024)
        else:
            logger.error("Scene {}: output file was NOT created: {}", scene_id, output_path)

        return output_path

    def _create_video_from_image_ffmpeg(self, image_path, output_path, duration):
        """Create video from static image using ffmpeg-python"""
        logger.debug("ffmpeg-python: image->video {}s {}", duration, image_path)
        (
            ffmpeg
            .input(image_path, loop=1, t=duration)
            .filter('scale', w=self.width, h=self.height)
            .output(
                output_path,
                vcodec=self.codec,
                pix_fmt=self.pixel_format,
                r=self.fps,
                crf=self.crf,
                preset=self.preset
            )
            .overwrite_output()
            .run(cmd=FFMPEG_BIN, quiet=True)
        )

    def _create_video_from_image_subprocess(self, image_path, output_path, duration):
        """Create video from static image using subprocess"""
        cmd = [
            FFMPEG_BIN, '-y',
            '-loop', '1',
            '-i', image_path,
            '-t', str(duration),
            '-vf', f'scale={self.width}:{self.height}',
            '-c:v', self.codec,
            '-pix_fmt', self.pixel_format,
            '-r', str(self.fps),
            '-crf', str(self.crf),
            '-preset', self.preset,
            output_path
        ]
        logger.debug("subprocess: image->video cmd={}", ' '.join(cmd[:8]) + '...')
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg image->video failed: {}", result.stderr[:500])
            raise RuntimeError(f"FFmpeg failed: {result.stderr[:200]}")

    def _create_scene_ffmpeg(self, media_path, output_path, duration, effect):
        """Create scene video with effects using ffmpeg-python"""
        effect_type = effect.get('type', 'static')

        logger.debug("Creating {}s clip: effect={}", duration, effect_type)

        if effect_type in ['static', 'fade']:
            self._create_simple_scene(media_path, output_path, duration, effect_type)
            return

        self._create_effect_scene(media_path, output_path, duration, effect)

    def _create_simple_scene(self, media_path, output_path, duration, effect_type):
        """Fast method for static/fade scenes without zoompan"""
        filters = [
            f"scale='if(gte(iw/ih,{self.width}/{self.height}),-2,{self.width})':'if(gte(iw/ih,{self.width}/{self.height}),{self.height},-2)'",
            f"crop={self.width}:{self.height}",
            f"fps={self.fps}"
        ]

        if effect_type == 'fade':
            fade_dur = 0.5
            filters.append(f"fade=t=in:st=0:d={fade_dur}")
            filters.append(f"fade=t=out:st={duration - fade_dur}:d={fade_dur}")

        vf = ','.join(filters)

        cmd = [
            FFMPEG_BIN, '-y',
            '-loop', '1',
            '-i', media_path,
            '-t', str(duration),
            '-vf', vf,
            '-c:v', self.codec,
            '-pix_fmt', self.pixel_format,
            '-preset', 'fast',
            '-crf', str(self.crf),
            output_path
        ]

        logger.debug("Simple scene cmd: {}", ' '.join(cmd[:10]) + '...')
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg simple scene failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"FFmpeg failed: {result.stderr[-500:] if result.stderr else ''}")

    def _create_effect_scene(self, media_path, output_path, duration, effect):
        """Create scene with zoom/pan effects using zoompan filter"""
        effect_type = effect.get('type', 'static')
        frames = int(duration * self.fps)

        if effect_type == 'zoom_in':
            start_scale = effect.get('start_scale', 1.0)
            end_scale = effect.get('end_scale', 1.2)
            z_expr = f"'min({start_scale}+on*{(end_scale-start_scale)/frames},{end_scale})'"
            x_expr = "'iw/2-(iw/zoom/2)'"
            y_expr = "'ih/2-(ih/zoom/2)'"
        elif effect_type == 'zoom_out':
            start_scale = effect.get('start_scale', 1.2)
            end_scale = effect.get('end_scale', 1.0)
            z_expr = f"'max({start_scale}-on*{(start_scale-end_scale)/frames},{end_scale})'"
            x_expr = "'iw/2-(iw/zoom/2)'"
            y_expr = "'ih/2-(ih/zoom/2)'"
        elif effect_type == 'pan_left':
            pan_amount = effect.get('pan_amount', 0.2)
            z_expr = "'1.1'"
            x_expr = f"'iw*{pan_amount}*(1-on/{frames})'"
            y_expr = "'(ih-oh)/2'"
        elif effect_type == 'pan_right':
            pan_amount = effect.get('pan_amount', 0.2)
            z_expr = "'1.1'"
            x_expr = f"'iw*{pan_amount}*on/{frames}'"
            y_expr = "'(ih-oh)/2'"
        else:
            self._create_simple_scene(media_path, output_path, duration, 'static')
            return

        zoompan_fps = 25
        zoompan_frames = int(duration * zoompan_fps)

        vf = f"zoompan=z={z_expr}:x={x_expr}:y={y_expr}:d={zoompan_frames}:s={self.width}x{self.height}:fps={zoompan_fps},fps={self.fps}"

        cmd = [
            FFMPEG_BIN, '-y',
            '-i', media_path,
            '-vf', vf,
            '-t', str(duration),
            '-c:v', self.codec,
            '-pix_fmt', self.pixel_format,
            '-preset', 'fast',
            '-crf', str(self.crf),
            output_path
        ]

        logger.info("Zoompan effect: {} {}s", effect_type, duration)
        logger.debug("Zoompan cmd: {}", ' '.join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg zoompan failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"FFmpeg failed: {result.stderr[-500:] if result.stderr else ''}")

    def _create_scene_from_video(self, video_path, output_path, duration, effect):
        """Create a scene clip from a video source — trim, scale, and re-encode."""
        effect_type = effect.get('type', 'static')

        filters = [
            f"scale='if(gte(iw/ih,{self.width}/{self.height}),-2,{self.width})':'if(gte(iw/ih,{self.width}/{self.height}),{self.height},-2)'",
            f"crop={self.width}:{self.height}",
            f"fps={self.fps}",
        ]

        if effect_type == 'fade':
            fade_dur = 0.5
            filters.append(f"fade=t=in:st=0:d={fade_dur}")
            filters.append(f"fade=t=out:st={duration - fade_dur}:d={fade_dur}")

        vf = ','.join(filters)

        cmd = [
            FFMPEG_BIN, '-y',
            '-i', video_path,
            '-t', str(duration),
            '-vf', vf,
            '-c:v', self.codec,
            '-pix_fmt', self.pixel_format,
            '-an',
            '-preset', 'fast',
            '-crf', str(self.crf),
            output_path,
        ]

        logger.info("Video source scene: {}s effect={} src={}",
                     duration, effect_type, os.path.basename(video_path))
        logger.debug("Video scene cmd: {}", ' '.join(cmd[:12]) + '...')
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg video scene failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"FFmpeg video scene failed: {result.stderr[-500:] if result.stderr else ''}")

    def _create_scene_subprocess(self, media_path, output_path, duration, effect):
        """Create scene video with effects using subprocess (fallback)"""
        effect_type = effect.get('type', 'static')

        vf_filters = [
            f"scale='if(gte(iw/ih,{self.width}/{self.height}),-2,{self.width})':'if(gte(iw/ih,{self.width}/{self.height}),{self.height},-2)'",
            f"crop={self.width}:{self.height}"
        ]

        if effect_type == 'fade':
            fade_duration = effect.get('fade_duration', 0.5)
            vf_filters.append(f"fade=t=in:st=0:d={fade_duration}")
            vf_filters.append(f"fade=t=out:st={duration-fade_duration}:d={fade_duration}")

        vf = ','.join(vf_filters)

        cmd = [
            FFMPEG_BIN, '-y',
            '-loop', '1',
            '-i', media_path,
            '-t', str(duration),
            '-vf', vf,
            '-c:v', self.codec,
            '-pix_fmt', self.pixel_format,
            '-r', str(self.fps),
            '-crf', str(self.crf),
            '-preset', self.preset,
            output_path
        ]
        logger.debug("Subprocess scene cmd: {}", ' '.join(cmd[:10]) + '...')
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg subprocess scene failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"FFmpeg failed: {result.stderr[-500:] if result.stderr else ''}")

    def _concat_scenes(self, scene_clips, output_path):
        """Concatenate scene clips into final video"""
        concat_list_path = os.path.join(os.path.dirname(scene_clips[0]), 'concat_list.txt')

        logger.info("Concatenating {} clips", len(scene_clips))
        with open(concat_list_path, 'w') as f:
            for clip in scene_clips:
                clip_path = clip.replace('\\', '/')
                f.write(f"file '{clip_path}'\n")
                logger.debug("  concat: {}", os.path.basename(clip_path))

        audio_config = self.export_data.get('audio')

        if USE_FFMPEG_PYTHON:
            self._concat_ffmpeg(concat_list_path, output_path, audio_config)
        else:
            self._concat_subprocess(concat_list_path, output_path, audio_config)

    def _concat_ffmpeg(self, concat_list_path, output_path, audio_config):
        """Concatenate using ffmpeg-python (delegates to subprocess for bgMusic mixing)."""
        bg_music = self.export_data.get('bgMusic')
        bgmusic_path = self._resolve_music_path(bg_music) if bg_music else None

        if bgmusic_path:
            logger.info("BgMusic present, using subprocess path for filter_complex")
            self._concat_subprocess(concat_list_path, output_path, audio_config)
            return

        video = ffmpeg.input(concat_list_path, format='concat', safe=0)

        if audio_config and audio_config.get('path'):
            try:
                audio_path = self._get_media_path(audio_config['path'])
                logger.info("Concat with audio: {}", audio_path)
                audio = ffmpeg.input(audio_path)

                volume = audio_config.get('volume', 1.0)
                audio = audio.filter('volume', volume=volume)

                trimmed_duration = audio_config.get('trimmed_duration')
                if trimmed_duration:
                    audio = audio.filter('atrim', duration=trimmed_duration)

                fade_out = audio_config.get('fade_out', 0.5)
                total_duration = self.export_data.get('timeline', {}).get('total_duration', 60)
                audio = audio.filter('afade', type='out', start_time=total_duration - fade_out, duration=fade_out)

                logger.debug("Audio: vol={} fade_out={}s total_dur={}s", volume, fade_out, total_duration)

                (
                    ffmpeg
                    .output(
                        video, audio,
                        output_path,
                        vcodec='copy',
                        acodec='aac',
                        audio_bitrate='192k',
                        shortest=None
                    )
                    .overwrite_output()
                    .run(cmd=FFMPEG_BIN, quiet=True)
                )
                logger.info("Concat with audio completed: {}", output_path)
            except FileNotFoundError as e:
                logger.warning("Audio file not found, exporting without audio: {}", e)
                self._concat_video_only(video, output_path)
        else:
            logger.info("Concat without audio")
            self._concat_video_only(video, output_path)

    def _concat_video_only(self, video_stream, output_path):
        """Concatenate video only (no audio)"""
        logger.debug("Concat video-only: {}", output_path)
        (
            ffmpeg
            .output(video_stream, output_path, vcodec='copy', an=None)
            .overwrite_output()
            .run(cmd=FFMPEG_BIN, quiet=True)
        )

    def _resolve_music_path(self, bg_music):
        """Resolve background music file path."""
        music_path = bg_music.get('path', '')
        if not music_path:
            logger.debug("BgMusic: no path specified")
            return None
        if music_path.startswith('/output/music/'):
            from config import MUSIC_DIR
            fname = music_path.replace('/output/music/', '', 1)
            full = os.path.join(MUSIC_DIR, fname)
            if os.path.isfile(full):
                logger.debug("BgMusic resolved: {} -> {}", music_path, full)
                return full
            logger.warning("BgMusic file not found: {}", full)
        try:
            resolved = self._get_media_path(music_path)
            logger.debug("BgMusic resolved via media path: {}", resolved)
            return resolved
        except FileNotFoundError:
            logger.warning("BgMusic not found anywhere: {}", music_path)
            return None

    def _build_audio_filter(self, audio_config, bg_music, total_duration):
        """Build FFmpeg audio filter complex for narration + bgMusic mixing."""
        has_narration = audio_config and audio_config.get('path')
        has_bgmusic = bg_music is not None and self._resolve_music_path(bg_music) is not None

        if not has_narration and not has_bgmusic:
            logger.debug("Audio filter: no audio sources")
            return None, None

        filters = []
        narration_label = None
        bgmusic_label = None

        if has_narration:
            vol = audio_config.get('volume', 1.0)
            fade_out = audio_config.get('fade_out', 0.5)
            fade_start = max(0, total_duration - fade_out)
            filters.append(f"[1:a]volume={vol},afade=t=out:st={fade_start}:d={fade_out}[narration]")
            narration_label = '[narration]'
            logger.debug("Audio filter: narration vol={} fade_out={}s", vol, fade_out)

        if has_bgmusic:
            bgm_input_idx = 2 if has_narration else 1
            vol = bg_music.get('volume', 0.15)
            fade_in = bg_music.get('fade_in', 2.0)
            fade_out = bg_music.get('fade_out', 3.0)
            ducking = bg_music.get('ducking_enabled', True)
            duck_level = bg_music.get('ducking_level', 0.08)

            effective_vol = duck_level if (ducking and has_narration) else vol

            fade_out_start = max(0, total_duration - fade_out)
            parts = [
                f"[{bgm_input_idx}:a]volume={effective_vol}",
                f"afade=t=in:st=0:d={fade_in}",
                f"afade=t=out:st={fade_out_start}:d={fade_out}",
                f"atrim=0:{total_duration}",
                f"asetpts=PTS-STARTPTS"
            ]
            filters.append(','.join(parts) + '[bgm]')
            bgmusic_label = '[bgm]'
            logger.debug("Audio filter: bgmusic vol={} (effective={}) fade_in={} fade_out={} ducking={}",
                          vol, effective_vol, fade_in, fade_out, ducking)

        if narration_label and bgmusic_label:
            filters.append(f"{narration_label}{bgmusic_label}amix=inputs=2:duration=longest:normalize=0[audio_out]")
            out_label = '[audio_out]'
            logger.debug("Audio filter: mixing narration + bgmusic")
        elif narration_label:
            out_label = narration_label
        else:
            out_label = bgmusic_label

        filter_str = ';'.join(filters)
        logger.debug("Audio filter_complex: {}", filter_str)
        return filter_str, out_label

    def _concat_subprocess(self, concat_list_path, output_path, audio_config):
        """Concatenate using subprocess with optional bgMusic mixing."""
        bg_music = self.export_data.get('bgMusic')
        total_duration = self.export_data.get('timeline', {}).get('total_duration', 60)

        narration_path = None
        if audio_config and audio_config.get('path'):
            try:
                narration_path = self._get_media_path(audio_config['path'])
                logger.info("Narration audio: {}", narration_path)
            except FileNotFoundError:
                logger.warning("Narration audio not found: {}", audio_config.get('path'))
                narration_path = None

        bgmusic_path = self._resolve_music_path(bg_music) if bg_music else None

        if not narration_path and not bgmusic_path:
            logger.info("Concat: no audio, video-only")
            cmd = [
                FFMPEG_BIN, '-y',
                '-f', 'concat', '-safe', '0', '-i', concat_list_path,
                '-c:v', 'copy', '-an',
                output_path
            ]
            logger.debug("Concat cmd: {}", ' '.join(cmd))
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                logger.error("FFmpeg concat (no audio) failed:\nstderr: {}", result.stderr[-1000:] if result.stderr else "")
                raise RuntimeError(f"FFmpeg concat failed: {result.stderr[-500:] if result.stderr else ''}")
            return

        # Build input list
        cmd = [FFMPEG_BIN, '-y', '-f', 'concat', '-safe', '0', '-i', concat_list_path]
        if narration_path:
            cmd += ['-i', narration_path]
        if bgmusic_path:
            loop_flag = bg_music.get('loop', True)
            if loop_flag:
                cmd += ['-stream_loop', '-1']
            cmd += ['-i', bgmusic_path]
            logger.info("BgMusic input: {} (loop={})", bgmusic_path, loop_flag)

        # Build filter complex
        filter_str, out_label = self._build_audio_filter(
            audio_config if narration_path else None,
            bg_music if bgmusic_path else None,
            total_duration
        )

        if filter_str:
            cmd += ['-filter_complex', filter_str, '-map', '0:v', '-map', out_label]
        else:
            cmd += ['-map', '0:v', '-an']

        cmd += ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output_path]

        logger.info("Concat with audio: {} inputs, filter_complex={}",
                     2 + (1 if bgmusic_path else 0), bool(filter_str))
        logger.debug("Full concat cmd: {}", ' '.join(cmd))
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("FFmpeg concat failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"FFmpeg concat failed: {result.stderr[-500:] if result.stderr else ''}")
        logger.info("Concat completed: {}", output_path)

    def _resolve_font_path(self, family, weight='normal'):
        """Resolve a font family name to a filesystem path for FFmpeg drawtext."""
        # Try custom fonts first
        variant = 'bold' if weight == 'bold' else 'regular'
        custom_path = _custom_font_path(family, variant)
        if custom_path and os.path.isfile(custom_path):
            logger.debug("Font resolved (custom): {} {} -> {}", family, variant, custom_path)
            return custom_path

        current_os = platform.system().lower()
        os_key = 'win32' if current_os == 'windows' else ('darwin' if current_os == 'darwin' else 'linux')

        if weight == 'bold' and family in FONT_BOLD_MAP:
            bold_name = FONT_BOLD_MAP[family]
            candidates = []
            if os_key == 'win32':
                candidates.append(f'C:/Windows/Fonts/{bold_name}')
            elif os_key == 'darwin':
                candidates.append(f'/Library/Fonts/{bold_name}')
            else:
                candidates.append(f'/usr/share/fonts/truetype/{family.lower().replace(" ", "-")}/{bold_name}')
            for c in candidates:
                if os.path.isfile(c):
                    logger.debug("Font resolved (bold): {} -> {}", family, c)
                    return c

        if family in FONT_MAP:
            for path in FONT_MAP[family].get(os_key, []):
                if os.path.isfile(path):
                    logger.debug("Font resolved: {} -> {}", family, path)
                    return path

        fallbacks = {
            'win32': 'C:/Windows/Fonts/arial.ttf',
            'darwin': '/System/Library/Fonts/Helvetica.ttc',
            'linux': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
        }
        fb = fallbacks.get(os_key, 'arial.ttf')
        if os.path.isfile(fb):
            logger.debug("Font fallback: {} -> {}", family, fb)
            return fb
        logger.warning("No font found for '{}', using arial.ttf", family)
        return 'arial.ttf'

    def _burn_captions(self, video_path, output_path):
        """Burn caption overlays into the video using FFmpeg drawtext filter."""
        captions = self.export_data.get('captions')
        if not captions:
            logger.debug("No captions to burn")
            return video_path

        entries = captions.get('entries', [])
        if not entries:
            logger.debug("Captions present but no entries")
            return video_path

        style = captions.get('style', {})
        # Support both camelCase and snake_case keys from frontend
        font_family = style.get('fontFamily', style.get('font_family', 'Inter'))
        font_weight = style.get('fontWeight', style.get('font_weight', 'bold'))
        font_size = style.get('fontSize', style.get('font_size', 48))
        font_color = style.get('color', '#FFFFFF').lstrip('#')
        bg_color = style.get('backgroundColor', style.get('background', ''))
        text_transform = style.get('textTransform', style.get('text_transform', 'none'))
        stroke_width = style.get('strokeWidth', style.get('stroke_width', 2))
        stroke_color = style.get('strokeColor', style.get('stroke_color', '#000000')).lstrip('#')
        position_y = style.get('positionY', style.get('position_y', 80))
        box_padding_x = style.get('boxPaddingX', style.get('box_padding_x', 0))
        box_padding_y = style.get('boxPaddingY', style.get('box_padding_y', 0))
        shadow_color = style.get('shadowColor', style.get('shadow_color', ''))
        shadow_x = style.get('shadowOffsetX', style.get('shadow_offset_x', 0))
        shadow_y = style.get('shadowOffsetY', style.get('shadow_offset_y', 0))
        blend_mode = style.get('blendMode', style.get('blend_mode', 'normal'))

        font_path = self._resolve_font_path(font_family, font_weight)
        font_path_esc = font_path.replace('\\', '/').replace(':', '\\:')

        logger.info("Burning {} captions: font={} {}px color=#{} stroke={}px pos_y={}%",
                     len(entries), font_family, font_size, font_color, stroke_width, position_y)

        drawtext_parts = []
        for i, entry in enumerate(entries):
            text = entry.get('text', '')
            if not text:
                continue

            if text_transform == 'uppercase':
                text = text.upper()

            start = entry.get('start', 0)
            end = entry.get('end', start + 1)

            escaped = (text
                       .replace("\\", "\\\\")
                       .replace("'", "\u2019")
                       .replace(":", "\\:")
                       .replace("%", "%%")
                       .replace("\n", " "))

            y_expr = f"h*{position_y}/100-{font_size}/2"

            dt = (
                f"drawtext=fontfile='{font_path_esc}'"
                f":text='{escaped}'"
                f":fontsize={font_size}"
                f":fontcolor=#{font_color}"
                f":x=(w-text_w)/2"
                f":y={y_expr}"
                f":enable='between(t,{start},{end})'"
            )

            if stroke_width and stroke_color and stroke_color != 'none':
                dt += f":borderw={stroke_width}:bordercolor=#{stroke_color}"

            if bg_color and bg_color not in ('transparent', 'none'):
                bg_hex = bg_color.lstrip('#')
                pad = max(box_padding_x, box_padding_y, 8)
                dt += f":box=1:boxcolor=#{bg_hex}:boxborderw={pad}"

            if shadow_color and shadow_color not in ('none', 'transparent'):
                # Parse rgba or hex to hex for FFmpeg shadowcolor
                sc = shadow_color.lstrip('#')
                if sc.startswith('rgba') or sc.startswith('rgb'):
                    # FFmpeg shadowcolor only supports hex; use black fallback
                    sc = '000000'
                dt += f":shadowcolor=#{sc}:shadowx={shadow_x}:shadowy={shadow_y}"

            drawtext_parts.append(dt)
            logger.debug("  Caption {}: [{:.1f}s-{:.1f}s] '{}'", i + 1, start, end, text[:40])

        if not drawtext_parts:
            logger.debug("No valid caption entries after filtering")
            return video_path

        vf_drawtext = ','.join(drawtext_parts)
        if blend_mode == 'difference':
            # Read tuned strength values from style config
            diff_strength = float(style.get('diff_strength', style.get('diffStrength', 1.0)))
            overlay_strength = float(style.get('overlay_strength', style.get('overlayStrength', 0.0)))

            # Convert diff_strength (0-1) to a gray hex for drawtext fontcolor
            gray_val = int(diff_strength * 255)
            diff_hex = f"{gray_val:02x}" * 3  # e.g. 0.59 -> '969696'

            # Build drawtext filters with gray font for controlled diff strength
            # Include shadow on the mask — it gets inverted along with text
            diff_drawtext_parts = []
            for dt in drawtext_parts:
                dt_diff = dt.replace(f":fontcolor=#{font_color}", f":fontcolor=#{diff_hex}")
                diff_drawtext_parts.append(dt_diff)
            vf_diff_drawtext = ','.join(diff_drawtext_parts)

            # Difference blend: gray text on black → blend with original
            # NOTE: format=gbrp (planar rgb) BEFORE drawbox ensures black is true (0,0,0)
            # pack format like rgb24 is NOT supported by blend filter, prompting auto YUV fallback
            vf = (f"split[base][mask_bg];"
                  f"[mask_bg]format=gbrp,"
                  f"drawbox=x=0:y=0:w=iw:h=ih:color=0x000000:t=fill,"
                  f"{vf_diff_drawtext}[mask];"
                  f"[base]format=gbrp[base_rgb];"
                  f"[base_rgb][mask]blend=all_mode=difference,format={self.pixel_format}")

            # Overlay brightness boost: draw text again with low-alpha white on top
            if overlay_strength > 0:
                overlay_dt_parts = []
                for dt in drawtext_parts:
                    # White text with controlled alpha, no shadow/stroke
                    # Supported alpha notation: color@0.X
                    dt_ov = dt.replace(f":fontcolor=#{font_color}",
                                       f":fontcolor=white@{overlay_strength:.2f}")
                    if ':shadowcolor=' in dt_ov:
                        dt_ov = re.sub(r':shadowcolor=[^:]*:shadowx=[^:]*:shadowy=[^:]*', '', dt_ov)
                    if ':borderw=' in dt_ov:
                        dt_ov = re.sub(r':borderw=[^:]*:bordercolor=[^:]*', '', dt_ov)
                    overlay_dt_parts.append(dt_ov)
                vf_overlay = ','.join(overlay_dt_parts)
                vf += f",{vf_overlay}"
        else:
            vf = vf_drawtext

        cmd = [
            FFMPEG_BIN, '-y',
            '-i', video_path,
            '-vf', vf,
            '-c:v', self.codec,
            '-crf', str(self.crf),
            '-preset', 'fast',
            '-pix_fmt', self.pixel_format,
            '-c:a', 'copy',
            output_path
        ]

        logger.info("Running caption burn-in ({} drawtext filters)...", len(drawtext_parts))
        logger.debug("Caption cmd: {} ... (vf len={})", ' '.join(cmd[:6]), len(vf))
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            logger.error("Caption burn-in failed:\nstdout: {}\nstderr: {}",
                          result.stdout[:300], result.stderr[-1000:] if result.stderr else "")
            raise RuntimeError(f"Caption burn-in failed: {result.stderr[-500:] if result.stderr else ''}")

        logger.success("Caption burn-in complete: {}", output_path)
        return output_path

    def process(self, output_path):
        """Process all scenes into a final video"""
        scenes = self.export_data.get('scenes', [])
        if not scenes:
            logger.error("No scenes to process")
            raise ValueError("No scenes to process")

        logger.info("=== Export started: {} scenes -> {} ===", len(scenes), output_path)
        logger.debug("Frontend dir: {}", self.frontend_dir)

        self._update_progress(0, "Starting video processing")

        temp_dir = tempfile.mkdtemp(prefix='video_export_')
        logger.debug("Temp directory: {}", temp_dir)

        try:
            scene_clips = []
            total_scenes = len(scenes)

            for i, scene in enumerate(scenes):
                progress = int((i / total_scenes) * 80)
                scene_type = scene.get('media', {}).get('type', 'image')
                scene_id = scene.get('id', i + 1)
                logger.info("Processing scene {}/{} (id={} type={})",
                            i + 1, total_scenes, scene_id, scene_type)
                self._update_progress(progress, f"Processing scene {i + 1}/{total_scenes} ({scene_type})")

                try:
                    clip_path = self._create_scene_clip(scene, temp_dir, i)
                    scene_clips.append(clip_path)
                    logger.info("Scene {}/{} done: {}", i + 1, total_scenes, os.path.basename(clip_path))
                except Exception as e:
                    logger.error("Scene {}/{} FAILED: {}", i + 1, total_scenes, e)
                    raise

            logger.info("All scenes rendered, concatenating {} clips...", len(scene_clips))
            self._update_progress(82, "Concatenating scenes and adding audio")

            has_captions = bool(self.export_data.get('captions', {}).get('entries'))
            if has_captions:
                concat_output = os.path.join(temp_dir, 'concat_output.mp4')
                logger.debug("Captions detected — concat to temp before burn-in")
            else:
                concat_output = output_path

            self._concat_scenes(scene_clips, concat_output)

            if has_captions:
                logger.info("Starting caption burn-in...")
                self._update_progress(90, "Burning captions into video")
                self._burn_captions(concat_output, output_path)

            if os.path.exists(output_path):
                size = os.path.getsize(output_path)
                logger.success("=== Export completed: {} ({:.1f} MB) ===", output_path, size / (1024 * 1024))
            else:
                logger.error("=== Export output file missing: {} ===", output_path)

            self._update_progress(100, "Export completed")

        finally:
            logger.debug("Cleaning up temp directory: {}", temp_dir)
            shutil.rmtree(temp_dir, ignore_errors=True)

        return output_path
