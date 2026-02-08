#!/usr/bin/env python3
"""
Generate a pre-signed URL for uploading files to S3.

Usage:
    uv run generate_upload_url.py video/filename.mp4 [expires_in_seconds]

Example:
    uv run generate_upload_url.py video/big-video.mp4 86400
"""
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from storage.s3 import presign_put


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_upload_url.py <s3_key> [expires_in_seconds]")
        print("\nExample:")
        print("  python generate_upload_url.py video/my-video.mp4 86400")
        print("\nThe key will be relative to the bucket prefix (openar/)")
        sys.exit(1)

    key = sys.argv[1]
    expires = int(sys.argv[2]) if len(sys.argv) > 2 else 86400  # Default: 24 hours

    print(f"Generating pre-signed upload URL for: {key}")
    print(f"Expires in: {expires} seconds ({expires/3600:.1f} hours)")
    print()

    try:
        url, headers = presign_put(
            key,
            content_type="video/mp4",
            expires=expires
        )

        print("=" * 80)
        print("UPLOAD INSTRUCTIONS")
        print("=" * 80)
        print()
        print("Send this command to the external user:")
        print()
        print(f'curl -X PUT -T /path/to/their/video.mp4 \\')
        if headers:
            for header_name, header_value in headers.items():
                print(f'  -H "{header_name}: {header_value}" \\')
        print(f'  "{url}"')
        print()
        print("They need to replace '/path/to/their/video.mp4' with their actual file path.")
        print()
        print("=" * 80)
        print("DETAILS")
        print("=" * 80)
        print(f"URL: {url}")
        print(f"Headers: {headers}")
        print(f"Expires: {expires} seconds from now")
        print()

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
