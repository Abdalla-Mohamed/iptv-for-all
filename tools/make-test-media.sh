#!/bin/sh
# Generates a 10 s test pattern (WebM/VP9 + an HLS/fMP4 copy) for the mock server. Needs ffmpeg. No external content.
set -e
OUT="$(dirname "$0")/.media"
mkdir -p "$OUT/hls"
ffmpeg -y -loglevel error -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 10 -c:v libvpx -b:v 400k -g 25 -c:a libvorbis "$OUT/test.webm"
ffmpeg -y -loglevel error -stream_loop 5 -i "$OUT/test.webm" -t 60 -c:v libvpx-vp9 -b:v 300k -g 50 -an \
  -f hls -hls_time 4 -hls_list_size 0 -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "$OUT/hls/seg%d.m4s" "$OUT/hls/index.m3u8"
echo "test media written to $OUT"
