import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';

export async function pickAndScanDeviceAudio() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('File picker requires the compiled mobile app.');
  }

  // 1. Open the native Android file browser with multiple selection enabled
  const result = await FilePicker.pickFiles({
    multiple: true, // This fixes the "1 song at a time" issue
    readData: false // We only need the file path to stream the audio
  });

  if (result.files.length === 0) {
    throw new Error('No files selected.');
  }

  // 2. Filter the selection to ensure we only grab valid audio formats
  const audioFiles = result.files.filter(file => {
    const lowerName = (file.name || '').toLowerCase();
    return lowerName.endsWith('.mp3') || 
           lowerName.endsWith('.m4a') || 
           lowerName.endsWith('.wav') ||
           lowerName.endsWith('.ogg') ||
           lowerName.endsWith('.flac') ||
           lowerName.endsWith('.opus');
  });

  if (audioFiles.length === 0) {
    throw new Error('None of the selected files were valid audio formats.');
  }

  // 3. Format the selected files for your React player
  return audioFiles.map(file => ({
    title: file.name ? file.name.replace(/\.[^/.]+$/, "") : "Unknown Track",
    artist: 'Local Folder',
    url: Capacitor.convertFileSrc(file.path), // Convert the native path to a web URL
    art: null
  }));
}