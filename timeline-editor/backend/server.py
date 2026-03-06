"""
Video Export Server
Flask API for processing video exports from the timeline editor
"""

import os
import sys
import uuid
import json
import threading
import subprocess
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from video_processor import VideoProcessor

app = Flask(__name__)
CORS(app)

# Store job statuses
jobs = {}

# Configure paths
EXPORT_DIR = os.path.join(os.path.dirname(__file__), 'exports')
os.makedirs(EXPORT_DIR, exist_ok=True)


def check_ffmpeg():
    """Check if FFmpeg is available"""
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        return result.returncode == 0
    except FileNotFoundError:
        return False


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    ffmpeg_available = check_ffmpeg()
    return jsonify({
        'status': 'ok',
        'version': '1.0.0',
        'ffmpeg': ffmpeg_available
    })


@app.route('/api/export', methods=['POST'])
def start_export():
    """
    Start a video export job

    Expected JSON body:
    {
        "project_id": "pm_123",
        "media_folder": "/path/to/media",
        "output": {
            "resolution": [1080, 1920],
            "fps": 30,
            "codec": "h264",
            "quality": "high"
        },
        "audio": {
            "file": "background.mp3",
            "volume": 0.8,
            "start_offset": 0
        },
        "scenes": [
            {
                "id": 1,
                "media_file": "image1.jpg",
                "media_type": "image",
                "duration": 3,
                "effect": {
                    "type": "zoom_in",
                    "start_scale": 1.0,
                    "end_scale": 1.2
                },
                "transition_out": {
                    "type": "crossfade",
                    "duration": 0.5
                }
            }
        ]
    }
    """
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400

        # Validate required fields
        required = ['project_id', 'scenes']
        for field in required:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        # Generate job ID
        job_id = str(uuid.uuid4())

        # Prepare output path
        output_filename = f"{data['project_id']}_{job_id[:8]}.mp4"
        output_path = os.path.join(EXPORT_DIR, output_filename)

        # Initialize job status
        jobs[job_id] = {
            'status': 'queued',
            'progress': 0,
            'message': 'Job queued',
            'output_path': output_path,
            'output_filename': output_filename,
            'error': None
        }

        # Start processing in background thread
        thread = threading.Thread(
            target=process_video,
            args=(job_id, data, output_path)
        )
        thread.daemon = True
        thread.start()

        return jsonify({
            'job_id': job_id,
            'status': 'queued',
            'message': 'Export job started'
        })

    except Exception as e:
        return jsonify({'error': str(e)}), 500


def process_video(job_id, export_data, output_path):
    """Process video in background thread"""
    try:
        jobs[job_id]['status'] = 'processing'
        jobs[job_id]['message'] = 'Starting video processing'

        def update_progress(progress, message):
            jobs[job_id]['progress'] = progress
            jobs[job_id]['message'] = message

        # Create processor with full export data and run
        processor = VideoProcessor(
            export_data=export_data,
            progress_callback=update_progress
        )

        processor.process(output_path)

        jobs[job_id]['status'] = 'completed'
        jobs[job_id]['progress'] = 100
        jobs[job_id]['message'] = 'Export completed successfully'

    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        print(f"Export error: {error_details}")
        jobs[job_id]['status'] = 'failed'
        jobs[job_id]['error'] = str(e)
        jobs[job_id]['message'] = f'Export failed: {str(e)}'


@app.route('/api/export/<job_id>/status', methods=['GET'])
def get_export_status(job_id):
    """Get status of an export job"""
    if job_id not in jobs:
        return jsonify({'error': 'Job not found'}), 404

    job = jobs[job_id]
    return jsonify({
        'job_id': job_id,
        'status': job['status'],
        'progress': job['progress'],
        'message': job['message'],
        'error': job['error']
    })


@app.route('/api/export/<job_id>/download', methods=['GET'])
def download_export(job_id):
    """Download completed export"""
    if job_id not in jobs:
        return jsonify({'error': 'Job not found'}), 404

    job = jobs[job_id]

    if job['status'] != 'completed':
        return jsonify({'error': 'Export not completed yet'}), 400

    if not os.path.exists(job['output_path']):
        return jsonify({'error': 'Output file not found'}), 404

    return send_file(
        job['output_path'],
        mimetype='video/mp4',
        as_attachment=True,
        download_name=job['output_filename']
    )


@app.route('/api/export/<job_id>', methods=['DELETE'])
def cancel_export(job_id):
    """Cancel/cleanup an export job"""
    if job_id not in jobs:
        return jsonify({'error': 'Job not found'}), 404

    job = jobs[job_id]

    # Clean up file if it exists
    if os.path.exists(job['output_path']):
        try:
            os.remove(job['output_path'])
        except:
            pass

    del jobs[job_id]
    return jsonify({'message': 'Job cancelled and cleaned up'})


@app.route('/api/export/<job_id>/open-folder', methods=['POST'])
def open_export_folder(job_id):
    """Open the folder containing the exported video and select it."""
    if job_id not in jobs:
        return jsonify({'error': 'Job not found'}), 404

    job = jobs[job_id]
    output_path = os.path.abspath(job.get('output_path', ''))

    if not os.path.exists(output_path):
        # Fall back to opening the exports directory
        output_path = EXPORT_DIR
        if not os.path.isdir(output_path):
            return jsonify({'error': 'Output file not found'}), 404

    try:
        import platform
        if platform.system() == 'Windows':
            if os.path.isfile(output_path):
                subprocess.run(['explorer', '/select,', output_path], check=False)
            else:
                subprocess.run(['explorer', output_path], check=False)
        elif platform.system() == 'Darwin':
            if os.path.isfile(output_path):
                subprocess.run(['open', '-R', output_path], check=False)
            else:
                subprocess.run(['open', output_path], check=False)
        else:
            folder = os.path.dirname(output_path) if os.path.isfile(output_path) else output_path
            subprocess.run(['xdg-open', folder], check=False)
        return jsonify({'status': 'ok'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("Starting Video Export Server...")
    print(f"Export directory: {EXPORT_DIR}")
    app.run(host='0.0.0.0', port=5000, debug=True)
