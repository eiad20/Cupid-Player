import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Capacitor } from '@capacitor/core';
import { parseBlob } from 'music-metadata';

const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.opus'];

async function extractAlbumArt(url) {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const metadata = await parseBlob(blob);
    const picture = metadata.common.picture?.[0];
    if (!picture) return null;

    let binary = "";
    for (let i = 0; i < picture.data.length; i++) {
      binary += String.fromCharCode(picture.data[i]);
    }
    return `data:${picture.format};base64,${window.btoa(binary)}`;
  } catch (err) {
    console.warn('music-metadata failed:', err);
    return null;
  }
}

export async function pickAndScanDeviceAudio() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('File picker requires the compiled mobile app.');
  }

  // readData: false — no native byte-buffering, no OOM. Capacitor's
  // local server already proxies content:// URIs for us.
  const result = await FilePicker.pickFiles({
    multiple: true,
    readData: false
  });

  if (result.files.length === 0) {
    throw new Error('No files selected.');
  }

  const audioFiles = result.files.filter((file) => {
    const lowerName = (file.name || '').toLowerCase();
    return AUDIO_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  });

  if (audioFiles.length === 0) {
    throw new Error('None of the selected files were valid audio formats.');
  }

  // Sequential rather than Promise.all — keeps peak memory down when
  // scanning a batch, since each file's blob is released before the next.
  const tracks = [];
  for (const file of audioFiles) {
    const playUrl = Capacitor.convertFileSrc(file.path);
    const artImage = await extractAlbumArt(playUrl);
    tracks.push({
      title: file.name ? file.name.replace(/\.[^/.]+$/, "") : "Unknown Track",
      artist: 'Local Folder',
      url: playUrl,
      art: artImage
    });
  }
  return tracks;
}