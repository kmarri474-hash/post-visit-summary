# Test data

Synthetic encounter transcripts and generated audio for exercising the
Intake → Transcribe → Agent-graph pipeline.

> **Why not real audio from the internet?** Real clinical encounter recordings
> are PHI and not legally distributable. The transcripts in `transcripts/` are
> fully synthetic — realistic in structure but no actual patients. Audio under
> `audio/` is generated from those transcripts with macOS `say` (or any TTS),
> which gives you reproducible, rights-clean samples to drive the Whisper
> endpoint.

## Contents

```
test-data/
  transcripts/          # 10 lengthy, multi-specialty encounter transcripts (.txt)
  audio/                # generated WAV/M4A files (run ./generate_audio.sh first)
  generate_audio.sh     # renders each transcript to audio using `say`
```

Each transcript is 300-600 words of natural clinician/patient dialogue with
history, review of systems, exam, assessment, and plan. Specialties covered:

| # | File                                   | Scenario                                    |
|---|----------------------------------------|---------------------------------------------|
| 1 | `01_copd_exacerbation.txt`             | COPD flare, steroid taper, inhaler review   |
| 2 | `02_chest_pain_rule_out_acs.txt`       | Chest pain workup, troponin, HEART score    |
| 3 | `03_postpartum_depression.txt`         | PHQ-9, SSRI initiation, safety planning     |
| 4 | `04_atrial_fibrillation_new_onset.txt` | New a-fib, CHA2DS2-VASc, anticoagulation    |
| 5 | `05_chronic_low_back_pain.txt`         | 6-month LBP, red flags, PT referral         |
| 6 | `06_migraine_with_aura.txt`            | Migraine prophylaxis, triptan counseling    |
| 7 | `07_pediatric_asthma.txt`              | School-age asthma, spacer technique         |
| 8 | `08_medicare_wellness_visit.txt`       | AWV, HCC recapture, preventive screening    |
| 9 | `09_geriatric_falls_assessment.txt`    | Polypharmacy, home-safety, ortho vitals     |
| 10| `10_hypothyroidism_followup.txt`       | TSH titration, weight gain, symptoms        |

## Generating audio

```bash
# macOS (uses built-in `say` TTS — 10 different voices for variety)
bash test-data/generate_audio.sh

# Output:
#   test-data/audio/01_copd_exacerbation.m4a
#   test-data/audio/02_chest_pain_rule_out_acs.m4a
#   ...
```

The script writes `.m4a` (AAC in an MP4 container) which is directly accepted
by the OpenAI Whisper API. Expect each file to be 1-4 MB and 2-5 minutes long.

## Driving the app

### Paste a transcript
1. Open `/intake` in the web UI
2. Copy any file from `test-data/transcripts/` into the **Transcript** text area
3. (Optional) fill Chief complaint / vitals / diagnoses sections
4. Click **Run agents**

### Upload audio
1. Open `/intake`
2. In **New encounter**, click **Upload audio (auto-transcribe)**
3. Pick a file from `test-data/audio/`
4. The Whisper endpoint returns text which populates the transcript
5. Click **Run agents**

### Smoke-test via curl

```bash
# Quick transcribe check
curl -s -X POST http://localhost:8000/api/transcribe \
  -F "file=@test-data/audio/01_copd_exacerbation.m4a" | jq .
```

## Licensing

The `.txt` files in this folder are original, written specifically for this
project, and published under the same license as the rest of the repo.
