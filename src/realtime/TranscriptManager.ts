import { TargetLanguageCode, Translator } from 'deepl-node'
/**
 * TranscriptSegment represents one segment of transcript for a speaker
 */
export interface TranscriptSegment {
  speaker: string;
  startTime: number;
  endTime?: number;
  text: string;
}

/**
 * Helper to convert millisecondss to SRT time format "HH:MM:SS,mmm"
 */
export function msToSrtTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

/**
 * TranscriptManager accumulates transcript deltas, groups them into segments by speaker
 * Also handles: etrieval, translation, generates SRT file
 */

export class TranscriptManager {
  private segments: TranscriptSegment[] = [];
  private currentSegments: {
    [speaker: string]: TranscriptSegment;
  } = {};

  /**
   * Handles adding a transcript delta for a given speaker at a specific time
   */
  addDelta(speaker: string, delta: string, timestamp: number) {
    // We need to see if this is the first segment for the speaker
    if (!this.currentSegments[speaker]) {
      this.currentSegments[speaker] = {
        speaker,
        startTime: timestamp,
        text: delta,
      };
    } else {
      this.currentSegments[speaker].text += delta;
    }
    console.log(`[${speaker}] Delta received at ${timestamp}: ${delta}`);
    console.log(`[${speaker}] Live transcript: ${this.currentSegments[speaker].text}`);
  }

  /**
   * Commits the current transcript segment for the given speaker
   */
  commitSegment(speaker: string, timestamp: number) {
    if (this.currentSegments[speaker]) {
      this.currentSegments[speaker].endTime = timestamp;
      this.segments.push(this.currentSegments[speaker]);
      console.log(`[${speaker}] Committed segment:`, this.currentSegments[speaker]);
      // Now lets remove that speaker from the current list
      delete this.currentSegments[speaker];
    }
  }

  /**
   * Simple method to return all committed transcript segments
   */
  getTranscript(): TranscriptSegment[] {
    return this.segments;
  }

  /**
   * TODO: Use a translation service to replace this stub
   * Translates segmesnts to a target lang
   */
  async translateTranscript(targetLanguage: TargetLanguageCode): Promise<TranscriptSegment[]> {
    const authKey = process.env.DEEPL_API_KEY;
    if (!authKey) throw new Error('DeepL API key missing in environment variables');
    
    const translator = new Translator(authKey);
    
    // Translate all segment texts in a single request
    const textsToTranslate = this.segments.map(segment => segment.text);
    const translations = await translator.translateText(textsToTranslate, null, targetLanguage);

    // Map translations back to segments
    const translatedSegments = this.segments.map((segment, index) => ({
      ...segment,
      text: translations[index].text,
    }));

    console.log(`Translated transcript to ${targetLanguage}`);
    return translatedSegments;
  }

  /**
   * Generates the SRT file string from the transcript segments that we collected
  **/
  toSRT(): string {
    return this.segments
      .map((segment, index) => {
        const start = msToSrtTime(segment.startTime);
        // We should handle the expection when endTime doesnt exist
        const end = segment.endTime
          ? msToSrtTime(segment.endTime)
          : msToSrtTime(segment.startTime + 2000);
        const text = `[${segment.speaker}] ${segment.text.trim()}`;
        return `${index + 1}\n${start} --> ${end}\n${text}\n\n`;
      })
      .join('');
  }
}
