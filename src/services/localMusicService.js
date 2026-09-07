import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export async function pickAndScanDeviceAudio() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Auto-scanning requires the compiled mobile app.');
  }

  // 1. Request native OS permissions
  const status = await Filesystem.requestPermissions();
  if (status.publicStorage !== 'granted') {
    throw new Error('Storage permission is required to load device music.');
  }

  // Helper function to RECURSIVELY scan a directory
  const scanDirectory = async (folderPath) => {
    let allAudio = [];
    try {
      const result = await Filesystem.readdir({
        path: folderPath,
        directory: Directory.ExternalStorage,
      });

      for (const file of result.files) {
        if (file.type === 'directory') {
          // If it's a folder (like "Seal" or "Telegram"), dig inside it
          const subFiles = await scanDirectory(`${folderPath}/${file.name}`);
          allAudio = [...allAudio, ...subFiles];
        } else {
          // If it's a file, check if it's audio
          const lowerName = file.name.toLowerCase();
          if (
            lowerName.endsWith('.mp3') || 
            lowerName.endsWith('.m4a') || 
            lowerName.endsWith('.wav') ||
            lowerName.endsWith('.ogg') ||
            lowerName.endsWith('.flac')
          ) {
            allAudio.push(file);
          }
        }
      }
    } catch (err) {
      console.warn(`Could not read folder: ${folderPath}`, err);
    }
    return allAudio;
  };

  // 2. Scan both Music and Download folders (including all sub-folders)
  const [musicFiles, downloadFiles] = await Promise.all([
    scanDirectory('Music'),
    scanDirectory('Download')
  ]);

  const allAudioFiles = [...musicFiles, ...downloadFiles];

  // 3. Prevent silent failures if no audio is found
  if (allAudioFiles.length === 0) {
    throw new Error('No audio files found in Music or Download folders.');
  }

  // 4. Format the files for your React player
  return allAudioFiles.map(file => ({
    title: file.name.replace(/\.[^/.]+$/, ""), // Strip file extension
    artist: 'Local Device',
    url: Capacitor.convertFileSrc(file.uri), // Convert native path to a web-playable URL
    art: null
  }));
}