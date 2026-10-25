#!/bin/sh
# Generates test media for the mock server. Needs ffmpeg. All content is a synthetic test pattern.
#   test.webm       2 min VP8/Vorbis (stands in for MKV/WebM: played by the native pipeline)
#   movie.mp4       2 min VP9/Opus MP4, moov first  (smart-cache path)
#   movie-tail.mp4  same, moov at the end           (exercises the "skip mdat, read moov" path)
#   hls/            1 min VP9 HLS (fMP4) for live
#   movie-2audio.mp4  same video with two audio tracks (eng 440 Hz, ara 880 Hz)  (smart-cache audio switching)
#   hls-sub/        VOD HLS with English/Arabic audio renditions and WebVTT subtitles (hls.js track picker)
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
ffmpeg -y -loglevel error -i "$OUT/movie.mp4" -f lavfi -i sine=frequency=880:sample_rate=48000 -t 120 \
  -map 0:v -map 0:a -map 1:a -c:v copy -c:a libopus -b:a 48k \
  -metadata:s:a:0 language=eng -metadata:s:a:1 language=ara -movflags +faststart "$OUT/movie-2audio.mp4"

# HLS with alternate audio + subtitles
S="$OUT/hls-sub"; mkdir -p "$S"
HLS="-f hls -hls_time 4 -hls_list_size 0 -hls_playlist_type vod -hls_segment_type fmp4"
ffmpeg -y -loglevel error -i "$OUT/movie.mp4" -map 0:v -c copy $HLS -hls_fmp4_init_filename v_init.mp4 -hls_segment_filename "$S/v%d.m4s" "$S/v.m3u8"
for pair in en:440 ar:880; do
  L=${pair%%:*}; F=${pair##*:}
  ffmpeg -y -loglevel error -f lavfi -i sine=frequency=$F:sample_rate=48000 -t 120 -c:a libopus -b:a 48k $HLS \
    -hls_fmp4_init_filename a_${L}_init.mp4 -hls_segment_filename "$S/a_${L}%d.m4s" "$S/a_${L}.m3u8"
  { echo WEBVTT; echo; i=0; while [ $i -lt 120 ]; do
      printf '%s\n' "00:$(printf %02d $((i/60))):$(printf %02d $((i%60))).000 --> 00:$(printf %02d $(((i+3)/60))):$(printf %02d $(((i+3)%60))).000" "Subtitle $L at ${i}s" ""; i=$((i+5)); done; } > "$S/s_${L}.vtt"
  printf '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:120\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:120.0,\ns_%s.vtt\n#EXT-X-ENDLIST\n' "$L" > "$S/s_${L}.m3u8"
done
cat > "$S/master.m3u8" <<'M'
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,URI="a_en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Arabic",LANGUAGE="ar",AUTOSELECT=YES,URI="a_ar.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",AUTOSELECT=YES,URI="s_en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Arabic",LANGUAGE="ar",URI="s_ar.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="vp09.00.10.08,opus",RESOLUTION=640x360,AUDIO="aud",SUBTITLES="subs"
v.m3u8
M
echo "test media written to $OUT"
