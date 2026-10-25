#!/bin/sh
# Generates test media for the mock server. Needs ffmpeg. All content is a synthetic test pattern.
#   test.webm       2 min VP8/Vorbis (stands in for MKV/WebM: played by the native pipeline)
#   movie.mp4       2 min VP9/Opus MP4, moov first  (smart-cache path)
#   movie-tail.mp4  same, moov at the end           (exercises the "skip mdat, read moov" path)
#   hls/            1 min VP9 HLS (fMP4) for live
set -e
OUT="$(dirname "$0")/.media"
mkdir -p "$OUT/hls"
SRC="-f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 120"
ffmpeg -y -loglevel error $SRC -c:v libvpx -b:v 400k -g 25 -c:a libvorbis "$OUT/test.webm"
ffmpeg -y -loglevel error $SRC -c:v libvpx-vp9 -b:v 350k -g 50 -deadline realtime -cpu-used 8 -c:a libopus -b:a 48k \
  -movflags +faststart "$OUT/movie.mp4"
ffmpeg -y -loglevel error -i "$OUT/movie.mp4" -c copy "$OUT/movie-tail.mp4"
ffmpeg -y -loglevel error -stream_loop 5 -i "$OUT/test.webm" -t 60 -c:v libvpx-vp9 -b:v 300k -g 50 -an \
  -f hls -hls_time 4 -hls_list_size 0 -hls_segment_type fmp4 -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename "$OUT/hls/seg%d.m4s" "$OUT/hls/index.m3u8"
echo "test media written to $OUT"
