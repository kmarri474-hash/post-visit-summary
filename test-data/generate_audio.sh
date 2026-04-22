#!/usr/bin/env bash
# Render each synthetic transcript in test-data/transcripts/ to an audio file
# using macOS `say`. We pick a different voice per transcript for variety and
# write .m4a (AAC in MP4 container) which Whisper accepts natively.
#
# Usage:
#   bash test-data/generate_audio.sh          # generate all
#   FORCE=1 bash test-data/generate_audio.sh  # overwrite existing
#
# Requirements: macOS (ships with `say` and `afconvert`).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRANSCRIPT_DIR="${ROOT_DIR}/transcripts"
AUDIO_DIR="${ROOT_DIR}/audio"

mkdir -p "${AUDIO_DIR}"

if ! command -v say >/dev/null 2>&1; then
  echo "'say' command not found. This script requires macOS." >&2
  exit 1
fi
if ! command -v afconvert >/dev/null 2>&1; then
  echo "'afconvert' not found. This script requires macOS." >&2
  exit 1
fi

# Pair transcripts to voices. Each voice gives a distinct timbre so Whisper
# can be exercised across speakers. `say -v "?"` lists all installed voices.
# If any of these aren't on your machine, substitute one from `say -v "?"`.
VOICES=(
  "Samantha"   # en_US female, default
  "Tom"        # en_US male
  "Karen"      # en_AU female
  "Daniel"     # en_GB male
  "Moira"      # en_IE female
  "Fiona"      # en-scotland female
  "Fred"       # en_US male, classic
  "Veena"      # en_IN female
  "Alex"       # en_US male, natural
  "Victoria"   # en_US female
)

RATE=${RATE:-175}  # words per minute (default 175 — natural speaking pace)

i=0
for txt in "${TRANSCRIPT_DIR}"/*.txt; do
  base=$(basename "${txt}" .txt)
  voice="${VOICES[$((i % ${#VOICES[@]}))]}"
  aiff="${AUDIO_DIR}/${base}.aiff"
  m4a="${AUDIO_DIR}/${base}.m4a"

  if [[ -f "${m4a}" && "${FORCE:-0}" != "1" ]]; then
    echo "skip  ${base}.m4a  (already exists; set FORCE=1 to overwrite)"
    i=$((i+1))
    continue
  fi

  echo "tts   ${base}  (voice=${voice}, rate=${RATE}wpm)"
  # Generate AIFF, then convert to AAC/.m4a (smaller, Whisper-friendly).
  say -v "${voice}" -r "${RATE}" -o "${aiff}" -f "${txt}"
  afconvert -f m4af -d aac "${aiff}" "${m4a}" >/dev/null
  rm -f "${aiff}"

  size=$(du -h "${m4a}" | cut -f1)
  echo "done  ${base}.m4a  (${size})"
  i=$((i+1))
done

echo
echo "Generated $(ls "${AUDIO_DIR}"/*.m4a 2>/dev/null | wc -l | tr -d ' ') audio file(s) in ${AUDIO_DIR}."
